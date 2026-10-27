import { createHash } from 'node:crypto'

export function normalize(text) {
  return String(text||'').normalize('NFKC').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1').replace(/\s+/g,' ').trim()
}
/** Gift lines carry words no ordinary chat line has; the streamed UI prints them as its own rows. */
const GIFT=/送出|投喂|打赏|礼物|小心心|辣条|灯牌|上舰|大航海|开通|续费|电池|瓜子|火箭|嘉年华|办卡|月卡/
/** Someone joining or returning to the room. */
const ENTER=/进入直播间|进入了?直播间|来了|回到直播间/
/** Follows, fan-club joins and likes. */
const FOLLOW=/关注了?|互粉|粉丝团|点亮|赞了/

/** What one OCR row is: a chat line, a gift, a follow or a room entry. Feeding and replying act on this. */
export function classify(raw) {
  const text=String(raw||'')
  if(GIFT.test(text))return 'gift'
  if(FOLLOW.test(text))return 'follow'
  if(ENTER.test(text))return 'enter'
  return 'chat'
}

/** Panel chrome and empty-state text that OCR sees when the whole interaction column is captured. */
const CHROME=/^(直播互动|互动消息|全部消息|全部评论|房间观众|观众榜|贡献榜|在线榜|本场直播|展示本场直播|送礼|暂无|说点什么|请输入)|上舰消息|醒目留言|等显示在/
/** Counters need a visible UI symbol; plain digits can be real Douyin chat. */
const COUNTER=/^[\s\d¥￥凸·•.,\-+xX×()（）%]*$/
const COUNTER_MARK=/[¥￥凸×%]/
const INPUT=/^(请输入|说点什么)/
const CLOCK=/^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$/
const chatPrefix=text=>!CLOCK.test(text)&&/^.{1,40}[:：]\s*.+$/.test(text)
function prepareLines(lines){
  const normalized=lines.map(line=>({...line,raw:normalize(line.text)})).filter(line=>line.raw&&line.raw.length<=500)
  const out=[];let inNotice=false,lastNotice=null
  for(let index=0;index<normalized.length;index++){
    const line=normalized[index],raw=line.raw
    if(inNotice&&(chatPrefix(raw)||(Number.isFinite(line.y)&&Number.isFinite(lastNotice?.y)&&line.y-lastNotice.y>Math.max(1,lastNotice.height||20)*2.3)))inNotice=false
    if(!chatPrefix(raw)&&/^欢迎来到直播间.*抖音.*严禁/.test(raw))inNotice=true
    if(inNotice){lastNotice=line;if(/谨防网络诈骗/.test(raw))inNotice=false;continue}
    const next=normalized[index+1]
    if(/^.{1,40}[:：]$/.test(raw)&&next&&!CHROME.test(next.raw)&&!chatPrefix(next.raw)){
      const close=!Number.isFinite(line.y)||!Number.isFinite(next.y)||Math.abs(next.y-line.y)<=Math.max(line.height||20,next.height||20)*2.3
      if(close){out.push({...line,raw:raw+next.raw});index++;continue}
    }
    if(/^.{1,40}[:：]$/.test(raw))continue
    // The numeric character count on the input row is chrome, even when OCR splits it out.
    if(/^\d+$/.test(raw)&&Number.isFinite(line.y)&&normalized.some(other=>INPUT.test(other.raw)&&Number.isFinite(other.y)&&Math.abs(other.y-line.y)<=Math.max(other.height||20,line.height||20)*.5))continue
    out.push(line)
  }
  return out
}
export function parseLines(lines) {
  return prepareLines(lines)
    .filter(line=>chatPrefix(line.raw)||! /^(全部评论|全部消息|评论区|互动消息|发送|请输入.{0,12}|暂无.{0,12}|说点什么.{0,8}|[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?)$/.test(line.raw))
    .filter(line=>chatPrefix(line.raw)||(!CHROME.test(line.raw)&&!(COUNTER.test(line.raw)&&COUNTER_MARK.test(line.raw))&&!/^[-–—·•]+$/.test(line.raw)))
    .map(line=>{
      const match=/^(.{1,40}?)[:：]\s*(.+)$/.exec(line.raw)
      return {sender:match?match[1].trim():'观众（OCR未识别昵称）',text:match?match[2].trim():line.raw,raw:line.raw,kind:classify(line.raw)}
    })
}
const key=row=>normalize(row.raw).toLowerCase().replace(/[\s，。！？,.!?：:]/g,'')
// OCR has no platform message IDs. Conservative fuzzy dedup limits jitter-induced repeats.
function similar(a,b) {
  if(a===b)return true
  if(a.length<8||b.length<8||Math.abs(a.length-b.length)>2)return false
  const left=new Set(Array.from({length:a.length-1},(_,i)=>a.slice(i,i+2)))
  const right=new Set(Array.from({length:b.length-1},(_,i)=>b.slice(i,i+2)))
  let common=0;for(const item of left)if(right.has(item))common++
  return 2*common/(left.size+right.size)>=0.88
}
export class CommentTracker {
  constructor({ttlMs=90000}={}){this.ttlMs=ttlMs;this.reset()}
  reset(){this.warm=false;this.seen=[];this.previous=[];this.seq=0;this.session=Date.now().toString(36)}
  ingest(lines,now=Date.now()){
    const rows=parseLines(lines); const keys=rows.map(key)
    this.seen=this.seen.filter(row=>now-row.at<this.ttlMs)
    if(!this.warm){this.warm=true;this.seen.push(...keys.map(k=>({key:k,at:now})));this.previous=keys;return {baseline:true,visible:rows,fresh:[]}}
    const fresh=[]
    for(let n=0;n<rows.length;n++){
      const k=keys[n]
      const old=this.seen.find(old=>similar(old.key,k))
      if(old){old.at=now;continue}
      if(!this.previous.some(old=>similar(old,k)))continue // require two consecutive captures
      this.seen.push({key:k,at:now})
      fresh.push({...rows[n],id:`lw-${this.session}-${++this.seq}-${createHash('sha256').update(k).digest('hex').slice(0,6)}`,at:now})
    }
    this.seen=this.seen.slice(-5000);this.previous=keys;return {baseline:false,visible:rows,fresh}
  }
}
