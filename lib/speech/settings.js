/**
 * The read-aloud settings this extension owns: defaults, how the stored values become one
 * Edge TTS request, and the config group the panel renders.
 */
import {CUSTOM_PRESET,DEFAULT_VOICE,PITCH_OPTIONS,RATE_OPTIONS,VOICE_OPTIONS,VOICE_PRESETS,VOLUME_OPTIONS} from './voices.js'

/** The defaults live in the world's `defaults()`, so Coopanion writes them into config.json and the panel shows a value instead of an empty field. */
export const SPEECH_DEFAULTS={ttsEnabled:true,selfSpeak:'auto',preset:CUSTOM_PRESET,voice:DEFAULT_VOICE,rate:'+0%',pitch:'+0Hz',volume:'+0%',readOptions:true,outputDevice:''}

/** `auto` speaks only while no other voice route is active, so a second reader cannot talk over this one. */
export const SPEECH_MODES=['auto','on','off']
export const MODE_OPTIONS=[
  {value:'auto',label:'自动 · 没有其他朗读插件时才发声'},
  {value:'on',label:'总是 · 由本插件朗读'},
  {value:'off',label:'关闭 · 本插件不发声'},
]

export const VOICE_OPTIONS_KIND='livecom.voices'
export const PRESET_OPTIONS_KIND='livecom.presets'
export const MODE_OPTIONS_KIND='livecom.modes'
export const DEVICE_OPTIONS_KIND='livecom.devices'

/** The system default is always listable; the real devices are filled in by `invoke('devices')`. */
const DEFAULT_DEVICE_ROW={value:'',label:'系统默认设备'}
let deviceRows=[DEFAULT_DEVICE_ROW]

/** Remembers the device list read from the machine, so the config field can offer it as a dropdown. */
export function setDeviceRows(rows){
  const list=(Array.isArray(rows)?rows:[])
    .map(row=>({value:String(row?.name??row?.value??''),label:String(row?.label??row?.name??row?.value??'')}))
    .filter(row=>row.value)
  deviceRows=[DEFAULT_DEVICE_ROW,...list]
  return deviceRows.slice()
}

export function deviceOptionRows(){
  return deviceRows.slice()
}

const text=v=>typeof v==='string'?v:''
const oneOf=(list,value)=>list.includes(value)?value:''
/** An unknown ShortName makes the service reject the whole request, so a stale config value falls back instead. */
const knownVoice=value=>VOICE_OPTIONS.some(option=>option.id===value)?value:DEFAULT_VOICE

/** The configured mode, defaulting to `auto` for a config written before this option existed. */
export function speechMode(cfg){
  const mode=text(cfg?.selfSpeak)
  return SPEECH_MODES.includes(mode)?mode:'auto'
}

/** The voice, rate, volume and pitch one line is synthesised with: a known preset wins, otherwise the single fields. */
export function resolveSpeak(cfg){
  const preset=VOICE_PRESETS.find(p=>p.id===text(cfg?.preset))
  if(preset)return {voice:preset.voice,rate:preset.rate,volume:preset.volume,pitch:preset.pitch,device:text(cfg?.outputDevice)}
  return {
    voice:knownVoice(text(cfg?.voice)),
    rate:oneOf(RATE_OPTIONS,text(cfg?.rate))||'+0%',
    pitch:oneOf(PITCH_OPTIONS,text(cfg?.pitch))||'+0Hz',
    volume:oneOf(VOLUME_OPTIONS,text(cfg?.volume))||'+0%',
    device:text(cfg?.outputDevice),
  }
}

/** The rows the config UI lists for the voice / preset / mode option sources. */
export function voiceOptionRows(){
  return VOICE_OPTIONS.map(v=>({value:v.id,label:v.label}))
}

export function presetOptionRows(){
  return [{value:CUSTOM_PRESET,label:'自定义 · 用下面的音色/语速/音高/音量'},...VOICE_PRESETS.map(p=>({value:p.id,label:p.label}))]
}

export function modeOptionRows(){
  return MODE_OPTIONS.slice()
}

/** The option source the host asks for when the panel opens a list; unknown kinds answer empty. */
export function configOptions(kind){
  if(kind===VOICE_OPTIONS_KIND)return voiceOptionRows()
  if(kind===PRESET_OPTIONS_KIND)return presetOptionRows()
  if(kind===MODE_OPTIONS_KIND)return modeOptionRows()
  if(kind===DEVICE_OPTIONS_KIND)return deviceOptionRows()
  return []
}

const property=extra=>({type:'string','x-hot':true,...extra})

/** The config group for the panel: one section, every change taking effect on the next line. */
export function speechConfigGroups(id='live-comments'){
  return [{
    id:`world:${id}.voice`,
    owner:`world:${id}`,
    schema:{
      type:'object',
      title:'语音朗读（自带引擎）',
      description:'Edge 在线语音，与大肥鱼同一引擎但独立安装：停用或卸载大肥鱼后仍可发声。改完立即生效。',
      properties:{
        [`worlds.${id}.ttsEnabled`]:{type:'boolean',title:'朗读桌宠的话','x-hot':true,description:'关掉后本插件完全不出声，评论回复仍显示在 Coo 对话里。'},
        [`worlds.${id}.selfSpeak`]:property({title:'本插件朗读',description:'自动：检测到大肥鱼或旧语音插件在朗读时让位，避免两路声音重叠。','x-options':MODE_OPTIONS_KIND}),
        [`worlds.${id}.preset`]:property({title:'语音包',description:'选一个成套的音色与语调，或选自定义后逐项设置。','x-options':PRESET_OPTIONS_KIND}),
        [`worlds.${id}.voice`]:property({title:'音色',description:'语音包为自定义时生效。','x-options':VOICE_OPTIONS_KIND}),
        [`worlds.${id}.rate`]:property({title:'语速',enum:RATE_OPTIONS.slice()}),
        [`worlds.${id}.pitch`]:property({title:'音高',enum:PITCH_OPTIONS.slice()}),
        [`worlds.${id}.volume`]:property({title:'音量',enum:VOLUME_OPTIONS.slice()}),
        [`worlds.${id}.outputDevice`]:property({title:'播放设备',description:'选虚拟扬声器（LegionZone 虚拟扬声器 / VB-CABLE / VoiceMeeter），直播软件的麦克风再选配对的虚拟麦克风，声音就会被当成你的麦克风。留空用系统默认设备。','x-options':DEVICE_OPTIONS_KIND}),
        [`worlds.${id}.readOptions`]:{type:'boolean',title:'朗读选项','x-hot':true,description:'桌宠提问时把候选项一起念出来。'},
      },
    },
  }]
}
