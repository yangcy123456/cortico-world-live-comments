/**
 * The native player: compiles lib/voiceplay.cs into an exe on first use (csc, about a second),
 * then plays one WAV to a chosen output device and exits when the clip ends.
 *
 * Why not PowerShell's WPF MediaPlayer: it only plays to the system default device, so it cannot
 * feed a virtual speaker, and a virtual speaker is exactly how the streaming app records the
 * voice as a microphone. waveOut is what lets us pick the device.
 *
 * Copied from the standalone voice extension (cortico-world-voice) so this extension keeps its
 * own device picker even with that extension removed.
 */
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,statSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

export const IS_WINDOWS=process.platform==='win32'

const SOURCE_PATH=fileURLToPath(new URL('./voiceplay.cs',import.meta.url))
const CSC_CANDIDATES=[
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]

/** Where the compiled exe and the temporary WAV files live. */
export function audioDir(){
  return join(tmpdir(),'livecom-audio')
}

function sourceHash(){
  try{
    return createHash('sha1').update(readFileSync(SOURCE_PATH)).digest('hex').slice(0,10)
  }catch{
    return 'nogit'
  }
}

function exePath(){
  return join(audioDir(),'bin',`voiceplay-${sourceHash()}.exe`)
}

function pickCsc(){
  for(const candidate of CSC_CANDIDATES){
    if(existsSync(candidate))return candidate
  }
  return 'csc.exe'
}

/**
 * The device a setting refers to: empty means the system default, a number is the waveOut index,
 * anything else is a case-insensitive part of the device name. `''` is returned for a no-match so
 * playback falls back to the default device instead of failing.
 */
export function pickDevice(devices, want){
  const list=Array.isArray(devices)?devices:[]
  const value=String(want??'').trim()
  if(!value)return ''
  if(/^\d+$/.test(value)){
    const hit=list.find(d=>String(d?.index)===value)
    return hit?String(hit.name??''):''
  }
  const needle=value.toLowerCase()
  const exact=list.find(d=>String(d?.name??'').toLowerCase()===needle)
  if(exact)return String(exact.name??'')
  const partial=list.find(d=>String(d?.name??'').toLowerCase().includes(needle))
  return partial?String(partial.name??''):''
}

function run(command,args,options={}){
  return new Promise((resolve,reject)=>{
    let child
    try{
      child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']})
    }catch(err){
      reject(err)
      return
    }
    let stdout=''
    let stderr=''
    const timer=options.timeoutMs?setTimeout(()=>{try{child.kill()}catch{}},options.timeoutMs):null
    child.stdout?.on('data',chunk=>{stdout+=chunk})
    child.stderr?.on('data',chunk=>{stderr+=chunk})
    const onAbort=()=>{try{child.kill()}catch{}}
    options.signal?.addEventListener('abort',onAbort,{once:true})
    child.once('error',err=>{
      if(timer)clearTimeout(timer)
      options.signal?.removeEventListener('abort',onAbort)
      reject(err)
    })
    child.once('close',code=>{
      if(timer)clearTimeout(timer)
      options.signal?.removeEventListener('abort',onAbort)
      if(options.signal?.aborted){
        const err=new Error('已取消')
        err.cancelled=true
        reject(err)
        return
      }
      resolve({code,stdout,stderr})
    })
  })
}

let ensurePromise=null

/** Compiles the player once per source revision and returns the exe path. */
export function ensurePlayer(){
  if(!IS_WINDOWS)return Promise.reject(new Error('原生播放器只支持 Windows'))
  const target=exePath()
  if(existsSync(target))return Promise.resolve(target)
  if(!ensurePromise){
    ensurePromise=(async()=>{
      mkdirSync(dirname(target),{recursive:true})
      const csc=pickCsc()
      const result=await run(csc,['/nologo','/target:exe',`/out:${target}`,SOURCE_PATH],{timeoutMs:120_000})
      if(result.code!==0||!existsSync(target)){
        throw new Error(`编译原生播放器失败：${(result.stderr||result.stdout||'').trim().slice(0,400)}`)
      }
      return target
    })().catch(err=>{
      ensurePromise=null
      throw err
    })
  }
  return ensurePromise
}

/** Every output device, as [{index, name}]. */
export async function listOutputDevices(){
  if(!IS_WINDOWS)return []
  const exe=await ensurePlayer()
  const result=await run(exe,['list'],{timeoutMs:15_000})
  const line=(result.stdout||'').split(/\r?\n/).find(row=>row.trim().startsWith('{'))
  if(!line)throw new Error(`设备列表读取失败：${(result.stderr||'').slice(0,200)}`)
  const parsed=JSON.parse(line)
  return Array.isArray(parsed.outputs)?parsed.outputs:[]
}

/** Plays one WAV to `device`; resolves when the clip ends, and an abort kills it mid-clip. */
export async function playWavFile(file,options={}){
  if(!IS_WINDOWS)throw new Error('原生播放器只支持 Windows')
  const exe=await ensurePlayer()
  const device=String(options.device??'')
  const volume=Math.max(0,Math.min(4,Number(options.volume??1)||1))
  const startedAt=Date.now()
  const result=await run(exe,['play',file,device,String(volume)],{signal:options.signal})
  const line=(result.stdout||'').split(/\r?\n/).find(row=>row.trim().startsWith('{'))
  if(!line)throw new Error(`播放失败：${(result.stderr||result.stdout||'').trim().slice(0,300)}`)
  const parsed=JSON.parse(line)
  if(!parsed.ok)throw new Error(`播放失败：${parsed.error??'未知错误'}`)
  return {ms:Date.now()-startedAt,device:parsed.device??'',seconds:parsed.seconds??0}
}

/** Whether the exe is already compiled (for the panel). */
export function playerReady(){
  try{
    return statSync(exePath()).size>0
  }catch{
    return false
  }
}
