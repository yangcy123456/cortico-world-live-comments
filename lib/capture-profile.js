import {normalize} from './comments.js'

export function platformOf(target){
  const text=`${target?.processName||''} ${target?.title||''}`
  if(/livehime|bililive|bilibili|哔哩哔哩|直播姬/i.test(text))return 'bilibili'
  if(/douyin|抖音/i.test(text)||target?.processName==='直播伴侣')return 'douyin'
  return 'unknown'
}
export const platformLabel=id=>({douyin:'抖音直播伴侣',bilibili:'B站直播姬',unknown:'直播软件'}[id]||'直播软件')

/** Full-window preview labels, never audience text, decide whether this is a recap page. */
export function previewPage(lines,platform){
  const labels=lines.map(line=>normalize(line.text).replace(/\s/g,''))
  if(platform==='douyin'&&labels.some(s=>/^直播已结束$/.test(s))&&labels.some(s=>/^(直播复盘|数据汇总|直播回放分析|本场榜)$/.test(s)))return 'ended'
  return 'comments'
}

export function captureStatus({target,cropConfirmed,running,lastError,preview,recognition}){
  if(lastError)return {code:'error',message:lastError}
  if(!target)return {code:'unbound',message:'尚未选择直播窗口'}
  if(preview?.page==='ended')return {code:'ended',message:'当前是直播结束后的复盘页，请切回能看到评论的主界面，再刷新预览'}
  if(!cropConfirmed)return {code:'needs-crop',message:'评论区尚未保存：点“预览并框选评论区”，框住实际评论列表后保存'}
  if(!running&&!recognition?.inspection)return {code:'paused',message:'采集已暂停，点击“开始采集”后才会读取评论'}
  if(!recognition)return {code:'starting',message:'正在获取第一帧评论画面'}
  if(!recognition.rawLines)return {code:'no-text',message:'画面已取得，但框选区域没有读到文字；请检查评论是否在框内'}
  if(!recognition.comments)return {code:'filtered',message:`读到 ${recognition.rawLines} 行文字，均为栏目或系统提示；请核对评论框选范围`}
  if(recognition.inspection)return {code:'checked',message:`单次检查已读到 ${recognition.comments} 条；尚未开启 Coo 回复`}
  if(recognition.baseline)return {code:'baseline',message:`已读到 ${recognition.comments} 条现有文字；首帧只作为历史，可手动选择一条交给 Coo`}
  return {code:'reading',message:`已读到 ${recognition.comments} 条文字，等待稳定出现的新评论`}
}
