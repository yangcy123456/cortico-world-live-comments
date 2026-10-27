import test from 'node:test'
import assert from 'node:assert/strict'
import {parseLines,CommentTracker} from '../lib/comments.js'
import {platformOf,previewPage,captureStatus} from '../lib/capture-profile.js'

test('short numeric messages remain chat instead of being mistaken for counters',()=>{
  const rows=parseLines(['123','666','1','0','１２３４５','观众：123'].map(text=>({text})))
  assert.deepEqual(rows.map(r=>r.text),['123','666','1','0','12345','123']);assert.ok(rows.every(r=>r.kind==='chat'))
  const t=new CommentTracker();t.ingest([]);assert.equal(t.ingest([{text:'123'}]).fresh.length,0);assert.equal(t.ingest([{text:'123'}]).fresh[0].text,'123')
})

test('UI counters, input character counts and clock rows are still excluded',()=>{
  const rows=parseLines([{text:'¥ 0'},{text:'0 0 凸 0'},{text:'---'},{text:'12:34'}, {text:'说点什么…',y:100,height:20},{text:'0',y:100,height:20},{text:'123',y:60,height:20}])
  assert.deepEqual(rows.map(r=>r.text),['123'])
})

test('a nickname and its OCR-split numeric body are kept together only when adjacent',()=>{
  const rows=parseLines([{text:'抖音观众：',x:20,y:10,height:20},{text:'123',x:22,y:35,height:20},{text:'远处昵称：',y:70,height:20},{text:'另一条评论',y:200,height:20}])
  assert.equal(rows[0].sender,'抖音观众');assert.equal(rows[0].text,'123');assert.equal(rows.length,2)
})

test('the actual multiline Douyin safety notice is filtered without losing the greeting below it',()=>{
  const rows=parseLines([
    {text:'互动消息',y:33,height:35},
    {text:'展示本场直播的礼物消息',y:289,height:37},
    {text:'欢 迎 来 到 直 播 间 ！ 抖 音 严 禁 未 成 年 人 直 播 或',y:537,height:35},
    {text:'礼 物 消 费 。 严 禁 违 法 违 规 、 低 俗 色 情 、 吸 烟',y:597,height:35},
    {text:'酗酒、人身伤害等直播内容。理性消费，如',y:657,height:35},
    {text:'主播在直播中以不当方式诱导消费，请谨慎',y:717,height:35},
    {text:'辨别。切勿私下交易，以防人身财产损失，',y:775,height:35},
    {text:'谨防网络诈骗。',y:837,height:35},
    {text:'抖 音 观 众 token ： 大 家 好',y:1195,height:35},
  ])
  assert.equal(rows.length,1);assert.equal(rows[0].text,'大家好');assert.equal(rows[0].kind,'chat')
})

test('a cropped notice ends at the next real named comment, and message text may quote UI words',()=>{
  const rows=parseLines([{text:'欢迎来到直播间！抖音严禁未成年人直播或',y:0,height:20},{text:'观众：测试',y:25,height:20},{text:'说点什么：你好',y:60,height:20}])
  assert.deepEqual(rows.map(r=>r.text),['测试','你好'])
})

test('platform detection and recap detection distinguish real comments from post-stream stats',()=>{
  assert.equal(platformOf({processName:'直播伴侣',title:'直播伴侣'}),'douyin')
  assert.equal(platformOf({processName:'douyin_live',title:'抖音直播伴侣'}),'douyin')
  assert.equal(platformOf({processName:'livehime',title:'哔哩哔哩直播姬'}),'bilibili')
  assert.equal(previewPage([{text:'直 播 已 结 束'},{text:'直播复盘'}],'douyin'),'ended')
  assert.equal(previewPage([{text:'观众：直播已结束了吗'},{text:'观众：数据汇总在哪里'}],'douyin'),'comments')
})

test('missing crop, paused capture and first-frame history have explicit and distinct feedback',()=>{
  const base={target:{title:'直播伴侣'},cropConfirmed:false,running:false}
  assert.equal(captureStatus(base).code,'needs-crop')
  assert.equal(captureStatus({...base,cropConfirmed:true}).code,'paused')
  assert.equal(captureStatus({...base,cropConfirmed:true,running:true,recognition:{rawLines:3,comments:1,baseline:true}}).code,'baseline')
})
