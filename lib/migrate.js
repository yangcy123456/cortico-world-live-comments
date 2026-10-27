import {copyFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs'
import {join} from 'node:path'

/**
 * The world used to be called `live-window`. A deployment that already framed its comment area and
 * picked a voice should not have to do it again, so the first start copies that section over once
 * and marks the new section so later edits win.
 */
export const LEGACY_ID='live-window'
/** Bookkeeping key inside our own section: which legacy section was folded in, so it happens once. */
export const MIGRATED_KEY='migratedFrom'

/** The keys worth carrying over: setup, reply policy and the read-aloud settings. */
const CARRY=['target','crop','cropConfirmed','layout','selfNames','pollMs','maxDeliverPerMinute','maxReplyChars','commentMaxAgeMs','weights','ttsEnabled','selfSpeak','preset','voice','rate','pitch','volume','readOptions','outputDevice']

/** Reads `worlds.<id>` out of a config.json; anything unreadable answers `null` instead of throwing. */
export function legacySection(configPath,legacyId=LEGACY_ID){
  try{
    const parsed=JSON.parse(readFileSync(configPath,'utf8'))
    const section=parsed?.worlds?.[legacyId]
    return section&&typeof section==='object'&&!Array.isArray(section)?section:null
  }catch{return null}
}

/**
 * The patch to persist for a legacy section. Only a section that actually carries a window or a
 * saved crop is copied: defaults alone must not overwrite a fresh installation's own defaults.
 */
export function legacyPatch(legacy){
  if(!legacy||typeof legacy!=='object')return {}
  const patch={}
  for(const key of CARRY){
    const value=legacy[key]
    if(value===undefined||value===null)continue
    if(key==='weights'){
      if(typeof value==='object'&&!Array.isArray(value))patch.weights={...value}
      continue
    }
    patch[key]=value
  }
  const framed=patch.cropConfirmed===true||Boolean(patch.target)
  if(!framed)return {}
  return patch
}

/** Copies the memory file of the old flat data directory into the new per-world directory, once. */
export function moveMemory({fromDir,toDir}){
  if(!fromDir||!toDir||fromDir===toDir)return false
  const from=join(fromDir,'memory.json'),to=join(toDir,'memory.json')
  if(existsSync(to)||!existsSync(from))return false
  try{mkdirSync(toDir,{recursive:true});copyFileSync(from,to);return true}catch{return false}
}
