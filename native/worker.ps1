$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing, UIAutomationClient, UIAutomationTypes, WindowsBase, Accessibility
Add-Type -Path (Join-Path $PSScriptRoot 'WindowBridge.cs') -ReferencedAssemblies @('System.dll','System.Core.dll','System.Drawing.dll',[System.Windows.Automation.AutomationElement].Assembly.Location,[System.Windows.Automation.ControlType].Assembly.Location,[System.Windows.Point].Assembly.Location,[Accessibility.IAccessible].Assembly.Location)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Capture.GraphicsCaptureItem, Windows.Graphics.Capture, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Capture.Direct3D11CaptureFramePool, Windows.Graphics.Capture, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Capture.GraphicsCaptureSession, Windows.Graphics.Capture, ContentType=WindowsRuntime]
$null = [Windows.Graphics.DirectX.Direct3D11.IDirect3DDevice, Windows.Graphics.DirectX, ContentType=WindowsRuntime]
$null = [Windows.Graphics.DirectX.DirectXPixelFormat, Windows.Graphics.DirectX, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]
$captureCompiler=New-Object System.CodeDom.Compiler.CompilerParameters
$captureCompiler.GenerateInMemory=$true
foreach ($ref in @('System.dll','System.Core.dll','System.Runtime.WindowsRuntime.dll',([System.Reflection.Assembly]::Load('System.Runtime, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a').Location))) { $null=$captureCompiler.ReferencedAssemblies.Add($ref) }
$captureCompiler.CompilerOptions='/r:"'+(Join-Path $env:SystemRoot 'System32\WinMetadata\Windows.Graphics.winmd')+'" /r:"'+(Join-Path $env:SystemRoot 'System32\WinMetadata\Windows.Foundation.winmd')+'" /r:"'+(Join-Path $env:SystemRoot 'System32\WinMetadata\Windows.Storage.winmd')+'"'
Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CaptureInterop.cs') -Raw -Encoding UTF8) -CompilerParameters $captureCompiler
$script:engine = $null
$script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Result($operation, $resultType) {
  $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(10000)) { throw 'OCR_TIMEOUT: 本地识别超时' }
  return $task.GetAwaiter().GetResult()
}
function Read-Ocr($png,$contrast=$false,$repeat=$false) {
  if ($null -eq $script:engine) {
    $lang = New-Object Windows.Globalization.Language('zh-Hans-CN')
    $script:engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
    if ($null -eq $script:engine) { throw 'OCR_LANGUAGE: 系统缺少简体中文 OCR 语言组件，请在 Windows 语言设置安装后重试' }
  }
  if ($contrast) { $png=[LiveComments.Bridge]::OcrContrast($png) }
  if ($repeat) { $png=[LiveComments.Bridge]::OcrRepeat($png) }
  $bytes = [Convert]::FromBase64String($png)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
  $bitmap = $null
  try {
    $writer.WriteBytes($bytes)
    $null = Await-Result ($writer.StoreAsync()) ([UInt32])
    $null = $writer.DetachStream(); $stream.Seek(0)
    $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-Result ($script:engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $rows = @($result.Lines | ForEach-Object {
      $words = @($_.Words); $rect = $words[0].BoundingRect
      @{text=$_.Text; x=$rect.X; y=$rect.Y; height=$rect.Height}
    })
    return @{ lines=$rows; language=$script:engine.RecognizerLanguage.LanguageTag }
  } finally { if ($null -ne $bitmap) {$bitmap.Dispose()}; $writer.Dispose(); $stream.Dispose() }
}
function Read-WindowFrame($target,$crop,$full) {
  $before=[LiveComments.Bridge]::Validate($target.hwnd,$target.pid,$target.processName,$target.startTime)
  $frame=[LiveComments.CaptureInterop]::Grab([long]$target.hwnd)
  $after=[LiveComments.Bridge]::Validate($target.hwnd,$target.pid,$target.processName,$target.startTime)
  if ($before.width -ne $after.width -or $before.height -ne $after.height -or $before.dpi -ne $after.dpi) { throw 'LAYOUT_CHANGED: 采集期间窗口尺寸/缩放变化' }
  return [LiveComments.Bridge]::FromPixels($target.hwnd,$target.pid,$target.processName,$target.startTime,$frame.pixels,$frame.width,$frame.height,$crop.x,$crop.y,$crop.width,$crop.height,[bool]$full)
}
function Normalize-Text($text) { return (($text.Normalize([Text.NormalizationForm]::FormKC)) -replace '\s','') }
function Read-Input($target,$rect,$button=$false) {
  $shot=Read-WindowFrame $target $rect $false
  $ocr=Read-Ocr $shot.png $button $button
  if (-not $button -and $ocr.lines.Count -eq 0) { $ocr=Read-Ocr $shot.png $true }
  return Normalize-Text (($ocr.lines | ForEach-Object {$_.text}) -join '')
}
function Test-EmptyInput($text) { return $text -match '^(请输入文字|请输入内容|说点什么[.。…]*)$' }
function Check-Background($target,$calibration) {
  $info=[LiveComments.Bridge]::Validate($target.hwnd,$target.pid,$target.processName,$target.startTime)
  $class=[LiveComments.Bridge]::MessageClass($target.hwnd,$target.pid,$target.processName,$target.startTime)
  if ($class -ne $calibration.windowClass -or $info.width -ne $calibration.width -or $info.height -ne $calibration.height -or $info.dpi -ne $calibration.dpi) { throw 'LAYOUT_CHANGED: 窗口或布局已改变，请重新校准' }
  $label=Read-Input $target $calibration.sendRegion $true
  if ($label -notmatch '发送|发言|Send') { throw 'SEND_LABEL: 无法从所选位置核对发送按钮，未点击发送' }
}
function Background-Click($target,$calibration,$point) { [LiveComments.Bridge]::BackgroundClick($target.hwnd,$target.pid,$target.processName,$target.startTime,$calibration.width,$calibration.height,$calibration.dpi,$point.x,$point.y) }
function Background-Text($target,$calibration,$text) { $p=$calibration.points.input;[LiveComments.Bridge]::BackgroundText($target.hwnd,$target.pid,$target.processName,$target.startTime,$calibration.width,$calibration.height,$calibration.dpi,$p.x,$p.y,$text) }
function Background-Reply($target,$calibration,$text,$probe) {
  Check-Background $target $calibration
  if (-not (Test-EmptyInput (Read-Input $target $calibration.inputRegion))) { throw 'INPUT_BUSY: 无法确认原输入框为空；保留原稿，不输入' }
  Background-Click $target $calibration $calibration.points.input
  [Threading.Thread]::Sleep(100)
  Background-Text $target $calibration $text
  $expected=Normalize-Text $text;$actual=''
  for ($n=0;$n -lt 3;$n++) { $actual=Read-Input $target $calibration.inputRegion; if ($actual -eq $expected) {break};[Threading.Thread]::Sleep(150) }
  if ($actual -ne $expected) { throw 'INPUT_MISMATCH: 未能核对后台输入文字，未点击发送；请检查输入框并人工清理' }
  if ($probe) {
    $p=$calibration.points.input
    [LiveComments.Bridge]::BackgroundEraseProbe($target.hwnd,$target.pid,$target.processName,$target.startTime,$calibration.width,$calibration.height,$calibration.dpi,$p.x,$p.y,$text.Length)
    [Threading.Thread]::Sleep(150)
    if (-not (Test-EmptyInput (Read-Input $target $calibration.inputRegion))) { throw 'INPUT_MISMATCH: 验证文字未确认清空，请人工检查；没有发送' }
    return @{state='probe-verified';message='后台输入和清理已验证；没有点击发送或发布评论'}
  }
  Check-Background $target $calibration
  if ((Read-Input $target $calibration.inputRegion) -ne $expected) { throw 'INPUT_MISMATCH: 发送前文字变化，保留当前内容；未点击发送' }
  Background-Click $target $calibration $calibration.points.send
  for ($n=0;$n -lt 3;$n++) { [Threading.Thread]::Sleep(150);if (Test-EmptyInput (Read-Input $target $calibration.inputRegion)) {return @{state='input-cleared';message='已调用原窗口发送并观察到输入框清空；未获得平台服务器回执'}} }
  return @{state='unknown';message='发送结果未知，不自动重试；请检查直播间'}
}
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $a=$request.args; $t=$a.target
    switch ($request.op) {
      'windows' { $result = @{ windows=@([LiveComments.Bridge]::Windows()) }; break }
      'health' { $result=[LiveComments.Bridge]::Health($t.hwnd);break }
      'capture' {
        $c=$a.crop
        $shot=Read-WindowFrame $t $c ([bool]$a.full)
        $result=@{window=$shot.window; png=$shot.png; width=$shot.width; height=$shot.height; variance=$shot.variance; backend=$shot.backend}
        if ($a.ocr) { $result.ocr=Read-Ocr $shot.png ([bool]$a.ocrContrast) ([bool]$a.ocrRepeat) }
        if ($a.ocrPreview) { $result.ocrPreview=[LiveComments.Bridge]::OcrRepeat([LiveComments.Bridge]::OcrContrast($shot.png)) }
        break
      }
      'inspect' { $result=@{controls=@([LiveComments.Bridge]::Inspect($t.hwnd,$t.pid,$t.processName,$t.startTime));accessible=@([LiveComments.Bridge]::InspectAccessible($t.hwnd,$t.pid,$t.processName,$t.startTime))};break }
      'calibrate' {
        $p=$a.points
        try { $result=[LiveComments.Bridge]::Calibrate($t.hwnd,$t.pid,$t.processName,$t.startTime,$p.input.x,$p.input.y,$p.send.x,$p.send.y) }
        catch {
          if ($null -eq $a.inputRegion) { throw 'CONTROL_UNAVAILABLE: 直播姬未提供标准控件；请在预览框选输入文字区域（排除右侧字数和发送），再验证后台发送' }
          $info=[LiveComments.Bridge]::Validate($t.hwnd,$t.pid,$t.processName,$t.startTime)
          $class=[LiveComments.Bridge]::MessageClass($t.hwnd,$t.pid,$t.processName,$t.startTime)
          $send=@{x=[Math]::Max([double]0,[double]($p.send.x-.012));y=[Math]::Max([double]0,[double]($p.send.y-.012));width=.024;height=.024}
          $result=@{mode='window-message';width=$info.width;height=$info.height;dpi=$info.dpi;windowClass=$class;points=$p;inputRegion=$a.inputRegion;sendRegion=$send;probeValidated=$false}
          Check-Background $t $result
          if (-not (Test-EmptyInput (Read-Input $t $a.inputRegion))) {throw 'INPUT_BUSY: 请保持原输入框为空，并把文字区域框到占位文字上；校准不输入、不发送'}
        }
        break
      }
      'probe' { $result=Background-Reply $t $a.calibration '测试' $true;break }
      'clear-probe' {
        $p=$a.points;$l=$a.layout
        $cal=@{width=$l.width;height=$l.height;dpi=$l.dpi;windowClass=[LiveComments.Bridge]::MessageClass($t.hwnd,$t.pid,$t.processName,$t.startTime);points=$p;inputRegion=$a.inputRegion}
        if ((Read-Input $t $cal.inputRegion) -ne '测试') { throw 'INPUT_BUSY: 当前文字不是固定的验证文字“测试”，未清理任何内容' }
        Background-Click $t $cal $p.input
        [LiveComments.Bridge]::BackgroundEraseProbe($t.hwnd,$t.pid,$t.processName,$t.startTime,$cal.width,$cal.height,$cal.dpi,$p.input.x,$p.input.y,2)
        [Threading.Thread]::Sleep(150)
        if (-not (Test-EmptyInput (Read-Input $t $cal.inputRegion))) { throw 'INPUT_MISMATCH: 验证文字未确认清空，请人工检查；没有发送' }
        $result=@{message='已清除固定的验证文字“测试”；没有点击发送'};break
      }
      'send' { $p=$a.points;$c=$a.calibration;if ($c.mode -eq 'window-message') { if (-not $c.probeValidated) {throw 'PROBE_REQUIRED: 先验证后台输入（不会发布）'};$result=Background-Reply $t $c $a.text $false } else { $result=[LiveComments.Bridge]::Send($t.hwnd,$t.pid,$t.processName,$t.startTime,$c.width,$c.height,$c.dpi,$p.input.x,$p.input.y,$p.send.x,$p.send.y,$c.input.runtimeId,$c.button.runtimeId,$a.text) };break }
      default { throw 'METHOD: 不支持的本地操作' }
    }
    [Console]::WriteLine((@{id=$request.id;ok=$true;result=$result}|ConvertTo-Json -Depth 18 -Compress))
  } catch {
    [Console]::WriteLine((@{id=$request.id;ok=$false;error=$_.Exception.GetBaseException().Message}|ConvertTo-Json -Depth 6 -Compress))
  }
}
