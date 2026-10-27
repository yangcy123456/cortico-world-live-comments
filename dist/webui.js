const labels={observed:'已识别',baseline:'启动前历史',queued:'等待 Coo',processing:'Coo 处理中',replied:'已生成回复',skipped:'本轮未回应',discarded:'已丢弃',muted:'权重 0（不投喂）','self-echo':'回声（跳过）','coo-ready':'等待显示到 Coo 对话','coo-shown':'Coo 对话已回复'}
export default {panels:{capture:{mount(ctx){
  const doc=ctx.root.ownerDocument,el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
  const root=el('div',undefined,'lw');ctx.root.append(root)
  let state=null,disposed=false,busy=false,image=null,crop=null,drag=null,generation=0
  const error=el('div','','lw-error'),status=el('div','','lw-state'),note=el('div','','lw-note');root.append(el('h2','直播互动 → Coo 对话'),error)
  const top=el('section');top.append(status,note);root.append(top)
  const invoke=(m,a={})=>ctx.invoke(m,[a])
  async function act(fn){if(busy)return;busy=true;generation++;error.textContent='';try{const r=await fn();if(r?.cfg)render(r)}catch(e){error.textContent=String(e.message||e)}finally{busy=false}}
  const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=()=>act(fn);return b}
  const setup=el('section');setup.append(el('h3','1. 选择直播软件窗口'))
  const bar=el('div',undefined,'lw-bar'),select=el('select')
  bar.append(select,button('刷新窗口',async()=>{
    const list=(await invoke('windows')).windows.filter(w=>/livehime|bililive|bilibili|哔哩哔哩|直播姬|直播助手|直播伴侣|douyin/i.test(`${w.processName} ${w.title}`))
    select.replaceChildren(el('option',list.length?'请选择窗口':'没有可采集的直播窗口'));select.firstChild.value=''
    for(const w of list){const o=el('option',`${w.title} · ${w.processName}${w.minimized?'（最小化）':w.onCurrentDesktop===false?'（其他桌面）':''}`);o.value=w.hwnd;select.append(o)}
  }),button('绑定窗口',()=>invoke('select',{hwnd:select.value}),'lw-primary'),button('预览并框选评论区',async()=>{
    const p=await invoke('preview'),im=doc.createElement('img');await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=reject;im.src=p.image})
    if(disposed)return;image=im;crop={...state.cfg.crop};preview.hidden=false;draw();if(p.warning)error.textContent=p.warning
  }));setup.append(bar,el('div','按窗口采集，允许被覆盖或放在其他桌面；保持直播软件未最小化。回复显示在 Coo 对话和气泡里。','lw-note'));root.append(setup)
  const preview=el('section',undefined,'lw-preview');preview.hidden=true;preview.append(el('h3','2. 框选右下角评论列表'))
  const canvas=el('canvas'),names=el('input');names.placeholder='可选：忽略的昵称，多个用逗号分隔';names.className='lw-grow'
  preview.append(canvas,el('div','拖出评论列表区域，要同时覆盖「礼物」和「弹幕」两栏（右侧整条互动栏最稳）。排除输入框、标题和工具栏。窗口尺寸或缩放变化后重新框选。','lw-note'))
  const save=el('div',undefined,'lw-bar');save.append(names,button('框选右侧互动栏（参考范围）',async()=>{crop={x:0.828,y:0.30,width:0.170,height:0.630};draw()},undefined),button('保存评论区',()=>invoke('configure',{crop,selfNames:names.value}),'lw-primary'));preview.append(save);root.append(preview)
  function draw(){if(!image)return;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const g=canvas.getContext('2d');g.drawImage(image,0,0);if(crop){g.strokeStyle='#03d6b0';g.lineWidth=3;g.strokeRect(crop.x*canvas.width,crop.y*canvas.height,crop.width*canvas.width,crop.height*canvas.height)}}
  const pos=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag=pos(e)}
  canvas.onpointerup=e=>{if(!drag)return;const p=pos(e);crop={x:Math.min(p.x,drag.x),y:Math.min(p.y,drag.y),width:Math.abs(p.x-drag.x),height:Math.abs(p.y-drag.y)};drag=null;draw()}
  const run=el('section');run.append(el('h3','3. 读取评论，交给当前 Coo 人格回复'))
  const controls=el('div',undefined,'lw-bar'),start=button('开始采集',()=>invoke('start'),'lw-primary'),stop=el('button','立即暂停','lw-danger'),feed=button('开启 Coo 回复',()=>invoke('feed',{enabled:!state?.feed})),check=button('检查识别（不回复）',()=>invoke('check'))
  stop.onclick=async()=>{generation++;try{render(await invoke('stop'))}catch(e){error.textContent=String(e.message||e)}}
  const captureHint=el('div','','lw-state')
  controls.append(start,stop,feed,check);run.append(controls,captureHint,el('div','保存评论区后，可先“检查识别（不回复）”。首帧只记录历史，新评论连续两帧出现后交给 Coo；要回应现有消息，可手动选一条。抖音和 B站属于不同平台，可分别读取。','lw-note'))
  const kindLabels={chat:'弹幕',gift:'礼物',follow:'关注',enter:'进场'}
  const weightBar=el('div',undefined,'lw-bar'),weightInputs={}
  for(const kind of ['chat','gift','follow','enter']){
    const label=el('label',kindLabels[kind]),input=el('input');input.type='number';input.min='0';input.max='10';input.step='0.5';input.className='lw-num'
    input.onchange=()=>act(()=>invoke('weights',{kind,value:input.value}))
    label.append(input);weightInputs[kind]=input;weightBar.append(label)
  }
  run.append(el('div','回复权重：数字越大越先交给 Coo，0 表示这类消息只显示、不投喂。礼物默认 3、弹幕 1、关注/粉丝团 1.5、进场 0；改完立即生效，也会存进设置分组「回复权重」。','lw-note'),weightBar)
  const visible=el('div','','lw-scroll'),comments=el('div','','lw-scroll');run.append(el('h3','识别到的文字'),visible,el('h3','新评论处理状态'),comments);root.append(run)
  const rawDetails=el('details'),rawText=el('pre','','lw-scroll');rawDetails.append(el('summary','查看识别原文'),rawText);run.append(rawDetails)
  const speech=el('section');speech.append(el('h3','4. 语音朗读（插件自带引擎）'))
  const speechLine=el('div','','lw-state'),modeSelect=el('select'),deviceSelect=el('select'),testText=el('input')
  testText.className='lw-grow';testText.placeholder='试听文字（留空则念一句默认测试）'
  for(const [value,text] of [['auto','自动 · 让位给其他朗读插件'],['on','总是 · 本插件朗读'],['off','关闭 · 本插件不发声']]){const o=el('option',text);o.value=value;modeSelect.append(o)}
  modeSelect.onchange=()=>act(()=>invoke('speechMode',{mode:modeSelect.value}))
  deviceSelect.onchange=()=>act(()=>invoke('speechDevice',{device:deviceSelect.value}))
  const speechBar=el('div',undefined,'lw-bar')
  speechBar.append(modeSelect,deviceSelect,button('刷新设备',()=>invoke('devices')),testText,button('试听',()=>invoke('speechTest',{text:testText.value}),'lw-primary'),button('停止朗读',()=>invoke('speechStop'),'lw-danger'))
  speech.append(speechBar,el('div','Edge 在线语音，语音包/音色/语速/音高/音量在下面的设置分组里改；停用或卸载大肥鱼后仍可发声。两路都在朗读时选“自动”，本插件会让位。\n接虚拟麦克风：播放设备选虚拟扬声器（LegionZone 虚拟扬声器 / VB-CABLE / VoiceMeeter），直播软件的麦克风再选配对的那个虚拟麦克风，声音就会被当成你的麦克风；麦克风在直播软件「设置 → 音频」里改。','lw-note'),speechLine)
  root.append(speech)
  const memorySection=el('section');memorySection.append(el('h3','5. 弹幕记忆（可删可改）'))
  const memoryCount=el('div','','lw-state'),memoryList=el('div','','lw-scroll'),memoryBar=el('div',undefined,'lw-bar')
  memoryBar.append(memoryCount,button('清空全部记忆',async()=>{const view=doc.defaultView;if(view?.confirm&&!view.confirm('清空全部弹幕记忆？此操作不可撤销。'))return;await act(()=>invoke('memoryClear',{confirm:true}))},'lw-danger'))
  memorySection.append(memoryBar,memoryList,el('div','识别到的新发言会自动记在这里，也会作为 {{livecom.memory}} 交给 Coo 当上下文。改文字后点「保存」，不要的删掉即可；每次改完立即生效。','lw-note'))
  root.append(memorySection)
  const replies=el('section'),replyList=el('div');replies.append(el('h3','Coo 回复与对话回执'),replyList);root.append(replies)
  function render(s){if(disposed)return;state=s;status.textContent=`${s.running?'采集中':'已暂停'} · ${s.feed?'Coo 回复已开启':'仅识别'} · 回复到 Coo 对话`
    note.textContent=[`窗口：${s.cfg.target?.title||'未选'}；${s.platformLabel||'直播软件'}；沿用当前模型、人格和记忆。`,s.captureBackend?`窗口采集已连接${s.windowState?.onCurrentDesktop===false?'（位于其他桌面）':''}。`:'',s.integration.readError||(s.integration.sourceConflict?'同一平台的 B站输入源仍启用，请保留一路，避免重复读取。':''),`朗读：${s.integration.speechRoutes.join('、')||'未开启'}。`,s.integration.voiceConflict?'两路自动朗读同时开启，请保留一路。':'',s.lastError].filter(Boolean).join('\n')
    start.disabled=s.running||!s.cfg.cropConfirmed;check.disabled=s.running||!s.cfg.cropConfirmed;feed.disabled=!s.running;feed.textContent=s.feed?'停止 Coo 回复':'开启 Coo 回复';captureHint.textContent=s.captureStatus?.message||'';rawText.textContent=s.recognition?.rawText||'尚未读取评论区文字'
    visible.replaceChildren(...s.visible.map(r=>{const row=el('div',undefined,'lw-row'),b=button('交给 Coo 回复',()=>invoke('deliver',{raw:r.raw}));b.disabled=!s.feed;row.append(el('span',`[${kindLabels[r.kind]||r.kind||'弹幕'}] ${r.raw}`),' ',b);return row}));if(!s.visible.length)visible.textContent='等待直播互动'
    comments.replaceChildren(...s.comments.slice(-30).map(r=>el('div',`[${kindLabels[r.kind]||r.kind||'弹幕'} · 权重 ${r.weight??'-'}] ${r.sender}：${r.text} · ${labels[r.state]||r.state}`,'lw-row')))
    replyList.replaceChildren(...s.replies.slice(-30).map(r=>el('div',`${r.text}\n${labels[r.state]||r.state} · ${r.message||''}`,'lw-row')));if(!s.replies.length)replyList.textContent='等待 Coo 回复'
    const weights=s.cfg.weights||{}
    for(const kind of Object.keys(weightInputs))if(doc.activeElement!==weightInputs[kind])weightInputs[kind].value=String(weights[kind]??'')
    const sp=s.speech||{},route=sp.route||{}
    modeSelect.value=route.mode||'auto'
    const devices=[{name:'',label:'系统默认设备'},...(sp.devices||[]).map(d=>({name:String(d.name??''),label:String(d.name??'')}))]
    const shown=devices.map(d=>[d.name,d.label])
    if(deviceSelect.dataset.list!==JSON.stringify(shown)){deviceSelect.replaceChildren(...shown.map(([value,text])=>{const o=el('option',text);o.value=value;return o}));deviceSelect.dataset.list=JSON.stringify(shown)}
    deviceSelect.value=sp.deviceWanted||''
    speechLine.textContent=[`本插件朗读：${route.active?'开':'关'}${route.reason?`（${route.reason}）`:''}`,sp.voice?`音色：${sp.voice}`:'',`播放设备：${sp.device||sp.deviceWanted||'系统默认设备'}`,sp.speaking?'正在朗读…':'',sp.queued?`排队 ${sp.queued} 条`:'',sp.engineError?`引擎：${sp.engineError}`:sp.lastError||'',sp.playerError?`播放：${sp.playerError}`:'',sp.deviceError?`设备列表：${sp.deviceError}`:''].filter(Boolean).join('\n')
    if(!image&&doc.activeElement!==names)names.value=s.cfg.selfNames.join(',')
    const mem=s.memory||{},items=(mem.items||[]).slice(-60)
    memoryCount.textContent=`已记 ${mem.size||0} 条${mem.lastError?' · '+mem.lastError:''}`
    const signature=JSON.stringify(items.map(entry=>[entry.id,entry.text,entry.note||'',entry.edited||0]))
    const focused=memoryList.contains(doc.activeElement)
    if(memoryList.dataset.signature!==signature&&!focused){
      memoryList.dataset.signature=signature
      memoryList.replaceChildren(...items.map(entry=>{
        const row=el('div',undefined,'lw-row'),head=el('div',`[${kindLabels[entry.kind]||'弹幕'}] ${entry.sender} · ${new Date(entry.at).toLocaleTimeString('zh-CN',{hour12:false})}${entry.reply?' · 已回复':''}`,'lw-note')
        const input=el('input');input.value=entry.text;input.className='lw-grow';input.dataset.id=entry.id
        row.append(head,input,el('span',' '),button('保存',()=>invoke('memoryUpdate',{id:input.dataset.id,patch:{text:input.value}}),'lw-primary'),button('删除',()=>invoke('memoryRemove',{id:entry.id}),'lw-danger'))
        return row
      }))
      if(!items.length)memoryList.textContent='还没有记住任何观众发言'
    }
  }
  async function poll(){if(disposed||busy)return;const g=generation;try{const s=await invoke('snapshot');if(g===generation)render(s)}catch(e){if(!disposed)error.textContent=String(e.message||e)}}
  ctx.interval(poll,2000);ctx.own({dispose(){disposed=true;image=null}});void poll()
}}}}
