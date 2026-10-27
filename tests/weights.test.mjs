import test from 'node:test'
import assert from 'node:assert/strict'
import {classify,parseLines} from '../lib/comments.js'
import {KINDS,WEIGHT_DEFAULTS,weightOf,byWeight,weightConfigGroups,defaults} from '../lib/config.js'

test('classify tells gifts, follows and room entries from chat',()=>{
  assert.equal(classify('熬夜牛马_悲 送出 小心心 x1'),'gift')
  assert.equal(classify('观众甲 投喂 辣条'),'gift')
  assert.equal(classify('观众乙 关注了主播'),'follow')
  assert.equal(classify('观众丙 加入了粉丝团'),'follow')
  assert.equal(classify('观众丁 进入直播间'),'enter')
  assert.equal(classify('熬夜牛马_悲：163163163'),'chat')
})

test('parseLines keeps the kind for every row',()=>{
  const [row]=parseLines([{text:'观众甲：送出 火箭'}])
  assert.equal(row.sender,'观众甲')
  assert.equal(row.kind,'gift')
  assert.equal(row.text,'送出火箭')
})

test('weights default, clamp and fall back',()=>{
  const cfg=defaults()
  assert.equal(weightOf(cfg,'gift'),WEIGHT_DEFAULTS.gift)
  assert.equal(weightOf({weights:{gift:8}},'gift'),8)
  assert.equal(weightOf({weights:{gift:99}},'gift'),10)
  assert.equal(weightOf({weights:{gift:-3}},'gift'),0)
  assert.equal(weightOf({weights:{gift:'abc'}},'gift'),WEIGHT_DEFAULTS.gift)
  assert.equal(weightOf({weights:{}},'chat'),WEIGHT_DEFAULTS.chat)
})

test('byWeight makes gifts overtake chat and drops zero-weight kinds',()=>{
  const cfg={weights:{chat:1,gift:3,follow:1.5,enter:0}}
  const rows=[
    {kind:'chat',at:1,raw:'弹幕'},
    {kind:'gift',at:2,raw:'礼物'},
    {kind:'enter',at:3,raw:'进场'},
    {kind:'follow',at:4,raw:'关注'},
  ]
  assert.deepEqual(byWeight(cfg,rows).map(r=>r.raw),['礼物','关注','弹幕'])
})

test('same-weight rows keep their arrival order',()=>{
  const cfg={weights:{chat:1,gift:1,follow:1,enter:1}}
  const rows=[{kind:'chat',at:9,raw:'b'},{kind:'chat',at:2,raw:'a'}]
  assert.deepEqual(byWeight(cfg,rows).map(r=>r.raw),['a','b'])
})

test('panel chrome and counter rows are dropped',()=>{
  const rows=parseLines([
    {text:'直播互动'},
    {text:'展示本场直播的弹幕互动消息'},
    {text:'送礼、醒目留言、上舰消息等显示在这里'},
    {text:'¥ 0'},
    {text:'0 0 凸 0'},
    {text:'观众甲：你好'},
  ])
  assert.deepEqual(rows.map(r=>r.raw),['观众甲:你好'])
})

test('the weight settings group exposes every kind',()=>{
  const [group]=weightConfigGroups('live-comments')
  assert.equal(group.id,'world:live-comments.weights')
  assert.equal(group.owner,'world:live-comments')
  for(const kind of KINDS){
    const prop=group.schema.properties[`worlds.live-comments.weights.${kind}`]
    assert.equal(prop.type,'number')
    assert.equal(prop['x-hot'],true)
  }
})
