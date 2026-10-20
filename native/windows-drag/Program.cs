using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using IDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;

namespace Termlume.FileDrag {
 [StructLayout(LayoutKind.Sequential)] public struct PointL {public int x,y;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] internal struct OpenAsInfo {
  [MarshalAs(UnmanagedType.LPWStr)] public string file;
  [MarshalAs(UnmanagedType.LPWStr)] public string fileClass;
  public uint flags;
 }
 internal static class Native {
  [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll")] internal static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] internal static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=true)] internal static extern int SHOpenWithDialog(IntPtr owner,ref OpenAsInfo info);
  [DllImport("ole32.dll")] internal static extern int OleInitialize(IntPtr reserved);
  [DllImport("ole32.dll")] internal static extern void OleUninitialize();
  [DllImport("ole32.dll")] internal static extern int DoDragDrop([MarshalAs(UnmanagedType.Interface)] IDataObject data, IDropSource source,uint allowed,out uint effect);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern int GetClipboardFormatName(uint format,System.Text.StringBuilder name,int size);
  internal static string FormatName(short format){var text=new System.Text.StringBuilder(256);GetClipboardFormatName((ushort)format,text,256);return text.ToString();}
  [DllImport("kernel32.dll")] internal static extern IntPtr GlobalAlloc(uint flags,UIntPtr bytes);
  [DllImport("kernel32.dll")] internal static extern IntPtr GlobalLock(IntPtr handle);
  [DllImport("kernel32.dll")] internal static extern bool GlobalUnlock(IntPtr handle);
  [DllImport("shlwapi.dll",CharSet=CharSet.Unicode,PreserveSig=true)] internal static extern int SHCreateStreamOnFileEx(string path,uint mode,uint attributes,bool create,IntPtr template,out IStream stream);
 }
 [ComImport,Guid("00000121-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IDropSource {
  [PreserveSig]int QueryContinueDrag([MarshalAs(UnmanagedType.Bool)]bool escape,uint keys);
  [PreserveSig]int GiveFeedback(uint effect);
 }
 [ComVisible(true),ClassInterface(ClassInterfaceType.None)] public sealed class DropSource:IDropSource {
  public int QueryContinueDrag(bool escape,uint keys){Program.Trace("query keys="+keys+" physical="+Native.GetAsyncKeyState(1)+" escape="+escape);if(escape || Program.Cancelled || (Native.GetAsyncKeyState(2)&0x8000)!=0)return 0x40101;if((Native.GetAsyncKeyState(1)&0x8000)==0){Program.Dropped=true;return 0x40100;}return 0;}
  public int GiveFeedback(uint effect){return 0x40102;}
 }
 [ComVisible(true),ClassInterface(ClassInterfaceType.None)] public sealed class Formats:IEnumFORMATETC {
  readonly FORMATETC[] items;int index;
  internal Formats(FORMATETC[] values){items=values;}
  public int Next(int count,FORMATETC[] target,int[] fetched){Program.Trace("enum next "+count+" index="+index);int n=0;while(n<count && index<items.Length)target[n++]=items[index++];if(fetched!=null)fetched[0]=n;return n==count?0:1;}
  public int Skip(int count){index=Math.Min(items.Length,index+count);return index<items.Length?0:1;}
  public int Reset(){index=0;return 0;}
  public void Clone(out IEnumFORMATETC clone){clone=new Formats(items){index=index};}
 }
 [ComVisible(true),ClassInterface(ClassInterfaceType.None)] public sealed class VirtualFile:IDataObject {
  readonly string id,name;readonly short descriptor,contents,effect;string path;
  internal VirtualFile(string id,string name){this.id=id;this.name=name;descriptor=(short)Native.RegisterClipboardFormat("FileGroupDescriptorW");contents=(short)Native.RegisterClipboardFormat("FileContents");effect=(short)Native.RegisterClipboardFormat("Preferred DropEffect");Program.Trace("formats descriptor="+descriptor+" contents="+contents+" effect="+effect);}
  FORMATETC Format(short format,TYMED medium,int index){return new FORMATETC{cfFormat=format,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=index,tymed=medium};}
  public IEnumFORMATETC EnumFormatEtc(DATADIR direction){Program.Trace("enum formats "+direction);if(direction!=DATADIR.DATADIR_GET)throw new COMException("Not supported",unchecked((int)0x80004001));return new Formats(new[]{Format(descriptor,TYMED.TYMED_HGLOBAL,-1),Format(contents,TYMED.TYMED_ISTREAM,0),Format(effect,TYMED.TYMED_HGLOBAL,-1)});}
  public int QueryGetData(ref FORMATETC f){Program.Trace("querydata "+Native.FormatName(f.cfFormat)+" id="+f.cfFormat+" medium="+f.tymed+" index="+f.lindex);if(f.dwAspect!=DVASPECT.DVASPECT_CONTENT)return unchecked((int)0x8004006B);if(f.cfFormat==contents)return (f.tymed&TYMED.TYMED_ISTREAM)!=0 && f.lindex==0?0:unchecked((int)0x80040064);return (f.cfFormat==descriptor || f.cfFormat==effect) && (f.tymed&TYMED.TYMED_HGLOBAL)!=0?0:unchecked((int)0x80040064);}
  public void GetData(ref FORMATETC f,out STGMEDIUM medium){
   Program.Trace("getdata format="+f.cfFormat+" index="+f.lindex+" medium="+f.tymed+" dropped="+Program.Dropped);int result=QueryGetData(ref f);if(result!=0)Marshal.ThrowExceptionForHR(result);
   medium=new STGMEDIUM();
   if(f.cfFormat==contents){
    if(!Program.Dropped)throw new COMException("Drop has not been committed",unchecked((int)0x8000000A));
    if(path==null)path=Program.Materialize(id);
    IStream stream;Marshal.ThrowExceptionForHR(Native.SHCreateStreamOnFileEx(path,0x40,0,false,IntPtr.Zero,out stream));
    medium.tymed=TYMED.TYMED_ISTREAM;medium.unionmember=Marshal.GetComInterfaceForObject(stream,typeof(IStream));Marshal.ReleaseComObject(stream);return;
   }
   byte[] bytes;
   if(f.cfFormat==effect)bytes=BitConverter.GetBytes((uint)1);
   else {bytes=new byte[596];Buffer.BlockCopy(BitConverter.GetBytes(1),0,bytes,0,4);Buffer.BlockCopy(BitConverter.GetBytes((uint)0x80004004),0,bytes,4,4);Buffer.BlockCopy(BitConverter.GetBytes((uint)0x80),0,bytes,40,4);byte[] filename=System.Text.Encoding.Unicode.GetBytes(name);Buffer.BlockCopy(filename,0,bytes,76,Math.Min(filename.Length,518));}
   IntPtr memory=Native.GlobalAlloc(0x42,(UIntPtr)bytes.Length);if(memory==IntPtr.Zero)throw new OutOfMemoryException();IntPtr pointer=Native.GlobalLock(memory);Marshal.Copy(bytes,0,pointer,bytes.Length);Native.GlobalUnlock(memory);medium.tymed=TYMED.TYMED_HGLOBAL;medium.unionmember=memory;
  }
  public void GetDataHere(ref FORMATETC f,ref STGMEDIUM m){throw new COMException("Not supported",unchecked((int)0x80004001));}
  public int GetCanonicalFormatEtc(ref FORMATETC input,out FORMATETC output){output=input;output.ptd=IntPtr.Zero;return 0x40130;}
  public void SetData(ref FORMATETC f,ref STGMEDIUM medium,bool release){throw new COMException("Not supported",unchecked((int)0x80004001));}
  public int DAdvise(ref FORMATETC f,ADVF flags,IAdviseSink sink,out int connection){connection=0;return unchecked((int)0x80040003);}
  public void DUnadvise(int connection){throw new COMException("Not supported",unchecked((int)0x80040003));}
  public int EnumDAdvise(out IEnumSTATDATA data){data=null;return unchecked((int)0x80040003);}
 }
 internal sealed class DragMarker:Form {protected override bool ShowWithoutActivation {get{return true;}} protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000000;return p;}}}
 internal static class Program {
  static readonly object outputLock=new object(),responseLock=new object();static Control host;
  internal static volatile bool Cancelled,Dropped;static string activeId,responsePath,responseError;static readonly AutoResetEvent response=new AutoResetEvent(false);
  internal static void Trace(string text){string file=Environment.GetEnvironmentVariable("TERMLUME_DRAG_TRACE");if(!String.IsNullOrEmpty(file))try{File.AppendAllText(file,DateTime.UtcNow.ToString("O")+" "+text+"\n");}catch{}}
  internal static void Send(object value){lock(outputLock){Console.WriteLine(new JavaScriptSerializer().Serialize(value));Console.Out.Flush();}}
  internal static string Materialize(string id){
   Send(new{type="materialize",id=id});
   // COM STA must pump while Electron downloads, otherwise Explorer's drag UI hangs.
   DateTime deadline=DateTime.UtcNow.AddHours(2);
   while(!response.WaitOne(0)){Application.DoEvents();Thread.Sleep(10);if(Cancelled || DateTime.UtcNow>deadline)throw new COMException("Transfer cancelled",unchecked((int)0x80004004));}
   lock(responseLock){if(responseError!=null)throw new IOException(responseError);if(String.IsNullOrEmpty(responsePath)||!Path.IsPathRooted(responsePath)||!File.Exists(responsePath))throw new IOException("Downloaded file unavailable");return responsePath;}
  }
  [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  static void Start(string id,string name,string sourceWindow){
   if(activeId!=null){Send(new{type="result",id=id,error="Another drag is active"});return;}
   if((Native.GetAsyncKeyState(1)&0x8000)==0){Send(new{type="result",id=id,dropped=false});return;}
   // Chromium owns the HTML drag's OLE loop until Escape is delivered. End that
   // loop without releasing the physical button before starting the virtual file drag.
   keybd_event(0x1B,0,0,UIntPtr.Zero);Thread.Sleep(30);keybd_event(0x1B,0,2,UIntPtr.Zero);Thread.Sleep(120);
   if((Native.GetAsyncKeyState(1)&0x8000)==0){Send(new{type="result",id=id,dropped=false});return;}
   activeId=id;Cancelled=false;Dropped=false;responsePath=responseError=null;response.Reset();
   using(var marker=new DragMarker{Text="Termlume.FileDrag.Active",ShowInTaskbar=false,FormBorderStyle=FormBorderStyle.None,Opacity=0,Size=new System.Drawing.Size(1,1),StartPosition=FormStartPosition.Manual,Location=new System.Drawing.Point(-30000,-30000)}){
    marker.Show();
    ulong rawWindow;IntPtr ownerWindow=!String.IsNullOrEmpty(sourceWindow)&&UInt64.TryParse(sourceWindow,System.Globalization.NumberStyles.HexNumber,null,out rawWindow)?new IntPtr(unchecked((long)rawWindow)):Native.GetForegroundWindow();
    uint ownerProcess;uint sourceThread=Native.GetWindowThreadProcessId(ownerWindow,out ownerProcess),currentThread=Native.GetCurrentThreadId();bool attached=sourceThread!=0 && sourceThread!=currentThread && Native.AttachThreadInput(currentThread,sourceThread,true);Trace("input attached="+attached);
    try{Trace("drag start "+id);uint effect;int hr=Native.DoDragDrop(new VirtualFile(id,name),new DropSource(),1,out effect);Trace("drag result "+hr+" effect="+effect);if(hr<0)Marshal.ThrowExceptionForHR(hr);Send(new{type="result",id=id,dropped=hr==0x40100 && effect==1});}
    catch(Exception error){Send(new{type="result",id=id,error=error.Message});}
    finally{if(attached)Native.AttachThreadInput(currentThread,sourceThread,false);activeId=null;marker.Close();}
   }
  }
  static void Read(){try{string line;var json=new JavaScriptSerializer();while((line=Console.ReadLine())!=null){var m=json.Deserialize<Dictionary<string,object>>(line);string type=(string)m["type"];
   if(type=="drag"){string id=(string)m["id"],name=(string)m["name"];Guid parsed;if(!Guid.TryParse(id,out parsed)||name.Length==0||name.Length>259||name.IndexOfAny(Path.GetInvalidFileNameChars())>=0)throw new ArgumentException("Invalid transfer request");host.BeginInvoke((Action)delegate{Start(id,name,m.ContainsKey("sourceWindow")?(string)m["sourceWindow"]:null);});}
   else if(type=="materialized"){if((string)m["id"]!=activeId)continue;lock(responseLock){responsePath=m.ContainsKey("path")?(string)m["path"]:null;responseError=m.ContainsKey("error")?(string)m["error"]:null;}response.Set();}
   else if(type=="cancel")Cancelled=true;
   else if(type=="close")break;
  }}catch(Exception error){Send(new{type="error",error=error.Message});}finally{Cancelled=true;if(host!=null)host.BeginInvoke((Action)Application.ExitThread);}}
  static int OpenWith(string path){
   if(String.IsNullOrEmpty(path)||!Path.IsPathRooted(path)||!String.Equals(Path.GetFullPath(path),path,StringComparison.OrdinalIgnoreCase)||!File.Exists(path))throw new ArgumentException("Open With requires an absolute existing file path");
   Marshal.ThrowExceptionForHR(Native.OleInitialize(IntPtr.Zero));
   var info=new OpenAsInfo{file=path,fileClass=null,flags=4}; // OAIF_EXEC: launch the selected application.
   int result=Native.SHOpenWithDialog(IntPtr.Zero,ref info);
   if(result==unchecked((int)0x800704C7))return 0; // User cancelled.
   Marshal.ThrowExceptionForHR(result);return 0;
  }
  [STAThread] static int Main(string[] args){try{if(args.Length==2&&args[0]=="--open-with")return OpenWith(args[1]);if(args.Length>=1&&args[0]=="--desktop-gesture-test"){DesktopGestureSmoke.Run(null,args.Length>1?args[1]:null);return 0;}if(args.Length>=2&&args[0]=="--explorer-gesture-test"){DesktopGestureSmoke.Run(args[1],args.Length>2?args[2]:null);return 0;}Marshal.ThrowExceptionForHR(Native.OleInitialize(IntPtr.Zero));host=new Control();IntPtr handle=host.Handle;new Thread(Read){IsBackground=true}.Start();Send(new{type="ready"});Application.Run(new ApplicationContext());return 0;}catch(Exception error){Send(new{type="error",error=error.Message});return 1;}finally{if(host!=null)host.Dispose();Native.OleUninitialize();}}
 }
}
