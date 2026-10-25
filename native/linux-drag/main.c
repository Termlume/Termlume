#define FUSE_USE_VERSION 31
#define _FILE_OFFSET_BITS 64
#include <fuse3/fuse.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <poll.h>
#include <signal.h>
#include <sys/prctl.h>

/* A single-threaded read-only filesystem. SSH stays in the parent application. */
static const char *root_name;
static struct stat selected;
#ifndef RPC_TIMEOUT_MS
#define RPC_TIMEOUT_MS 30000
#endif
/* A lost frame cannot be reused: a late reply could belong to another read. */
static void transport_failed(void) {
  _exit(EXIT_FAILURE);
}
static int read_exact(void *buf, size_t size) {
  size_t done=0;
  while(done<size){struct pollfd fd={STDIN_FILENO,POLLIN,0};int ready=poll(&fd,1,RPC_TIMEOUT_MS);if(ready<0&&errno==EINTR)continue;if(ready<=0)transport_failed();ssize_t n=read(STDIN_FILENO,(char*)buf+done,size-done);if(n<0&&errno==EINTR)continue;if(n<=0)transport_failed();done+=(size_t)n;}return 0;
}
static int rpc(char op,const char *path,off_t off,size_t length,char **out,uint32_t *size){
  size_t n=strlen(path);if(n>4096)return -ENAMETOOLONG;
  fprintf(stdout,"%c\t%lld\t%zu\t",op,(long long)off,length);
  for(size_t i=0;i<n;i++)fprintf(stdout,"%02x",(unsigned char)path[i]);
  fputc('\n',stdout);if(fflush(stdout)||ferror(stdout))transport_failed();
  int32_t status;uint32_t bytes;if(read_exact(&status,4)||read_exact(&bytes,4))return -EIO;
  if(bytes>16777216||status>0)transport_failed();
  *out=malloc((size_t)bytes+1);if(!*out)transport_failed();
  if(read_exact(*out,bytes)){free(*out);*out=NULL;return -EIO;}
  (*out)[bytes]=0;*size=bytes;
  if(status){free(*out);*out=NULL;return status<0?status:-EIO;}return 0;
}
static void metadata(struct stat *st,int directory,uint64_t size,uint64_t modified){
  memset(st,0,sizeof(*st));st->st_mode=(directory?S_IFDIR|0700:S_IFREG|0600);st->st_nlink=directory?2:1;
  st->st_uid=getuid();st->st_gid=getgid();st->st_size=(off_t)size;st->st_blksize=131072;st->st_blocks=(size+511)/512;
  st->st_mtim.tv_sec=(time_t)(modified/1000);st->st_mtim.tv_nsec=(long)(modified%1000)*1000000;st->st_atim=st->st_ctim=st->st_mtim;
}
static int getattr_cb(const char *path,struct stat *st,struct fuse_file_info *fi){
  (void)fi;
  if(!strcmp(path,"/")){metadata(st,1,0,0);return 0;}
  if(path[0]=='/'&&!strcmp(path+1,root_name)){*st=selected;return 0;}
  char *buf=NULL;uint32_t size=0;int rc=rpc('S',path,0,0,&buf,&size);if(rc)return rc;
  if(size!=17){free(buf);return -EIO;}uint64_t len,mtime;memcpy(&len,buf+1,8);memcpy(&mtime,buf+9,8);metadata(st,buf[0]=='d',len,mtime);free(buf);return 0;
}
static int open_cb(const char *path,struct fuse_file_info *fi){
  if((fi->flags&O_ACCMODE)!=O_RDONLY)return -EROFS;
  struct stat st;int rc=getattr_cb(path,&st,fi);if(rc)return rc;
  if(S_ISDIR(st.st_mode))return -EISDIR;
  fi->direct_io=1;fi->keep_cache=0;return 0;
}
static int read_cb(const char *path,char *buf,size_t length,off_t offset,struct fuse_file_info *fi){
  (void)fi;char *data=NULL;uint32_t size=0;if(length>262144)length=262144;
  int rc=rpc('R',path,offset,length,&data,&size);if(rc)return rc;
  if(size>length){free(data);return -EIO;}memcpy(buf,data,size);free(data);return (int)size;
}
static int readdir_cb(const char *path,void *buf,fuse_fill_dir_t fill,off_t offset,struct fuse_file_info *fi,enum fuse_readdir_flags flags){
  (void)offset;(void)fi;(void)flags;
  fill(buf,".",NULL,0,0);fill(buf,"..",NULL,0,0);
  if(!strcmp(path,"/")){fill(buf,root_name,&selected,0,0);return 0;}
  char *data=NULL;uint32_t size=0;int rc=rpc('D',path,0,0,&data,&size);if(rc)return rc;
  char *save=NULL;for(char *hex=strtok_r(data,"\n",&save);hex;hex=strtok_r(NULL,"\n",&save)){
    size_t n=strlen(hex);if(n%2||n>8192){free(data);return -EIO;}char name[4097];
    for(size_t i=0;i<n;i+=2){unsigned int b;if(sscanf(hex+i,"%2x",&b)!=1){free(data);return -EIO;}name[i/2]=(char)b;}name[n/2]=0;
    if(fill(buf,name,NULL,0,0))break;
  }free(data);return 0;
}
static void *init_cb(struct fuse_conn_info *conn,struct fuse_config *cfg){
  conn->max_read=131072;cfg->use_ino=0;cfg->entry_timeout=1;cfg->attr_timeout=1;cfg->negative_timeout=0;
  fputs("READY\n",stdout);fflush(stdout);return NULL;
}
int main(int argc,char **argv){
  if(argc!=6)return 2;
  prctl(PR_SET_PDEATHSIG,SIGTERM);if(getppid()==1)return 2;
  root_name=argv[2];metadata(&selected,argv[3][0]=='d',strtoull(argv[4],NULL,10),strtoull(argv[5],NULL,10));
  const struct fuse_operations ops={.getattr=getattr_cb,.open=open_cb,.read=read_cb,.readdir=readdir_cb,.init=init_cb};
  char *args[]={argv[0],argv[1],"-f","-s","-o","ro,auto_unmount,default_permissions,fsname=Termlume,max_read=131072",NULL};
  return fuse_main(6,args,&ops,NULL);
}
