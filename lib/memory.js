import {existsSync,mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

/** How many audience lines the plugin keeps. Older ones drop off; the file stays small enough to read by hand. */
export const MEMORY_LIMIT=500
/** Same person repeating the same words inside this window is one memory, not two. */
const DEDUPE_MS=10*60*1000
const FILE='memory.json'
const KINDS=new Set(['chat','gift','follow','enter'])
const text=value=>String(value??'').replace(/[\x00-\x1f\x7f]+/g,' ').trim().slice(0,200)

/** One memory as a line for the persona prompt. */
export function memoryLine(entry){
  const kind={chat:'弹幕',gift:'礼物',follow:'关注',enter:'进场'}[entry.kind]||'弹幕'
  const note=entry.note?`（备注：${entry.note}）`:''
  const reply=entry.reply?` → 你回过：${entry.reply}`:''
  return `- ${entry.sender}（${kind}）：${entry.text}${note}${reply}`
}

const valid=entry=>Boolean(entry&&typeof entry==='object'&&entry.id&&entry.sender!==undefined&&entry.text)
function tidy(entry){
  return {id:String(entry.id),sender:text(entry.sender)||'观众',text:text(entry.text),kind:KINDS.has(entry.kind)?entry.kind:'chat',at:Number(entry.at)||Date.now(),note:text(entry.note),reply:text(entry.reply),edited:Number(entry.edited)||0}
}

/**
 * Audience memory: what people said in the window, kept across restarts and editable by the operator.
 *
 * It is a plain JSON file under the world's data directory. A corrupt file is set aside instead of
 * stopping the world: losing chat history must never take the streaming session down with it.
 */
export class CommentMemory {
  constructor({dir,limit=MEMORY_LIMIT}={}){
    this.dir=dir;this.limit=limit;this.entries=[];this.lastError='';this.timer=null;this.dirty=false
    this.load()
  }
  get file(){return join(this.dir,FILE)}
  load(){
    try{
      const parsed=JSON.parse(readFileSync(this.file,'utf8'))
      const rows=Array.isArray(parsed?.entries)?parsed.entries.filter(valid).map(tidy):[]
      this.entries=rows.slice(-this.limit)
      this.lastError=''
    }catch(err){
      if(err.code!=='ENOENT'){
        this.lastError='记忆文件无法读取，已从空记忆开始：'+String(err.message||err)
        try{renameSync(this.file,this.file+'.broken')}catch{}
      }
      this.entries=[]
    }
    return this.entries
  }
  save(){
    this.dirty=false
    try{
      mkdirSync(this.dir,{recursive:true})
      const tmp=this.file+'.tmp'
      writeFileSync(tmp,JSON.stringify({version:1,entries:this.entries},null,1),'utf8')
      renameSync(tmp,this.file)
      this.lastError=''
    }catch(err){this.lastError='记忆保存失败：'+String(err.message||err)}
    return this.entries
  }
  /** Debounced write so a burst of comments touches the disk once. */
  schedule(){
    this.dirty=true
    if(this.timer)return
    this.timer=setTimeout(()=>{this.timer=null;if(this.dirty)this.save()},800)
    this.timer.unref?.()
  }
  flush(){if(this.timer){clearTimeout(this.timer);this.timer=null}if(this.dirty)this.save();return this.entries}
  add({id,sender,text:body,kind='chat',at=Date.now()}){
    const row=tidy({id:id||`mem-${Date.now().toString(36)}-${this.entries.length}`,sender,text:body,kind,at})
    if(!row.text)return null
    const dup=this.entries.find(entry=>entry.sender===row.sender&&entry.text===row.text&&Math.abs(entry.at-row.at)<DEDUPE_MS)
    if(dup){dup.at=Math.max(dup.at,row.at);this.schedule();return dup}
    this.entries.push(row)
    if(this.entries.length>this.limit)this.entries=this.entries.slice(-this.limit)
    this.schedule();return row
  }
  /** Records what was said back to one memory, matching by id first and by words second. */
  attachReply({id,sender,text:body},reply){
    const word=text(reply);if(!word)return null
    const entry=this.entries.find(row=>row.id===id)||this.entries.find(row=>row.sender===text(sender)&&row.text===text(body))
    if(!entry)return null
    entry.reply=word;entry.edited=Date.now();this.schedule();return entry
  }
  get(id){return this.entries.find(row=>row.id===String(id))||null}
  update(id,patch={}){
    const entry=this.get(id)
    if(!entry)throw new Error('这条记忆不存在，可能已被删除')
    if(patch.text!==undefined){const next=text(patch.text);if(!next)throw new Error('记忆内容不能为空');entry.text=next}
    if(patch.note!==undefined)entry.note=text(patch.note)
    if(patch.reply!==undefined)entry.reply=text(patch.reply)
    entry.edited=Date.now();this.schedule();return entry
  }
  remove(id){
    const before=this.entries.length
    this.entries=this.entries.filter(row=>row.id!==String(id))
    if(this.entries.length===before)throw new Error('这条记忆不存在，可能已被删除')
    this.schedule();return {removed:before-this.entries.length}
  }
  clear(){const removed=this.entries.length;this.entries=[];this.schedule();return {removed}}
  list({limit=50,kind}={}){
    const rows=kind?this.entries.filter(row=>row.kind===kind):this.entries
    return rows.slice(-Math.max(1,Math.min(this.limit,limit)))
  }
  digest(limit=10){
    const rows=this.entries.slice(-Math.max(1,limit))
    return rows.length?rows.map(memoryLine).join('\n'):'（还没有记住任何观众发言）'
  }
  get size(){return this.entries.length}
  snapshot(limit=30){return {size:this.size,lastError:this.lastError,file:this.file,items:this.list({limit})}}
}
export {FILE as MEMORY_FILE}
