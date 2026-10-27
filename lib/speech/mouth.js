/**
 * Reads what the pet itself said out of the event store and speaks it, one line at a time.
 *
 * This is the half of the standalone read-aloud extension that actually makes noise: it follows
 * `desktop-pet.self` events the same way, from the newest cursor at attach time (so switching the
 * world on never replays yesterday's lines), through a serial chain (so two lines never overlap)
 * with an epoch that drops queued lines when the operator asks for silence.
 */
import {speakable} from './clean.js'
import {resolveSpeak} from './settings.js'
import {Speaker} from './speaker.js'

export const SELF_TYPE='desktop-pet.self'
/** How often the store is polled for new pet lines. */
export const SCAN_MS=1500
/** How many events one scan may read; a long backlog drains over several scans instead of one burst. */
const SCAN_LIMIT=50

/** The speakable text of one pet event: its beats for a statement, the question and its options for a prompt. */
export function lineOf(event,readOptions=true){
  if(event?.type!==SELF_TYPE)return ''
  const meta=event?.meta
  if(!meta)return ''
  if(meta.kind==='say'){
    const beats=Array.isArray(meta.beats)?meta.beats:[]
    const text=beats.map(b=>typeof b==='string'?b:(typeof b?.text==='string'?b.text:'')).filter(Boolean).join('。 ')
    return speakable(text)
  }
  if(meta.kind==='ask'){
    const question=typeof meta.question==='string'?meta.question:''
    const options=Array.isArray(meta.options)
      ?meta.options.map(o=>typeof o==='string'?o:(typeof o?.label==='string'?o.label:'')).filter(Boolean)
      :[]
    if(!question)return ''
    return speakable(readOptions===false?question:`${question}${options.length?`（${options.join('、')}）`:''}`)
  }
  return ''
}

export class SpeechMouth {
  constructor({speaker}={}){
    this.speaker=speaker||new Speaker()
    this.host=null
    this.cursor=0
    this.timer=null
    this.armed=false
    this.chain=Promise.resolve()
    this.epoch=0
    this.queued=0
    this.speaking=false
    this.lastLine=''
    this.lastSpokeAt=0
    this.lastError=''
    this.config=()=>({})
    this.deviceOf=null
  }

  /** Starts following the store. `shouldSpeak` is asked per line, so a config change takes effect without a restart. */
  start(host,{shouldSpeak,config,deviceOf}={}){
    this.stop()
    this.host=host
    this.cursor=host?.store?.latestCursor?.()||0
    this.armed=true
    if(typeof shouldSpeak==='function')this.shouldSpeak=shouldSpeak
    if(typeof config==='function')this.config=config
    if(typeof deviceOf==='function')this.deviceOf=deviceOf
    const log=line=>host?.log?.info?.(line)
    this.scan()
    this.timer=setInterval(()=>this.scan(),SCAN_MS)
    this.timer.unref?.()
    log?.('直播互动语音朗读已就绪')
  }

  stop(){
    if(this.timer)clearInterval(this.timer)
    this.timer=null
    this.hush()
    this.armed=false
    this.host=null
    return this.speaker.stop()
  }

  shouldSpeak(){
    return false
  }

  log(line){
    this.host?.log?.info?.(line)
  }

  /** Reads new pet lines; the cursor advances even when silent, so lines spoken while muted are not replayed later. */
  scan(){
    if(!this.host?.store?.range)return
    let events=[]
    try{
      events=this.host.store.range({fromCursor:this.cursor+1,limit:SCAN_LIMIT})
    }catch(err){
      this.lastError=`读取桌宠对话失败：${err instanceof Error?err.message:String(err)}`
      return
    }
    for(const event of events){
      const cursor=Number(event?.cursor)||0
      if(cursor>this.cursor)this.cursor=cursor
      if(event?.type!==SELF_TYPE)continue
      if(this.config()?.ttsEnabled===false)continue
      if(!this.armed||!this.shouldSpeak())continue
      const line=lineOf(event,this.config()?.readOptions!==false)
      if(line)this.enqueue(line)
    }
  }

  /** Queues one line behind whatever is speaking; the epoch from this moment decides whether it survives a hush. */
  enqueue(line){
    if(!this.armed)return
    const epoch=this.epoch
    this.queued++
    this.chain=this.chain.then(async()=>{
      this.queued=Math.max(0,this.queued-1)
      if(epoch!==this.epoch)return
      await this.speak(line)
    }).catch(err=>{
      this.queued=Math.max(0,this.queued-1)
      this.lastError=err instanceof Error?err.message:String(err)
    })
  }

  /** Speaks one line now, outside the queue: the panel's 试听 button, and nothing the model can reach. */
  async speakNow(text){
    const line=speakable(text)
    if(!line)throw new Error('没有可朗读的文字')
    const spoken=await this.speak(line)
    return {...this.status(),spoken}
  }

  async speak(line){
    const opts=resolveSpeak(this.config())
    if(typeof this.deviceOf==='function')opts.device=this.deviceOf(opts.device)
    this.speaking=true
    this.lastLine=line.slice(0,60)
    this.log(`朗读：${this.lastLine}`)
    try{
      const ok=await this.speaker.speak(line,opts,detail=>this.log(detail))
      if(ok){
        this.lastSpokeAt=Date.now()
        this.lastError=''
      }else{
        this.lastError=this.speaker.lastError||this.speaker.loadError||'朗读未完成'
      }
      return ok
    }catch(err){
      this.lastError=`朗读失败：${err instanceof Error?err.message:String(err)}`
      return false
    }finally{
      this.speaking=false
    }
  }

  /** Cuts the current clip and drops everything queued. */
  hush(){
    this.epoch++
    this.queued=0
    this.speaking=false
    this.speaker.hush()
  }

  status(){
    const cfg=this.config()||{}
    const speak=resolveSpeak(cfg)
    return {
      armed:this.armed,
      speaking:this.speaking,
      queued:this.queued,
      lastLine:this.lastLine,
      lastSpokeAt:this.lastSpokeAt,
      lastError:this.lastError||this.speaker.loadError,
      engineError:this.speaker.loadError,
      voice:speak.voice,
      rate:speak.rate,
      pitch:speak.pitch,
      volume:speak.volume,
      device:this.speaker.device,
      deviceWanted:speak.device,
      playerError:this.speaker.nativeError,
    }
  }
}
