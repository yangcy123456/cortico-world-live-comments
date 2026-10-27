/**
 * The mouth of this extension: one line of text in, one spoken clip out.
 *
 * Synthesis goes through the vendored Edge TTS client in vendor/msedge-tts, whose WebSocket is
 * reused across lines. Playback has two ways out on Windows: the native waveOut player (compiled
 * from lib/voiceplay.cs on first use) which can play into a *chosen* device — the point of picking
 * a virtual speaker so the streaming app records the voice as a microphone — and, when that is
 * unavailable, winmm MCI through PowerShell, which only reaches the system default device. macOS
 * uses the built-in `afplay`. Either way the child's exit is the end of the speech, and a new line
 * kills the child still speaking, the way Coo starting a new sentence cuts the previous one short.
 *
 * Unlike the pack this was copied from, a missing engine, a missing `ws` build or a missing decoder
 * is recorded and logged rather than thrown at import time: the comment panel must keep working on
 * a machine where speech is broken.
 */
import {spawn} from 'node:child_process'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mp3ToWav} from './audio/decode.js'
import {audioDir,playWavFile} from './audio/native.js'

const MP3='audio-24khz-48kbitrate-mono-mp3'
/** After a failed synthesis the next attempts inside this window are skipped, so a rate limit or a dropped link does not spam the log. */
const COOLDOWN_MS=10_000
/** How many times one line is tried: a dropped link is worth one fresh connection before the line is skipped. */
const ATTEMPTS=2
/** The pause before that retry, long enough for a half-open socket to be gone. */
const RETRY_DELAY_MS=400

/** The vendored engine, resolved on the first line instead of at import, so a broken engine never blocks the panel. */
const ENGINE_SPEC='../../vendor/msedge-tts/index.ts'

export class Speaker {
  constructor(){
    this.engine=null
    this.tts=null
    this.metadataKey=''
    this.player=null
    this.controller=null
    this.stage=null
    this.failedAt=0
    this.warnedPlatform=false
    this.loadError=''
    this.lastError=''
    this.nativeError=''
    this.device=''
  }

  /** One line spoken aloud; resolves when playback ends or is cut. `false` means synthesis failed and the line was skipped. */
  async speak(text,opts,log=()=>{}){
    if(process.platform!=='win32'&&process.platform!=='darwin'){
      if(!this.warnedPlatform){this.warnedPlatform=true;log(`TTS playback needs Windows or macOS; skipping on ${process.platform}`)}
      return false
    }
    if(Date.now()-this.failedAt<COOLDOWN_MS)return false
    const clip=await this.synthesise(text,opts,log)
    if(!clip)return false
    await this.play(clip,log,opts)
    await rm(clip,{force:true}).catch(()=>{})
    this.lastError=''
    log(`朗读完成：${String(text).slice(0,20)}${this.device?`（${this.device}）`:''}`)
    return true
  }

  /** Stops the clip in play, if any. */
  hush(){
    try{this.controller?.abort()}catch{}
    this.controller=null
    this.player?.kill()
    this.player=null
  }

  async stop(){
    this.hush()
    this.release()
    if(this.stage){
      await rm(this.stage,{recursive:true,force:true}).catch(()=>{})
      this.stage=null
    }
  }

  /** Drops the TTS client; the next line dials a fresh socket instead of reusing a broken one. */
  release(){
    try{this.tts?.close()}catch{}
    this.tts=null
    this.metadataKey=''
  }

  /** The vendored module, imported once; a failure is remembered so the log names the cause on every attempt. */
  async module(log){
    if(this.engine)return this.engine
    if(this.loadError){log(this.loadError);return null}
    try{
      this.engine=await import(ENGINE_SPEC)
      this.loadError=''
      return this.engine
    }catch(err){
      this.loadError=`语音引擎无法加载：${err instanceof Error?err.message:String(err)}`
      this.lastError=this.loadError
      log(this.loadError)
      return null
    }
  }

  /** One mp3 out of one line; the WebSocket is kept across lines and re-inited only when the voice settings change. */
  async synthesise(text,opts,log){
    const mod=await this.module(log)
    if(!mod)return null
    const {MsEdgeTTS,OUTPUT_FORMAT}=mod
    const key=[opts.voice,opts.rate,opts.volume,opts.pitch].join('|')
    for(let attempt=1;attempt<=ATTEMPTS;attempt++){
      try{
        this.tts??=new MsEdgeTTS({enableLogger:false})
        if(key!==this.metadataKey){
          await this.tts.setMetadata(opts.voice,OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3??MP3)
          this.metadataKey=key
        }
        this.stage??=await mkdtemp(join(tmpdir(),'livecom-tts-'))
        const {audioFilePath}=await this.tts.toFile(this.stage,text,{rate:opts.rate,volume:opts.volume,pitch:opts.pitch})
        return audioFilePath
      }catch(err){
        // A connection that timed out or dropped is not reused: the retry gets a new socket, so a
        // lost first connection costs one more try instead of silence until the world restarts.
        this.release()
        if(attempt===ATTEMPTS){
          this.failedAt=Date.now()
          this.lastError=`朗读合成失败：${err instanceof Error?err.message:String(err)}`
          log(this.lastError)
          return null
        }
        await new Promise(done=>setTimeout(done,RETRY_DELAY_MS))
      }
    }
    return null
  }

  /**
   * Plays one clip. On Windows the native player goes first so the sound can leave through the
   * device the operator picked; if the decoder, the compiler or the device is missing, the clip
   * still plays through the default device instead of going silent.
   */
  async play(clip,log,opts={}){
    this.hush()
    if(process.platform==='darwin'){
      // afplay ships with macOS and, like MCI's `play … wait`, blocks until the clip ends.
      return this.playChild(spawn('afplay',[clip],{stdio:'ignore'}),log)
    }
    const controller=new AbortController()
    this.controller=controller
    const device=String(opts.device??'')
    try{
      const wav=await this.toWav(clip)
      if(wav){
        try{
          const info=await playWavFile(wav,{device,volume:1,signal:controller.signal})
          this.nativeError=''
          this.device=info.device||device
          return {device:this.device}
        }finally{
          await rm(wav,{force:true}).catch(()=>{})
        }
      }
    }catch(err){
      if(err?.cancelled){
        this.device=''
        return {device:''}
      }
      this.nativeError=err instanceof Error?err.message:String(err)
      log(`原生播放器不可用，改用系统默认设备：${this.nativeError}`)
    }finally{
      if(this.controller===controller)this.controller=null
    }
    await this.playMci(clip,log)
    this.device=''
    return {device:''}
  }

  /** The clip as a WAV the native player can hand to waveOut; `null` when decoding is unavailable. */
  async toWav(clip){
    const bytes=await readFile(clip)
    const decoded=await mp3ToWav(bytes)
    const file=join(audioDir(),`clip-${Date.now()}-${Math.random().toString(36).slice(2,8)}.wav`)
    await writeFile(file,decoded.bytes)
    return file
  }

  /** The fallback: winmm MCI through PowerShell, which only reaches the system default device. */
  playMci(clip,log){
    const quoted=`"${clip}"`
    const script=[
      "Add-Type -Namespace WinMM -Name MCI -MemberDefinition '[DllImport(\"winmm.dll\", CharSet=CharSet.Auto)] public static extern int mciSendString(string cmd, System.Text.StringBuilder ret, int len, System.IntPtr hwnd);'",
      `[WinMM.MCI]::mciSendString('open ${quoted} type mpegvideo alias tts', $null, 0, [System.IntPtr]::Zero) | Out-Null`,
      "[WinMM.MCI]::mciSendString('play tts wait', $null, 0, [System.IntPtr]::Zero) | Out-Null",
      "[WinMM.MCI]::mciSendString('close tts', $null, 0, [System.IntPtr]::Zero) | Out-Null",
    ].join('; ')
    return this.playChild(spawn('powershell',['-NoProfile','-Command',script],{stdio:'ignore',windowsHide:true}),log)
  }

  /** Resolves when the player child exits; killing it is the interruption. */
  playChild(child,log){
    return new Promise(resolve=>{
      this.player=child
      child.once('exit',code=>{
        if(this.player===child)this.player=null
        if(code)log(`TTS player exited with ${code}`)
        resolve({device:this.device})
      })
      child.once('error',err=>{
        this.lastError=`播放失败：${err.message}`
        log(this.lastError)
        if(this.player===child)this.player=null
        resolve({device:''})
      })
    })
  }
}
