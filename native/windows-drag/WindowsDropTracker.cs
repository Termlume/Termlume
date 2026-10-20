using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using System.Windows.Automation;

namespace Termlume.FileDrag {
 [ComImport,Guid("6D5140C1-7436-11CE-8034-00AA006009FA"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IShellServiceProvider {[PreserveSig]int QueryService(ref Guid service,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);}
 [ComImport,Guid("000214E2-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IShellBrowserWindow {[PreserveSig]int GetWindow(out IntPtr window);}
 // File-manager destinations are resolved by the Windows shell after the mouse
 // is released. No OLE capture, foreground switching, or content download occurs
 // while the user is choosing a destination.
 internal static class WindowsDropTracker {
  [DllImport("user32.dll")] static extern bool GetCursorPos(out PointL point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PointL point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr handle,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle,StringBuilder name,int length);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  static Timer timer;
  static DragBadge badge;
  static Action<string,string> completed;
  static DateTime started;

  sealed class DragBadge : Form {
   protected override bool ShowWithoutActivation {get{return true;}}
   protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000020|0x80;return p;}}
   public DragBadge(string name) {
    Text="Termlume.FileDrag.Active";
    FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
    StartPosition=FormStartPosition.Manual;Size=new System.Drawing.Size(280,36);
    BackColor=System.Drawing.Color.FromArgb(35,39,51);ForeColor=System.Drawing.Color.White;Opacity=.94;
    Controls.Add(new Label {Text="Копировать: "+name,Dock=DockStyle.Fill,AutoEllipsis=true,
     Padding=new Padding(10,9,8,0),Font=new System.Drawing.Font("Segoe UI",9)});
   }
  }
  internal static void Begin(string name,Action<string,string> result) {
   Cancel();completed=result;
   if((Native.GetAsyncKeyState(1)&0x8000)==0) {Finish(null,null);return;}
   started=DateTime.UtcNow;badge=new DragBadge(name);
   PointL point;GetCursorPos(out point);MoveBadge(point);badge.Show();Native.ShowWindow(badge.Handle,8);
   timer=new Timer {Interval=16};timer.Tick+=Tick;timer.Start();
  }
  static void MoveBadge(PointL point) {
   var bounds=SystemInformation.VirtualScreen;
   badge.Location=new System.Drawing.Point(Math.Min(point.x+18,bounds.Right-badge.Width),Math.Min(point.y+22,bounds.Bottom-badge.Height));
  }
  static void Tick(object sender,EventArgs args) {
   if(Program.Cancelled || (Native.GetAsyncKeyState(27)&0x8000)!=0 || (Native.GetAsyncKeyState(2)&0x8000)!=0 || (DateTime.UtcNow-started).TotalMinutes>2) {Finish(null,null);return;}
   PointL point;GetCursorPos(out point);MoveBadge(point);
   if((Native.GetAsyncKeyState(1)&0x8000)!=0)return;
   timer.Stop();badge.Hide();
   try {string directory=Resolve(point);Finish(directory,directory==null?"Перетащите файл на рабочий стол или в открытую папку Проводника":null);}
   catch(Exception e) {Finish(null,"Не удалось определить папку назначения: "+e.Message);}
  }
  internal static string Resolve(PointL point) {
   IntPtr window=GetAncestor(WindowFromPoint(point),2);
   var className=new StringBuilder(256);GetClassName(window,className,className.Capacity);
   string directory=null;
   if(className.ToString()=="Progman" || className.ToString()=="WorkerW") directory=Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
   else {
    // Navigation panes, address bars and tabs are not the current file view.
    if(!IsFileView(point))return null;
    var candidates=new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var activeCandidates=new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
    object shellObject=null,windowsObject=null;
    try {
     shellObject=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));dynamic shell=shellObject;
     windowsObject=shell.Windows();dynamic windows=windowsObject;
     for(int i=0;i<(int)windows.Count;i++) {
      object entryObject=null,documentObject=null,folderObject=null,selfObject=null;
      try {
       entryObject=windows.Item(i);dynamic entry=entryObject;
       if(new IntPtr((long)entry.HWND)!=window)continue;
       documentObject=entry.Document;dynamic document=documentObject;
       folderObject=document.Folder;dynamic folder=folderObject;
       selfObject=folder.Self;dynamic self=selfObject;string candidate=(string)self.Path;
       if(Directory.Exists(candidate)){candidates.Add(candidate);if(IsActiveView(entryObject))activeCandidates.Add(candidate);}
      } catch(COMException) {} finally {Release(selfObject);Release(folderObject);Release(documentObject);Release(entryObject);}
     }
    } finally {Release(windowsObject);Release(shellObject);}
    var choices=activeCandidates.Count>0?activeCandidates:candidates;
    if(choices.Count>1)throw new InvalidOperationException("Откройте папку в отдельном окне Проводника: активная вкладка не определена однозначно");
    if(choices.Count==0)return null;
    foreach(string candidate in choices)directory=candidate;
   }
   if(directory==null || !Directory.Exists(directory))return null;
   // A folder icon is also a destination; use accessibility hit testing instead
   // of the current selection, which may refer to a different item.
   try {
    var item=AutomationElement.FromPoint(new System.Windows.Point(point.x,point.y));
    for(int depth=0;item!=null && depth<8;depth++,item=TreeWalker.RawViewWalker.GetParent(item)) {
     var kind=item.Current.ControlType;
     if(kind!=ControlType.ListItem && kind!=ControlType.DataItem)continue;
     var name=item.Current.Name;
     if(!String.IsNullOrEmpty(name) && name.IndexOfAny(Path.GetInvalidFileNameChars())<0) {
      var child=Path.Combine(directory,name);if(Directory.Exists(child))return Path.GetFullPath(child);
     }
     break;
    }
   } catch(InvalidOperationException) {} catch(COMException) {}
   return Path.GetFullPath(directory);
  }
  static bool IsActiveView(object entry) {
   object browser=null;
   try {
    var provider=entry as IShellServiceProvider;if(provider==null)return false;
    Guid service=new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837"),iid=new Guid("000214E2-0000-0000-C000-000000000046");
    if(provider.QueryService(ref service,ref iid,out browser)<0)return false;
    IntPtr window;return ((IShellBrowserWindow)browser).GetWindow(out window)>=0 && IsWindowVisible(window);
   }catch(COMException){return false;}finally{Release(browser);}
  }
  static bool IsFileView(PointL point) {
   try {
    var item=AutomationElement.FromPoint(new System.Windows.Point(point.x,point.y));
    for(int depth=0;item!=null && depth<15;depth++,item=TreeWalker.RawViewWalker.GetParent(item)) {
     var type=item.Current.ControlType;
     if(type==ControlType.List || type==ControlType.DataGrid)return true;
     if(type==ControlType.Tree || type==ControlType.ToolBar || type==ControlType.TitleBar || type==ControlType.Tab)return false;
    }
   }catch(InvalidOperationException){}catch(COMException){}catch(ElementNotAvailableException){}
   return false;
  }
  static void Release(object value) {if(value!=null && Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
  static void Finish(string directory,string error) {
   var callback=completed;completed=null;
   if(timer!=null){timer.Stop();timer.Dispose();timer=null;}
   if(badge!=null){badge.Close();badge.Dispose();badge=null;}
   if(callback!=null)callback(directory,error);
  }
  internal static void Cancel() {Finish(null,null);}
 }
}
