$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class LiveFixture : Form {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int ht,uint flags);
  protected override bool ShowWithoutActivation { get { return true; } }
  public static void Run() {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var f=new LiveFixture();f.Text="LiveCommentsFixture_"+Environment.GetEnvironmentVariable("LIVEWIN_FIXTURE_ID");
    f.StartPosition=FormStartPosition.Manual;f.Location=new Point(20,20);f.ClientSize=new Size(1000,650);f.AutoScaleMode=AutoScaleMode.None;f.ShowInTaskbar=false;f.BackColor=Color.White;
    var label=new Label{Left=570,Top=100,Width=410,Height=240,Text="\u89c2\u4f17\u7532\uff1a\u4f60\u597d\uff0c\u5927\u80a5\u9c7c\n\u89c2\u4f17\u4e59\uff1a\u4eca\u5929\u73a9\u4ec0\u4e48",Font=new Font("Microsoft YaHei",18),ForeColor=Color.Black};
    var input=new TextBox{Left=570,Top=530,Width=290,Height=40,Text=Environment.GetEnvironmentVariable("LIVEWIN_FIXTURE_DRAFT")??"",AccessibleName="Comment input",Multiline=false};
    var send=new Button{Left=870,Top=530,Width=100,Height=40,Text="\u53d1\u9001",AccessibleName="\u53d1\u9001"};
    if(Environment.GetEnvironmentVariable("LIVEWIN_FIXTURE_EDIT")=="1") {
      send.Enabled=false;var timer=new System.Windows.Forms.Timer{Interval=200};
      input.TextChanged+=(s,e)=>{if(!send.Enabled)timer.Start();};
      timer.Tick+=(s,e)=>{timer.Stop();send.Enabled=true;input.Text="operator changed draft";};
    }
    send.Click+=(s,e)=>{File.AppendAllText(Environment.GetEnvironmentVariable("LIVEWIN_FIXTURE_OUT"),input.Text+"\n");if(Environment.GetEnvironmentVariable("LIVEWIN_FIXTURE_KEEP")!="1")input.Clear();};
    f.Controls.Add(label);f.Controls.Add(input);f.Controls.Add(send);f.Shown+=(s,e)=>{SetWindowPos(f.Handle,new IntPtr(1),0,0,0,0,0x13);Console.WriteLine("HWND="+f.Handle.ToInt64());};Application.Run(f);
  }
}
'@
[LiveFixture]::Run()
