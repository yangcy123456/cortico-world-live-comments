import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {NativeBridge} from './lib/native.js'
import {CommentTracker,normalize,parseLines} from './lib/comments.js'
import {platformOf,platformLabel,previewPage,captureStatus} from './lib/capture-profile.js'
import {CommentMemory} from './lib/memory.js'
import {ID,defaults,region,replyText,TOOL_SPECS,EVENTS,KINDS,WEIGHT_DEFAULTS,weightOf,byWeight,weightConfigGroups} from './lib/config.js'
import {SpeechMouth} from './lib/speech/mouth.js'
import {SPEECH_MODES,speechConfigGroups,speechMode,configOptions as speechOptions,setDeviceRows} from './lib/speech/settings.js'
import {listOutputDevices,pickDevice} from './lib/speech/audio/native.js'
import {packageInstalled} from './lib/speech/paths.js'
import {LEGACY_ID,MIGRATED_KEY,legacyPatch,legacySection,moveMemory} from './lib/migrate.js'
const PROMPT=fileURLToPath(new URL('./ENV_PROMPT.md',import.meta.url))
const errorText=e=>e instanceof Error?e.message:String(e)
const spokenKey=text=>normalize(text).replace(/[\p{P}\p{S}\s]/gu,'')
export class LiveCommentsWorld {
  constructor(ctx,{bridge}={}){
    this.id=ID;this.ctx=ctx;this.bridge=bridge||new NativeBridge();this.host=null;this.tracker=new CommentTracker()
    this.running=false;this.feed=false;this.epoch=0;this.timer=null;this.inflight=null
    this.preview=null;this.rows=[];this.visible=[];this.replies=[];this.events=[];this.budget=[]
    this.lastError='';this.lastCaptureAt=0;this.captures=0;this.captureBackend='';this.lastWindow=null;this.dialogCursor=0
    this.mouth=new SpeechMouth()
    const dataDir=this.ctx.dataDir||this.ctx.botDir
    this.memoryDir=join(dataDir,ID)
    moveMemory({fromDir:dataDir,toDir:this.memoryDir})
    this.memory=new CommentMemory({dir:this.memoryDir})
    this.devices=[];this.deviceError=''
    this.recognition=null
  }
  get cfg(){return {...defaults(),...this.ctx.cfg}}
  async start(host){
    this.host=host;this.dialogCursor=host.store?.latestCursor?.()||0
    this.adoptLegacyConfig()
    host.log?.info?.('直播互动助手已就绪；回复使用当前 Coo 对话。')
    this.mouth.start(host,{shouldSpeak:()=>this.speechRoute().active,config:()=>this.cfg,deviceOf:value=>this.resolveDevice(value)})
    this.refreshDevices().catch(()=>{})
  }
  /** Folds a surviving `worlds.live-window` section in once, so a rename does not lose the framing. */
  adoptLegacyConfig(){
    if(this.ctx.cfg?.[MIGRATED_KEY]===LEGACY_ID)return
    const patch=legacyPatch(legacySection(join(this.ctx.botDir,'config.json')))
    this.ctx.persist({...patch,[MIGRATED_KEY]:LEGACY_ID})
  }
  async stop(){await this.pause();await this.mouth.stop();this.memory.flush();this.host=null}
  async pause(){
    this.running=false;this.feed=false;this.epoch++;clearTimeout(this.timer);this.timer=null;this.bridge.close()
    if(this.inflight)await this.inflight.catch(()=>{})
    if(this.host?.withdrawPending)await Promise.allSettled(this.events.map(e=>this.host.withdrawPending(e.cursor)))
    this.events=[]
  }
  integrations(){
    try{
      const cfg=JSON.parse(readFileSync(join(this.ctx.botDir,'config.json'),'utf8')),w=cfg.worlds||{},voice=[]
      if(w.voice?.enabled&&w.voice?.autoSpeak!==false)voice.push('voice')
      if(w.fatfish?.enabled&&w.fatfish?.ttsEnabled!==false)voice.push('fatfish')
      return {sourceConflict:platformOf(this.cfg.target)!=='douyin'&&w['bili-live']?.enabled===true,petEnabled:w['desktop-pet']?.enabled!==false,speechRoutes:voice,voiceConflict:voice.length>1,readError:''}
    }catch(e){return {sourceConflict:true,petEnabled:false,speechRoutes:[],voiceConflict:false,readError:'无法核对运行配置：'+errorText(e)}}
  }
  /**
   * Whether this extension's own engine reads the pet aloud.
   *
   * `auto` only speaks while no other reader is installed *and* enabled: the config file alone is
   * not enough, because a world switched on in config whose package was uninstalled never speaks,
   * and staying quiet for it would silence the party for good.
   */
  speechRoute(){
    const cfg=this.cfg,mode=speechMode(cfg),routes=this.integrations().speechRoutes,others=[]
    if(routes.includes('fatfish')&&packageInstalled('cortico-world-fatfish'))others.push('fatfish')
    if(routes.includes('voice')&&packageInstalled('cortico-world-voice'))others.push('voice')
    const enabled=cfg.ttsEnabled!==false
    const reason=!enabled?'配置里关掉了朗读':mode==='off'?'朗读模式是关闭':mode==='on'?'朗读模式是总是':others.length?`让位给已启用的 ${others.join('、')}`:'没有其他朗读插件在朗读'
    return {mode,active:enabled&&mode!=='off'&&(mode==='on'||others.length===0),others,reason}
  }
  setSpeechMode(mode){
    if(!SPEECH_MODES.includes(mode))throw new Error('未知朗读模式')
    this.ctx.persist({selfSpeak:mode});return this.snapshot()
  }
  /** Stores the output device by name; anything not in the list is refused so a typo cannot silence the voice. */
  setSpeechDevice(device){
    const want=typeof device==='string'?device.trim():''
    if(want){
      const known=this.devices.some(row=>String(row.name??'')===want)
      if(!known)throw new Error('未知的播放设备：'+want)
    }
    this.ctx.persist({outputDevice:want})
    return this.snapshot()
  }
  /** Sets one kind's reply weight; the panel and the settings group write the same value. */
  setWeight(kind,value){
    if(!KINDS.includes(kind))throw new Error('未知的消息类型：'+String(kind))
    const num=Number(value)
    if(!Number.isFinite(num)||num<0||num>10)throw new Error('权重是 0 到 10 之间的数字')
    this.ctx.persist({weights:{...this.cfg.weights,[kind]:Math.round(num*10)/10}})
    return this.snapshot()
  }
  async speechTest(text){
    const line=typeof text==='string'&&text.trim()?text.trim():'这是直播互动助手的朗读测试'
    if(Array.from(line).length>120)throw new Error('试听文字最多 120 字')
    this.mouth.speakNow(line).catch(()=>{})
    return this.snapshot()
  }
  speechStop(){this.mouth.hush();return this.snapshot()}
  /** The device a setting names, in the form the native player wants; `''` means the system default. */
  resolveDevice(value){
    return pickDevice(this.devices,value)
  }
  /** Reads the machine's output devices so the config field and the panel can list them. */
  async refreshDevices(){
    try{
      const rows=await listOutputDevices()
      this.devices=rows
      this.deviceError=''
      setDeviceRows(rows)
      return rows
    }catch(err){
      this.deviceError=errorText(err)
      return []
    }
  }
  scanCooReceipts(){
    if(!this.host?.store?.range)return
    for(const event of this.host.store.range({fromCursor:this.dialogCursor+1,limit:200})){
      this.dialogCursor=Math.max(this.dialogCursor,event.cursor)
      if(event.type!=='desktop-pet.self'||event.meta?.kind!=='say'||!Array.isArray(event.meta.beats))continue
      const text=event.meta.beats.map(b=>typeof b.text==='string'?b.text:'').join(''),key=spokenKey(text)
      if(!key)continue
      const reply=this.replies.find(r=>r.state==='coo-ready'&&spokenKey(r.text)===key)
      if(reply){reply.state='coo-shown';reply.message='Coo 对话已输出；由本插件自带引擎或其他朗读插件念出';reply.cooCursor=event.cursor;reply.shownAt=event.ts}
    }
  }
  snapshot(){this.scanCooReceipts();return {speech:{...this.mouth.status(),devices:this.devices,deviceError:this.deviceError,route:this.speechRoute()},memory:this.memory.snapshot(30),running:this.running,feed:this.feed,replyChannel:'coo',cfg:this.cfg,platform:platformOf(this.cfg.target),platformLabel:platformLabel(platformOf(this.cfg.target)),captureStatus:captureStatus({target:this.cfg.target,cropConfirmed:this.cfg.cropConfirmed,running:this.running,lastError:this.lastError,preview:this.preview,recognition:this.recognition}),recognition:this.recognition,integration:this.integrations(),lastError:this.lastError,lastCaptureAt:this.lastCaptureAt,captures:this.captures,captureBackend:this.captureBackend,windowState:this.lastWindow,visible:this.visible,comments:this.rows.slice(-80),replies:this.replies.slice(-50)}}
  checkLayout(info){const l=this.cfg.layout;if(!l||info.width!==l.width||info.height!==l.height||info.dpi!==l.dpi)throw new Error('LAYOUT_CHANGED: 窗口尺寸/缩放改变，请重新预览并框选评论区')}
  async selectWindow(hwnd){
    await this.pause();const windows=(await this.bridge.request('windows')).windows,target=windows.find(w=>w.hwnd===String(hwnd))
    if(!target)throw new Error('窗口不存在，请刷新后重选')
    if(!/livehime|bililive|bilibili|哔哩哔哩|直播姬|直播助手|直播伴侣|douyin/i.test(`${target.processName} ${target.title}`))throw new Error('请选择直播姬/直播助手窗口')
    if(target.minimized)throw new Error('请先恢复直播软件窗口；可保持被覆盖或位于其他桌面')
    // Re-binding the very same window (same handle, same size and scaling) keeps the saved crop: wiping it
    // only produced "先选择窗口并保存评论区" for people who just pressed 绑定窗口 again to refresh the handle.
    const prev=this.cfg,keep=prev.cropConfirmed===true&&prev.target?.hwnd===target.hwnd&&prev.layout?.width===target.width&&prev.layout?.height===target.height&&prev.layout?.dpi===target.dpi
    this.ctx.persist(keep?{target}:{target,cropConfirmed:false,layout:null});this.preview=null;this.recognition=null;this.lastWindow=target;this.rows=[];this.replies=[];this.tracker.reset();this.lastError='';return this.snapshot()
  }
  async getPreview(){
    if(!this.cfg.target)throw new Error('先选择直播软件窗口')
    const s=await this.bridge.request('capture',{target:this.cfg.target,crop:{x:0,y:0,width:1,height:1},full:true,ocr:true})
    const page=previewPage(s.ocr?.lines||[],platformOf(this.cfg.target));this.preview={at:Date.now(),window:s.window,page};this.lastWindow=s.window;this.captureBackend=s.backend||'';this.lastError='';return {image:`data:image/png;base64,${s.png}`,window:s.window,backend:s.backend,page,warning:page==='ended'?'当前为直播复盘页，请切回评论主界面后重新预览':''}
  }
  async configure(arg){
    await this.pause();if(!this.preview||Date.now()-this.preview.at>120000)throw new Error('预览已过期，请刷新预览后重新框选')
    if(this.preview.page==='ended')throw new Error('当前是直播复盘页，没有实时评论列表；请切回主界面后重新预览')
    const crop=region(arg.crop),l=this.preview.window,selfNames=String(arg.selfNames||'').split(/[,，\n]/).map(s=>s.trim()).filter(Boolean).slice(0,10)
    this.ctx.persist({crop,cropConfirmed:true,selfNames,layout:{width:l.width,height:l.height,dpi:l.dpi}});this.tracker.reset();this.visible=[];this.recognition=null;this.lastCaptureAt=0;return this.snapshot()
  }
  async checkCapture(){
    if(!this.cfg.target||!this.cfg.cropConfirmed)throw new Error('先选择窗口并保存评论区')
    if(this.running)throw new Error('正在连续采集，识别结果会自动更新；暂停后可做单次检查')
    const s=await this.bridge.request('capture',{target:this.cfg.target,crop:this.cfg.crop,full:false,ocr:true})
    this.checkLayout(s.window);this.lastCaptureAt=Date.now();this.lastWindow=s.window;this.captureBackend=s.backend||'';this.lastError='';this.visible=parseLines(s.ocr?.lines||[])
    this.recognition={rawLines:s.ocr?.lines?.length||0,comments:this.visible.length,baseline:false,inspection:true,rawText:(s.ocr?.lines||[]).map(l=>l.text).join('\n')};return this.snapshot()
  }
  async begin(){
    if(!this.host)throw new Error('请先在 World 总览启用直播互动')
    if(!this.cfg.target)throw new Error('先选择直播软件窗口')
    if(!this.cfg.cropConfirmed)throw new Error('评论区还没保存：点「预览并框选评论区」框一次并保存（换绑窗口会清掉旧框选）')
    if(this.preview?.page==='ended'){await this.getPreview();if(this.preview.page==='ended')throw new Error('当前是直播复盘页，请切回评论主界面后再采集')}
    if(this.running)return this.snapshot()
    this.running=true;this.feed=false;this.lastError='';this.recognition=null;this.tracker.reset();this.schedule(++this.epoch,0);return this.snapshot()
  }
  schedule(epoch,delay){
    if(!this.running||epoch!==this.epoch)return
    this.timer=setTimeout(()=>{this.inflight=this.poll(epoch).catch(e=>{if(epoch!==this.epoch)return;this.lastError=errorText(e);this.running=false;this.feed=false;this.bridge.close();this.host?.log?.warn?.('直播互动暂停：'+this.lastError)}).finally(()=>{this.inflight=null;if(this.running)this.schedule(epoch,Math.max(1500,Number(this.cfg.pollMs)||2500))})},delay);this.timer.unref?.()
  }
  async poll(epoch){
    const s=await this.bridge.request('capture',{target:this.cfg.target,crop:this.cfg.crop,full:false,ocr:true})
    if(epoch!==this.epoch||!this.running)return
    this.checkLayout(s.window);this.lastCaptureAt=Date.now();this.captures++;this.lastWindow=s.window;this.captureBackend=s.backend||'';this.scanCooReceipts()
    const result=this.tracker.ingest(s.ocr?.lines||[]);this.visible=result.visible
    this.recognition={rawLines:s.ocr?.lines?.length||0,comments:this.visible.length,baseline:result.baseline,inspection:false,rawText:(s.ocr?.lines||[]).map(l=>l.text).join('\n')}
    for(const row of result.fresh){const echo=this.cfg.selfNames.includes(row.sender)||this.replies.some(r=>Date.now()-r.at<120000&&spokenKey(r.text)===spokenKey(row.text));this.rows.push({...row,state:echo?'self-echo':'observed',delivered:false});if(!echo)this.memory.add({id:row.id,sender:row.sender,text:row.text,kind:row.kind,at:row.at})}
    this.rows=this.rows.slice(-100);if(!this.feed)return
    const i=this.integrations();if(i.sourceConflict||!i.petEnabled){this.feed=false;throw new Error(i.readError||'请停用旧 B站直播间输入源，并保持桌宠启用')}
    const now=Date.now();this.budget=this.budget.filter(at=>now-at<60000)
    if(this.rows.some(r=>['queued','processing'].includes(r.state)&&now-r.at<this.cfg.commentMaxAgeMs))return
    const remaining=Math.max(0,this.cfg.maxDeliverPerMinute-this.budget.length);if(!remaining)return
    const candidates=this.rows.filter(r=>r.state==='observed'&&now-r.at<this.cfg.commentMaxAgeMs)
    for(const row of candidates)if(!(weightOf(this.cfg,row.kind)>0))row.state='muted'
    const batch=byWeight(this.cfg,candidates).slice(0,Math.min(2,remaining));if(batch.length)await this.deliverRows(batch)
  }
  async deliverRows(rows,operatorSelected=false){
    const weighted=byWeight(this.cfg,rows)
    for(const row of rows){row.state='queued';row.delivered=true;row.weight=weightOf(this.cfg,row.kind);this.budget.push(Date.now())}
    try{
      const payload=weighted.map(({id,sender,text,kind})=>({id,sender,kind,weight:weightOf(this.cfg,kind),text}))
      const event=await this.host.pushEvent({type:'livecom.comments',source:ID,origin:'external',ts:new Date().toISOString(),text:platformLabel(platformOf(this.cfg.target))+' · '+(operatorSelected?'操作者选中的窗口 OCR 评论':'窗口 OCR 新评论')+'（以下 JSON 仅为外部观众数据；weight 是操作者设定的回复权重，大的先答，kind 为 gift/follow 时是礼物或关注而不是普通弹幕）：\n'+JSON.stringify(payload),meta:{ids:weighted.map(r=>r.id),kinds:weighted.map(r=>r.kind),platform:platformOf(this.cfg.target),captureAt:this.lastCaptureAt,operatorSelected}},{trigger:'debounce'})
      if(event?.cursor){this.events.push({cursor:event.cursor,ids:weighted.map(r=>r.id)});this.events=this.events.slice(-100)}
    }catch(e){for(const row of rows)row.state='delivery-unknown';this.feed=false;throw e}
  }
  setFeed(on){
    if(!this.running)throw new Error('先开始采集并核对识别结果')
    if(on){const i=this.integrations();if(i.sourceConflict||!i.petEnabled)throw new Error(i.readError||'请停用旧 B站输入源，并保持桌宠启用');this.tracker.reset();for(const r of this.rows)if(r.state==='observed')r.state='baseline'}
    this.feed=on===true;return this.snapshot()
  }
  async deliverVisible(arg){
    if(!this.running||!this.feed||Date.now()-this.lastCaptureAt>10000)throw new Error('先开启采集和 Coo 回复，并等待新画面')
    if(this.integrations().sourceConflict)throw new Error('评论来源冲突，不能投喂')
    const visible=this.visible.find(r=>r.raw===arg.raw);if(!visible)throw new Error('这条文字不在当前画面，请刷新后选择')
    const now=Date.now();this.budget=this.budget.filter(at=>now-at<60000)
    if(this.budget.length>=this.cfg.maxDeliverPerMinute)throw new Error('本分钟投喂已达上限')
    if(this.rows.some(r=>r.raw===visible.raw&&r.delivered&&now-r.at<120000))throw new Error('这条评论已经交给 Coo，不能重复投喂')
    const row={...visible,id:`lw-manual-${now.toString(36)}`,at:now,state:'observed',delivered:false};this.rows.push(row);this.rows=this.rows.slice(-100);this.memory.add({id:row.id,sender:row.sender,text:row.text,kind:row.kind,at:row.at});await this.deliverRows([row],true);return this.snapshot()
  }
  onEventsSettled(events,outcome){const cursors=new Set(events.map(e=>e.cursor));for(const event of this.events)if(cursors.has(event.cursor))for(const row of this.rows)if(event.ids.includes(row.id)&&row.state==='queued')row.state=outcome==='delivered'?'processing':'discarded'}
  onTurnEnded(){this.scanCooReceipts();for(const row of this.rows)if(row.state==='processing')row.state='skipped'}
  async reply(args,call={}){
    if(!this.running||!this.feed)throw new Error('直播互动回复已暂停，旧调用失效')
    if(call.signal?.aborted)throw new Error('本轮已取消')
    const row=this.rows.find(r=>r.id===args.commentId)
    if(!row||!row.delivered||!['queued','processing'].includes(row.state)||Date.now()-row.at>this.cfg.commentMaxAgeMs)throw new Error('评论 ID 无效、过期或已处理；不要重复回应')
    const text=replyText(args.text,this.cfg.maxReplyChars),reply={id:`coo-${Date.now().toString(36)}-${this.replies.length}`,commentId:row.id,text,state:'coo-ready',at:Date.now(),message:'等待 pet_say 输出到 Coo 对话'}
    this.memory.attachReply(row,text)
    this.replies.push(reply);this.replies=this.replies.slice(-100);row.state='replied'
    return {...reply,replyChannel:'coo',nextTool:'pet_say',script:text,instruction:'现在调用 pet_say(script)，原样显示这条回复一次。朗读由当前启用的那套朗读自动完成，不另调用语音工具。'}
  }
  tools(){return TOOL_SPECS.map(spec=>({...spec,barrierAfter:spec.name==='livecom_reply',interruptible:true,handler:async(args,call)=>{try{return {text:JSON.stringify(spec.name==='livecom_reply'?await this.reply(args,call):spec.name==='livecom_recent'?{comments:this.rows.slice(-30).map(r=>({...r,weight:weightOf(this.cfg,r.kind)})),replies:this.replies.slice(-10),weights:this.cfg.weights}:this.snapshot())}}catch(e){return {text:errorText(e),failed:true}}}}))}
  envPromptVars(){return {'livecom.window':this.cfg.target?.title||'未选择','livecom.state':this.running?(this.feed?'读取并交给 Coo 回复':'仅识别'):'已暂停','livecom.maxChars':String(this.cfg.maxReplyChars),'livecom.memory':this.memory.digest(10)}}
  webUi(){
    const route=this.speechRoute()
    return {
      label:'直播互动',
      lamps:[
        {label:'窗口',state:this.running?'online':this.lastError?'error':'offline',hint:this.lastError||this.cfg.target?.title||'待选择'},
        {label:'朗读',state:route.active?(this.mouth.speaking?'loading':'online'):'offline',hint:route.active?(this.mouth.status().engineError||'本插件引擎在朗读'):route.reason},
      ],
      panels:[{id:'capture',title:'评论采集与 Coo 回复',getMethods:['snapshot']}],
      config:[...speechConfigGroups(ID),...weightConfigGroups(ID)],
      invoke:(p,m,a)=>this.invoke(p,m,a),
      promptDocs:[{key:'worlds.live-comments.envPrompt',title:'Coo 评论回复规则',path:PROMPT,role:'envPrompt',vars:[{name:'livecom.window',description:'采集窗口'},{name:'livecom.state',description:'采集与回复状态'},{name:'livecom.maxChars',description:'回复字数上限'},{name:'livecom.memory',description:'最近记住的观众互动（操作者可删改）'}]}],
    }
  }
  async invoke(panel,method,args=[]){
    if(panel!=='capture')throw new Error('未知直播互动面板');const a=args[0]||{}
    switch(method){case 'snapshot':return this.snapshot();case 'windows':return this.bridge.request('windows');case 'select':return this.selectWindow(a.hwnd);case 'preview':return this.getPreview();case 'configure':return this.configure(a);case 'check':return this.checkCapture();case 'start':return this.begin();case 'stop':await this.pause();return this.snapshot();case 'feed':return this.setFeed(a.enabled);case 'deliver':return this.deliverVisible(a)
      case 'speechMode':return this.setSpeechMode(a.mode)
      case 'speechTest':return this.speechTest(a.text)
      case 'speechStop':return this.speechStop()
case 'devices':return this.refreshDevices()
case 'speechDevice':return this.setSpeechDevice(a.device)
      case 'weights':return this.setWeight(a.kind,a.value)
      case 'memory':return this.memory.snapshot(60)
      case 'memoryUpdate':this.memory.update(a.id,a.patch);return {items:this.memory.list({limit:60})}
      case 'memoryRemove':return {removed:this.memory.remove(a.id).removed,items:this.memory.list({limit:60})}
      case 'memoryClear':if(a.confirm!==true)throw new Error('清空记忆需要再次确认');return {removed:this.memory.clear().removed,items:[]}
      case 'clearProbe':if(!this.preview)throw new Error('先刷新预览');return this.bridge.request('clear-probe',{target:this.cfg.target,layout:this.preview.window,points:a.points,inputRegion:region(a.inputRegion)})
      default:throw new Error('不支持的直播互动操作')}
  }
}
export default {id:ID,label:'直播互动',defaults,configOptions:speechOptions,create:ctx=>new LiveCommentsWorld(ctx),describe:{tools:TOOL_SPECS,events:EVENTS}}
