using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using Accessibility;

namespace LiveComments {
  public class Info {
    public string hwnd, title, processName, startTime,windowClass;
    public int pid, width, height, dpi;
    public bool minimized;
    public int cloaked;
    public bool? onCurrentDesktop;
    public bool? elevated,workerElevated;
  }
  public class Shot {
    public Info window;
    public string png;
    public int width, height;
    public double variance;
    public string backend;
  }
  public class Control {
    public string name, automationId, type, runtimeId;
    public bool value, invoke, enabled;
    public double x, y, width, height;
  }
  public class Calibration {
    public Control input, button;
    public int width, height, dpi;
  }
  public class Receipt {
    public string state, message;
  }
  public class AccessibleControl {
    public string name,value,action,path;
    public int role;
    public double x,y,width,height;
  }
  public static class Bridge {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
    public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out RECT rect,int size);
    [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")] static extern int DwmGetIntAttribute(IntPtr h,int attribute,out int value,int size);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out IAccessible accessible);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible parent,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)] object[] children,out int obtained);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int size);
    [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr parent,POINT point,uint flags);
    [DllImport("user32.dll")] static extern int MapWindowPoints(IntPtr from,IntPtr to,ref POINT point,uint count);
    [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool PostMessage(IntPtr h,uint message,IntPtr wparam,IntPtr lparam);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,out int info,int length,out int returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static bool? Elevated(int pid) {
      IntPtr process=OpenProcess(0x1000,false,pid),token=IntPtr.Zero;
      try {if(process==IntPtr.Zero||!OpenProcessToken(process,8,out token))return null;int info,returned;if(!GetTokenInformation(token,20,out info,4,out returned))return null;return info!=0;}finally{if(token!=IntPtr.Zero)CloseHandle(token);if(process!=IntPtr.Zero)CloseHandle(process);}
    }
    public static object Health(string h) {
      IntPtr handle=Handle(h);RECT rect;GetClientRect(handle,out rect);int cloaked=0;DwmGetIntAttribute(handle,14,out cloaked,4);
      return new {exists=IsWindow(handle),visible=IsWindowVisible(handle),minimized=IsIconic(handle),width=rect.right-rect.left,height=rect.bottom-rect.top,cloaked=cloaked};
    }
    [ComImport,Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")] class VirtualDesktopManager {}
    [ComImport,Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IVirtualDesktopManager {
      [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr h,[MarshalAs(UnmanagedType.Bool)] out bool current);
      [PreserveSig] int GetWindowDesktopId(IntPtr h,out Guid desktop);
      [PreserveSig] int MoveWindowToDesktop(IntPtr h,ref Guid desktop);
    }

    static IntPtr Handle(string s) { long v; if(!long.TryParse(s,out v)||v<=0) throw new Exception("WINDOW_STALE: 无效窗口"); return new IntPtr(v); }
    static void Dpi() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
    public static Info GetInfo(string handle) {
      Dpi(); IntPtr h=Handle(handle);
      if(!IsWindow(h)||!IsWindowVisible(h)) throw new Exception("WINDOW_STALE: 窗口已关闭或隐藏");
      int pid; GetWindowThreadProcessId(h,out pid); RECT r; GetClientRect(h,out r);
      var p=Process.GetProcessById(pid); string start="";
      try { start=p.StartTime.ToUniversalTime().Ticks.ToString(); } catch {}
      var b=new StringBuilder(2048); GetWindowText(h,b,b.Capacity);
      var className=new StringBuilder(256);GetClassName(h,className,className.Capacity);
      int cloaked=0;DwmGetIntAttribute(h,14,out cloaked,4);bool? current=null;object manager=null;
      try {manager=new VirtualDesktopManager();bool value;if(((IVirtualDesktopManager)manager).IsWindowOnCurrentVirtualDesktop(h,out value)==0)current=value;}catch{}finally{if(manager!=null)Marshal.ReleaseComObject(manager);}
      return new Info { hwnd=handle,pid=pid,title=b.ToString(),processName=p.ProcessName,startTime=start,
        width=r.right-r.left,height=r.bottom-r.top,dpi=(int)GetDpiForWindow(h),minimized=IsIconic(h),cloaked=cloaked,onCurrentDesktop=current,windowClass=className.ToString(),elevated=Elevated(pid),workerElevated=Elevated(Process.GetCurrentProcess().Id) };
    }
    public static Info[] Windows() {
      Dpi(); var rows=new List<Info>();
      EnumWindows(delegate(IntPtr h,IntPtr _) {
        try { var i=GetInfo(h.ToInt64().ToString()); if(i.title.Length>0&&i.width>=100&&i.height>=80) rows.Add(i); } catch {}
        return true;
      },IntPtr.Zero); return rows.ToArray();
    }
    public static Info Validate(string h,int pid,string name,string start) {
      var i=GetInfo(h);
      if(start=="")throw new Exception("WINDOW_IDENTITY: 无法核对窗口进程身份，请检查直播软件的运行权限");
      if(i.pid!=pid||i.processName!=name||i.startTime!=start) throw new Exception("WINDOW_STALE: 窗口身份发生变化，请重新选择");
      if(i.minimized||i.width<100||i.height<80) throw new Exception("WINDOW_MINIMIZED: 请恢复直播软件窗口");
      if(i.width>8192||i.height>8192||(long)i.width*i.height>20000000) throw new Exception("WINDOW_SIZE: 窗口尺寸过大");
      return i;
    }
    public static Shot Capture(string h,int pid,string name,string start,double x,double y,double w,double ht,bool full) {
      Dpi(); var i=Validate(h,pid,name,start);
      if(x<0||y<0||w<=0||ht<=0||x+w>1.00001||y+ht>1.00001) throw new Exception("REGION: 评论框选区无效");
      using(var bitmap=new Bitmap(i.width,i.height,PixelFormat.Format32bppArgb)) {
        using(var g=Graphics.FromImage(bitmap)) {
          IntPtr dc=g.GetHdc(); bool ok;
          try { ok=PrintWindow(Handle(h),dc,3); } finally { g.ReleaseHdc(dc); }
          if(!ok) throw new Exception("CAPTURE_FAILED: 直播软件未提供窗口图像（权限或渲染方式不支持）");
        }
        return Encode(bitmap,i,x,y,w,ht,full,"PrintWindow");
      }
    }
    public static Shot FromPixels(string h,int pid,string name,string start,byte[] pixels,int width,int height,double x,double y,double w,double ht,bool full) {
      Dpi();var i=Validate(h,pid,name,start);RECT bounds;
      if(width<=0||height<=0||width>8192||height>8192||(long)width*height>20000000||pixels.LongLength!=(long)width*height*4)throw new Exception("CAPTURE_SIZE: 无效的窗口采集帧");
      if(x<0||y<0||w<=0||ht<=0||x+w>1.00001||y+ht>1.00001)throw new Exception("REGION: 框选区无效 ["+x+","+y+","+w+","+ht+"]");
      if(DwmGetWindowAttribute(Handle(h),9,out bounds,Marshal.SizeOf(typeof(RECT)))!=0||Math.Abs(bounds.right-bounds.left-width)>1||Math.Abs(bounds.bottom-bounds.top-height)>1)throw new Exception("LAYOUT_CHANGED: 无法核对采集帧边界，请恢复窗口后重试");
      var origin=new POINT();ClientToScreen(Handle(h),ref origin);int left=origin.x-bounds.left,top=origin.y-bounds.top;
      if(left<0||top<0||left+i.width>width||top+i.height>height)throw new Exception("LAYOUT_CHANGED: 窗口客户区与采集帧不符");
      using(var frame=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
        var data=frame.LockBits(new Rectangle(0,0,width,height),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
        try { for(int row=0;row<height;row++)Marshal.Copy(pixels,row*width*4,IntPtr.Add(data.Scan0,row*data.Stride),width*4); } finally {frame.UnlockBits(data);}
        using(var client=frame.Clone(new Rectangle(left,top,i.width,i.height),PixelFormat.Format32bppArgb))return Encode(client,i,x,y,w,ht,full,"Windows.Graphics.Capture");
      }
    }
    static Shot Encode(Bitmap bitmap,Info i,double x,double y,double w,double ht,bool full,string backend) {
        var rect=full?new Rectangle(0,0,i.width,i.height):new Rectangle((int)(x*i.width),(int)(y*i.height),Math.Max(1,(int)(w*i.width)),Math.Max(1,(int)(ht*i.height)));
        rect.Intersect(new Rectangle(0,0,i.width,i.height));
        double scale=full?Math.Min(1,1600.0/rect.Width):Math.Min(2,Math.Min(2400.0/rect.Width,2400.0/rect.Height));
        using(var crop=new Bitmap(Math.Max(1,(int)(rect.Width*scale)),Math.Max(1,(int)(rect.Height*scale)),PixelFormat.Format32bppArgb)) {
          using(var g=Graphics.FromImage(crop)) { g.Clear(Color.White); g.DrawImage(bitmap,new Rectangle(0,0,crop.Width,crop.Height),rect,GraphicsUnit.Pixel); }
          double sum=0,sq=0; int count=0;
          for(int yy=0;yy<crop.Height;yy+=Math.Max(1,crop.Height/60)) for(int xx=0;xx<crop.Width;xx+=Math.Max(1,crop.Width/80)) {
            var c=crop.GetPixel(xx,yy); double v=(c.R+c.G+c.B)/3.0;sum+=v;sq+=v*v;count++;
          }
          double variance=sq/count-(sum/count)*(sum/count);
          if(variance<0.3) throw new Exception("CAPTURE_BLANK: 窗口采集为空白；请恢复窗口，或检查直播软件权限/硬件加速");
          using(var ms=new MemoryStream()) { crop.Save(ms,ImageFormat.Png);return new Shot {window=i,png=Convert.ToBase64String(ms.ToArray()),width=crop.Width,height=crop.Height,variance=variance,backend=backend}; }
        }
    }
    static AutomationElement Root(string h) { return AutomationElement.FromHandle(Handle(h)); }
    static string Runtime(AutomationElement e) { return String.Join("-",e.GetRuntimeId()); }
    static bool Belongs(AutomationElement e,AutomationElement root) {
      var id=Runtime(root);
      for(int n=0;e!=null&&n<60;n++,e=TreeWalker.RawViewWalker.GetParent(e)) if(Runtime(e)==id)return true;
      return false;
    }
    static Control Describe(AutomationElement e,Info i) {
      object value,invoke; var r=e.Current.BoundingRectangle; var o=new POINT();ClientToScreen(Handle(i.hwnd),ref o);
      return new Control { name=e.Current.Name,automationId=e.Current.AutomationId,type=e.Current.ControlType.ProgrammaticName,
        runtimeId=Runtime(e),enabled=e.Current.IsEnabled,value=e.TryGetCurrentPattern(ValuePattern.Pattern,out value),invoke=e.TryGetCurrentPattern(InvokePattern.Pattern,out invoke),
        x=(r.X-o.x)/i.width,y=(r.Y-o.y)/i.height,width=r.Width/i.width,height=r.Height/i.height };
    }
    static AutomationElement At(Info i,double x,double y,ControlType type) {
      if(x<0||x>1||y<0||y>1) throw new Exception("CONTROL: 控件坐标超出窗口");
      var root=Root(i.hwnd); var o=new POINT{x=(int)(x*i.width),y=(int)(y*i.height)};ClientToScreen(Handle(i.hwnd),ref o);
      // Search within the selected window; FromPoint would hit another overlapping application.
      var all=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,type));
      for(int n=0;n<all.Count;n++) { var e=all[n];if(!e.Current.IsOffscreen&&e.Current.BoundingRectangle.Contains(new System.Windows.Point(o.x,o.y))&&Belongs(e,root))return e; }
      throw new Exception("CONTROL_UNAVAILABLE: 选定位置没有可验证的"+(type==ControlType.Edit?"评论输入框":"发送按钮")+"；该软件可能没有开放辅助功能接口");
    }
    static ValuePattern Writable(AutomationElement e) {
      object v;if(!e.Current.IsEnabled||!e.TryGetCurrentPattern(ValuePattern.Pattern,out v)||((ValuePattern)v).Current.IsReadOnly)throw new Exception("INPUT_UNSUPPORTED: 评论输入框不可读写，已拒绝盲打");
      return (ValuePattern)v;
    }
    public static Control[] Inspect(string h,int pid,string name,string start) {
      Dpi();var i=Validate(h,pid,name,start);var rows=new List<Control>();
      var all=Root(h).FindAll(TreeScope.Descendants,new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button)));
      for(int n=0;n<all.Count&&rows.Count<150;n++){try{rows.Add(Describe(all[n],i));}catch{}}
      return rows.ToArray();
    }
    public static AccessibleControl[] InspectAccessible(string h,int pid,string name,string start) {
      Dpi();var i=Validate(h,pid,name,start);var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");IAccessible root;
      int hr=AccessibleObjectFromWindow(Handle(h),unchecked((uint)-4),ref iid,out root);
      if(hr!=0||root==null)return new AccessibleControl[0];
      var rows=new List<AccessibleControl>();var origin=new POINT();ClientToScreen(Handle(h),ref origin);
      WalkAccessible(root,0,"",0,origin,i,rows);return rows.ToArray();
    }
    public static string MessageClass(string h,int pid,string name,string start) {
      var i=Validate(h,pid,name,start);var text=new StringBuilder(256);GetClassName(Handle(h),text,text.Capacity);
      if(i.processName!="livehime"||!(text.ToString().StartsWith("Qt")||text.ToString()=="Chrome_WidgetWin_0"))throw new Exception("BACKGROUND_UNSUPPORTED: 此窗口没有已适配的后台输入通道；可继续使用草稿");
      return text.ToString();
    }
    static IntPtr MessageTarget(string h,int pid,string name,string start,int width,int height,int dpi,double x,double y,out POINT p) {
      var i=Validate(h,pid,name,start);MessageClass(h,pid,name,start);
      if(i.elevated==true&&i.workerElevated!=true)throw new Exception("WINDOW_PERMISSION: 直播姬为管理员权限，当前采集进程为普通权限；请完全退出 Coopanion 后，以管理员身份重新打开");
      if(i.width!=width||i.height!=height||i.dpi!=dpi)throw new Exception("LAYOUT_CHANGED: 后台发送前窗口布局已变化");
      if(x<=0||x>=1||y<=0||y>=1)throw new Exception("CONTROL: 后台控件位置无效");
      var parent=Handle(h);p=new POINT{x=(int)(x*width),y=(int)(y*height)};
      for(int n=0;n<20;n++){var child=ChildWindowFromPointEx(parent,p,7);if(child==IntPtr.Zero||child==parent)break;MapWindowPoints(parent,child,ref p,1);parent=child;}
      return parent;
    }
    static void Post(IntPtr h,uint message,int wparam,int lparam) {
      if(!PostMessage(h,message,new IntPtr(wparam),new IntPtr(lparam)))throw new Exception("BACKGROUND_DENIED: 窗口消息未获接受（错误 "+Marshal.GetLastWin32Error()+"）；请核对两个程序的运行权限");
    }
    public static void BackgroundClick(string h,int pid,string name,string start,int width,int height,int dpi,double x,double y) {
      Dpi();POINT p;var target=MessageTarget(h,pid,name,start,width,height,dpi,x,y,out p);int xy=(p.y<<16)|(p.x&65535);
      Post(target,0x201,1,xy);Post(target,0x202,0,xy);
    }
    public static void BackgroundText(string h,int pid,string name,string start,int width,int height,int dpi,double x,double y,string text) {
      Dpi();POINT p;var target=MessageTarget(h,pid,name,start,width,height,dpi,x,y,out p);
      if(String.IsNullOrEmpty(text)||text.Length>40||text.IndexOfAny(new char[]{'\r','\n','\0'})>=0)throw new Exception("INPUT: 后台回复内容无效");
      foreach(char ch in text)Post(target,0x102,ch,1);
    }
    public static void BackgroundEraseProbe(string h,int pid,string name,string start,int width,int height,int dpi,double x,double y,int count) {
      Dpi();POINT p;var target=MessageTarget(h,pid,name,start,width,height,dpi,x,y,out p);
      if(count<1||count>10)throw new Exception("INPUT: 仅允许清理固定的输入验证文字");
      for(int n=0;n<count;n++){Post(target,0x100,8,0x000E0001);Post(target,0x101,8,unchecked((int)0xC00E0001));}
    }
    public static string OcrContrast(string png) {
      using(var source=new MemoryStream(Convert.FromBase64String(png)))using(var bitmap=new Bitmap(source))using(var padded=new Bitmap(bitmap.Width+80,bitmap.Height+80)) {
        using(var g=Graphics.FromImage(padded))g.Clear(Color.White);
        for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++){var c=bitmap.GetPixel(x,y);padded.SetPixel(x+40,y+40,Math.Max(c.R,Math.Max(c.G,c.B))>=55?Color.Black:Color.White);}
        using(var output=new MemoryStream()){padded.Save(output,ImageFormat.Png);return Convert.ToBase64String(output.ToArray());}
      }
    }
    public static string OcrRepeat(string png) {
      using(var source=new MemoryStream(Convert.FromBase64String(png)))using(var bitmap=new Bitmap(source)) {
        int left=bitmap.Width,top=bitmap.Height,right=0,bottom=0;
        for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++)if(bitmap.GetPixel(x,y).R<128){left=Math.Min(left,x);top=Math.Min(top,y);right=Math.Max(right,x);bottom=Math.Max(bottom,y);}
        if(right<=left||bottom<=top)return png;
        var rect=new Rectangle(Math.Max(0,left-3),Math.Max(0,top-3),Math.Min(bitmap.Width-left+3,right-left+7),Math.Min(bitmap.Height-top+3,bottom-top+7));
        using(var repeated=new Bitmap(rect.Width*4+40,rect.Height+40)) {
          using(var g=Graphics.FromImage(repeated)){g.Clear(Color.White);for(int n=0;n<4;n++)g.DrawImage(bitmap,new Rectangle(20+n*rect.Width,20,rect.Width,rect.Height),rect,GraphicsUnit.Pixel);}
          using(var output=new MemoryStream()){repeated.Save(output,ImageFormat.Png);return Convert.ToBase64String(output.ToArray());}
        }
      }
    }
    static void WalkAccessible(IAccessible a,object child,string path,int depth,POINT origin,Info i,List<AccessibleControl> rows) {
      if(depth>10||rows.Count>=200)return;
      try {
        int role=Convert.ToInt32(a.get_accRole(child));int left,top,width,height;a.accLocation(out left,out top,out width,out height,child);
        if(role==42||role==43)rows.Add(new AccessibleControl{name=a.get_accName(child),value=a.get_accValue(child),action=a.get_accDefaultAction(child),role=role,path=path,x=(left-origin.x)/(double)i.width,y=(top-origin.y)/(double)i.height,width=width/(double)i.width,height=height/(double)i.height});
        if(!Object.Equals(child,0))return;
        int count=Math.Min(250,a.accChildCount);if(count<=0)return;var children=new object[count];int got;
        if(AccessibleChildren(a,0,count,children,out got)!=0)return;
        for(int n=0;n<got;n++) {var nested=children[n] as IAccessible;if(nested!=null)WalkAccessible(nested,0,path+"/"+n,depth+1,origin,i,rows);else if(children[n] is int)WalkAccessible(a,children[n],path+"/#"+children[n],depth+1,origin,i,rows);}
      }catch{}
    }
    public static Calibration Calibrate(string h,int pid,string name,string start,double ix,double iy,double bx,double by) {
      Dpi();var i=Validate(h,pid,name,start);var input=At(i,ix,iy,ControlType.Edit);Writable(input);
      var button=At(i,bx,by,ControlType.Button);object invoke;
      if(!button.TryGetCurrentPattern(InvokePattern.Pattern,out invoke))throw new Exception("SEND_UNSUPPORTED: 发送按钮没有可验证的调用接口");
      if(!System.Text.RegularExpressions.Regex.IsMatch(button.Current.Name??"","^(发送|发言|Send)([\\s（(].*)?$",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new Exception("SEND_LABEL: 选中的按钮不是发送/发言按钮");
      return new Calibration{input=Describe(input,i),button=Describe(button,i),width=i.width,height=i.height,dpi=i.dpi};
    }
    public static Receipt Send(string h,int pid,string name,string start,int width,int height,int dpi,double ix,double iy,double bx,double by,string inputId,string buttonId,string text) {
      Dpi();var i=Validate(h,pid,name,start);
      if(i.width!=width||i.height!=height||i.dpi!=dpi)throw new Exception("LAYOUT_CHANGED: 窗口尺寸或缩放已变化，请重新校准");
      var cal=Calibrate(h,pid,name,start,ix,iy,bx,by);
      if(cal.input.runtimeId!=inputId||cal.button.runtimeId!=buttonId)throw new Exception("CONTROL_CHANGED: 评论控件已变化，请重新校准");
      var input=At(i,ix,iy,ControlType.Edit);var field=Writable(input);
      if(!String.IsNullOrWhiteSpace(field.Current.Value))throw new Exception("INPUT_BUSY: 评论输入框已有内容，保留原稿并停发");
      var button=At(i,bx,by,ControlType.Button);object iv;
      if(!button.TryGetCurrentPattern(InvokePattern.Pattern,out iv))throw new Exception("SEND_DISABLED: 发送按钮接口不可用");
      field.SetValue(text);
      if(field.Current.Value!=text)throw new Exception("INPUT_MISMATCH: 写入内容无法核对；已停止，未点击发送");
      for(int n=0;n<10&&!button.Current.IsEnabled;n++)Thread.Sleep(100);
      if(!button.Current.IsEnabled)throw new Exception("SEND_DISABLED: 已填入文字，但发送按钮仍不可用；未点击发送");
      // The operator may edit the draft or change the layout while the button becomes enabled.
      var latest=Validate(h,pid,name,start);
      if(latest.width!=width||latest.height!=height||latest.dpi!=dpi)throw new Exception("LAYOUT_CHANGED: 发送前窗口布局已改变；未点击发送");
      var latestInput=At(latest,ix,iy,ControlType.Edit);var latestButton=At(latest,bx,by,ControlType.Button);
      if(Runtime(latestInput)!=inputId||Runtime(latestButton)!=buttonId)throw new Exception("CONTROL_CHANGED: 发送前控件已改变；未点击发送");
      if(Writable(latestInput).Current.Value!=text)throw new Exception("INPUT_MISMATCH: 发送前文字已被修改，保留当前内容；未点击发送");
      if(!latestButton.Current.IsEnabled||!latestButton.TryGetCurrentPattern(InvokePattern.Pattern,out iv))throw new Exception("SEND_DISABLED: 发送前按钮已不可用；未点击发送");
      try { ((InvokePattern)iv).Invoke(); } catch {return new Receipt{state="unknown",message="发送调用结果未知，禁止自动重试；请检查直播间"};}
      for(int n=0;n<12;n++){Thread.Sleep(100);try{if(String.IsNullOrEmpty(field.Current.Value))return new Receipt{state="input-cleared",message="已调用直播软件发送，输入框已清空；未获得平台服务器回执"};}catch{break;}}
      return new Receipt{state="unknown",message="已调用发送但未观察到输入框清空，禁止自动重试；请检查直播间"};
    }
  }
}
