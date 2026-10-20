using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Termlume.FileDrag {
 internal static class DesktopGestureSmoke {
  [DllImport("user32.dll")] static extern bool GetCursorPos(out PointL point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string name);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PointL point);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,System.Text.StringBuilder name,int length);
  static string ClassAt(PointL point){var name=new System.Text.StringBuilder(256);GetClassName(WindowFromPoint(point),name,256);return name.ToString();}
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rectangle);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  internal static void Run(string explorerDirectory,string sourceWindow) {
   PointL original;GetCursorPos(out original);object shellObject=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));dynamic shell=shellObject;
   Form source=null;
   try {
    shell.MinimizeAll();Thread.Sleep(350);
    string desktop=Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
    PointL point=new PointL();bool found=false;
    if(explorerDirectory!=null){
     desktop=Path.GetFullPath(explorerDirectory);shell.Open(desktop);
     for(int attempt=0;attempt<80 && !found;attempt++){
      foreach(dynamic window in shell.Windows())try{Uri location;if(!Uri.TryCreate((string)window.LocationURL,UriKind.Absolute,out location)||!location.IsFile||!String.Equals(Path.GetFullPath(location.LocalPath).TrimEnd('\\'),desktop.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))continue;IntPtr handle=new IntPtr((long)window.HWND);Native.ShowWindow(handle,9);SetForegroundWindow(handle);Thread.Sleep(150);Rect rect;GetWindowRect(handle,out rect);point.x=rect.left+(rect.right-rect.left)*2/3;point.y=rect.top+(rect.bottom-rect.top)*2/3;found=true;break;}catch{}
      if(!found)Thread.Sleep(100);
     }
    }else{
     var bounds=SystemInformation.PrimaryMonitorSize;
     for(int x=bounds.Width-40;x>bounds.Width/2 && !found;x-=80)for(int y=100;y<bounds.Height-90;y+=80){point.x=x;point.y=y;if(ClassAt(point)=="SysListView32" && System.Windows.Automation.AutomationElement.FromPoint(new System.Windows.Point(point.x,point.y)).Current.ControlType==System.Windows.Automation.ControlType.List && String.Equals(WindowsDropTracker.Resolve(point),desktop,StringComparison.OrdinalIgnoreCase)){found=true;break;}}
    }
    if(!found)throw new Exception("No unobstructed drop location");
    ulong rawSource;IntPtr sourceHandle=IntPtr.Zero;
    if(!String.IsNullOrEmpty(sourceWindow)&&UInt64.TryParse(sourceWindow,System.Globalization.NumberStyles.HexNumber,null,out rawSource)){sourceHandle=new IntPtr(unchecked((long)rawSource));Native.ShowWindow(sourceHandle,9);SetForegroundWindow(sourceHandle);Thread.Sleep(100);SetCursorPos(350,250);}
    else {
     var sourceReady=new ManualResetEvent(false);
     var sourceThread=new Thread(delegate(){source=new Form{Text="Termlume drag test source",StartPosition=FormStartPosition.Manual,Location=new System.Drawing.Point(20,20),Size=new System.Drawing.Size(320,200)};source.Shown+=delegate{SetForegroundWindow(source.Handle);sourceReady.Set();};Application.Run(source);});sourceThread.IsBackground=true;sourceThread.SetApartmentState(ApartmentState.STA);sourceThread.Start();if(!sourceReady.WaitOne(3000))throw new Exception("Test source did not open");SetCursorPos(100,100);
    }
    Console.WriteLine("{\"type\":\"desktop-ready\",\"directory\":"+new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(desktop)+"}");Console.Out.Flush();
    string line;
    while((line=Console.ReadLine())!=null) {
     if(line.StartsWith("down-at|")) {
      string[] values=line.Split('|');if(values.Length!=3)throw new Exception("Invalid down-at coordinates");
      int x=Int32.Parse(values[1]),y=Int32.Parse(values[2]);
      SetCursorPos(x,y);Thread.Sleep(100);Native.mouse_event(2,0,0,0,UIntPtr.Zero);Thread.Sleep(100);
      for(int step=1;step<=12;step++){SetCursorPos(x+step,y);Thread.Sleep(20);}
      Console.WriteLine("{\"type\":\"pressed\"}");Console.Out.Flush();
     }
     else if(line=="outside") {
      SetCursorPos(point.x-12,point.y-12);Thread.Sleep(120);SetCursorPos(point.x,point.y);Thread.Sleep(120);
      Console.WriteLine("{\"type\":\"outside\"}");Console.Out.Flush();
     }
     else if(line=="waitoutside") {
      bool tracking=false;for(int attempt=0;attempt<120;attempt++){IntPtr badge=FindWindow(null,"Termlume.FileDrag.Active");if(badge!=IntPtr.Zero && IsWindowVisible(badge)){tracking=true;break;}Thread.Sleep(25);}
      if(!tracking)throw new Exception("Native drag did not start after leaving the app window");
      Console.WriteLine("{\"type\":\"tracking\"}");Console.Out.Flush();
     }
     else if(line=="cancel") {Native.mouse_event(4,0,0,0,UIntPtr.Zero);Console.WriteLine("{\"type\":\"cancelled\"}");Console.Out.Flush();}
     else if(line=="down") {Native.mouse_event(2,0,0,0,UIntPtr.Zero);Console.WriteLine("{\"type\":\"pressed\"}");Console.Out.Flush();}
     else if(line=="release") {
      bool tracking=false;for(int attempt=0;attempt<80;attempt++){IntPtr badge=FindWindow(null,"Termlume.FileDrag.Active");if(badge!=IntPtr.Zero && IsWindowVisible(badge)){tracking=true;break;}Thread.Sleep(25);}
      SetCursorPos(point.x-12,point.y-12);Thread.Sleep(60);SetCursorPos(point.x,point.y);Thread.Sleep(150);
      Native.mouse_event(4,0,0,0,UIntPtr.Zero);
      if(!tracking)throw new Exception("Transfer badge did not start");
      Console.WriteLine("{\"type\":\"released\"}");Console.Out.Flush();
     } else if(line=="close")break;
    }
   } finally {if(source!=null && source.IsHandleCreated)source.BeginInvoke((Action)source.Close);Native.mouse_event(4,0,0,0,UIntPtr.Zero);SetCursorPos(original.x,original.y);shell.UndoMinimizeALL();Marshal.ReleaseComObject(shellObject);}
  }
 }
}
