using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using Windows.Foundation;
using Windows.Graphics.DirectX;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;

namespace LiveComments {
  public class PixelFrame { public byte[] pixels; public int width,height; }
  // Win32/WinRT interop follows Microsoft's Windows.UI.Composition-Win32-Samples.
  // Only CreateForWindow is exposed: this helper never accepts a monitor or desktop target.
  public static class CaptureInterop {
    [ComImport,Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IGraphicsCaptureItemInterop {
      IntPtr CreateForWindow(IntPtr window,ref Guid iid);
      IntPtr CreateForMonitor(IntPtr monitor,ref Guid iid);
    }
    [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter,int driver,IntPtr software,uint flags,IntPtr levels,uint count,uint sdk,out IntPtr device,out int level,out IntPtr context);
    [DllImport("d3d11.dll",ExactSpelling=true)] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgi,out IntPtr device);
    public static GraphicsCaptureItem Item(Type runtimeType,long hwnd) {
      var factory=WindowsRuntimeMarshal.GetActivationFactory(runtimeType);
      var interop=(IGraphicsCaptureItemInterop)factory;
      var iid=new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
      IntPtr p=interop.CreateForWindow(new IntPtr(hwnd),ref iid);
      try{return (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(p);}finally{Marshal.Release(p);}
    }
    public static IDirect3DDevice Device() {
      IntPtr device=IntPtr.Zero,context=IntPtr.Zero,dxgi=IntPtr.Zero,rt=IntPtr.Zero;int level;
      try {
        int hr=D3D11CreateDevice(IntPtr.Zero,1,IntPtr.Zero,0x20,IntPtr.Zero,0,7,out device,out level,out context);
        Marshal.ThrowExceptionForHR(hr);
        var iid=new Guid("54EC77FA-1377-44E6-8C32-88FD5F44C84C");
        Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device,ref iid,out dxgi));
        Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi,out rt));
        return (IDirect3DDevice)Marshal.GetObjectForIUnknown(rt);
      } finally {
        if(rt!=IntPtr.Zero)Marshal.Release(rt);if(dxgi!=IntPtr.Zero)Marshal.Release(dxgi);
        if(context!=IntPtr.Zero)Marshal.Release(context);if(device!=IntPtr.Zero)Marshal.Release(device);
      }
    }
    public static PixelFrame Grab(long hwnd) {
      if(!GraphicsCaptureSession.IsSupported())throw new Exception("WGC_UNAVAILABLE: Windows 窗口采集不可用");
      var item=Item(typeof(GraphicsCaptureItem),hwnd);var size=item.Size;
      if(size.Width<=0||size.Height<=0||size.Width>8192||size.Height>8192||(long)size.Width*size.Height>20000000)throw new Exception("CAPTURE_SIZE: 窗口采集尺寸无效");
      using(var device=Device())
      using(var pool=Direct3D11CaptureFramePool.CreateFreeThreaded(device,DirectXPixelFormat.B8G8R8A8UIntNormalized,2,size))
      using(var session=pool.CreateCaptureSession(item)) {
        session.StartCapture();Direct3D11CaptureFrame frame=null;
        for(int n=0;n<50;n++){frame=pool.TryGetNextFrame();if(frame!=null)break;Thread.Sleep(100);}
        if(frame==null)throw new Exception("CAPTURE_TIMEOUT: Windows 没有返回所选窗口画面");
        using(frame) {
          if(frame.ContentSize.Width!=size.Width||frame.ContentSize.Height!=size.Height)throw new Exception("LAYOUT_CHANGED: 采集期间窗口尺寸变化");
          var copy=SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface);
          for(int n=0;n<500&&copy.Status==AsyncStatus.Started;n++)Thread.Sleep(20);
          if(copy.Status==AsyncStatus.Started){copy.Cancel();throw new Exception("CAPTURE_TIMEOUT: 采集帧复制超时");}
          using(var bitmap=copy.GetResults()) {
            var pixels=new byte[bitmap.PixelWidth*bitmap.PixelHeight*4];
            var buffer=new Windows.Storage.Streams.Buffer((uint)pixels.Length);bitmap.CopyToBuffer(buffer);
            using(var reader=DataReader.FromBuffer(buffer))reader.ReadBytes(pixels);
            return new PixelFrame{pixels=pixels,width=bitmap.PixelWidth,height=bitmap.PixelHeight};
          }
        }
      }
    }
  }
}
