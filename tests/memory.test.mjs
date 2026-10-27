import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CommentMemory,MEMORY_LIMIT,memoryLine} from '../lib/memory.js'

const fresh=(options={})=>new CommentMemory({dir:mkdtempSync(join(tmpdir(),'lw-mem-')),...options})

test('records an audience line and keeps it after reload',()=>{
  const mem=fresh()
  const row=mem.add({id:'m1',sender:'熬夜牛马_悲',text:'你好',kind:'chat',at:1000})
  assert.equal(row.text,'你好')
  mem.flush()
  const again=new CommentMemory({dir:mem.dir})
  assert.equal(again.size,1)
  assert.equal(again.get('m1').sender,'熬夜牛马_悲')
})

test('the same person repeating the same words is one memory',()=>{
  const mem=fresh()
  mem.add({id:'a',sender:'观众',text:'111',at:1000})
  mem.add({id:'b',sender:'观众',text:'111',at:2000})
  assert.equal(mem.size,1)
  mem.add({id:'c',sender:'观众',text:'111',at:1000+11*60*1000})
  assert.equal(mem.size,2)
})

test('empty text is refused and text is clipped',()=>{
  const mem=fresh()
  assert.equal(mem.add({id:'x',sender:'观众',text:'   '}),null)
  const long=mem.add({id:'y',sender:'观众',text:'字'.repeat(400)})
  assert.equal(Array.from(long.text).length,200)
})

test('oldest entries drop once the limit is reached',()=>{
  const mem=fresh({limit:3})
  for(let n=0;n<5;n++)mem.add({id:`m${n}`,sender:'观众',text:`第${n}句`,at:1000+n*600000})
  assert.equal(mem.size,3)
  assert.deepEqual(mem.list().map(r=>r.text),['第2句','第3句','第4句'])
})

test('editing rewrites the text and a reply sticks to its memory',()=>{
  const mem=fresh()
  mem.add({id:'m1',sender:'观众',text:'在干嘛',at:1000})
  mem.update('m1',{text:'在干嘛呢'})
  mem.attachReply({id:'m1',sender:'观众',text:'在干嘛呢'},'在直播呢')
  const row=mem.get('m1')
  assert.equal(row.text,'在干嘛呢')
  assert.equal(row.reply,'在直播呢')
  assert.match(memoryLine(row),/你回过：在直播呢/)
  assert.throws(()=>mem.update('m1',{text:'  '}),/不能为空/)
  assert.throws(()=>mem.update('nope',{text:'x'}),/不存在/)
})

test('reply matches by sender and words when the id moved',()=>{
  const mem=fresh()
  mem.add({id:'old',sender:'观众',text:'吃了吗',at:1000})
  const entry=mem.attachReply({id:'new',sender:'观众',text:'吃了吗'},'吃了')
  assert.equal(entry.id,'old')
  assert.equal(entry.reply,'吃了')
})

test('deleting and clearing report what disappeared',()=>{
  const mem=fresh()
  mem.add({id:'a',sender:'观众',text:'一',at:1000})
  mem.add({id:'b',sender:'观众',text:'二',at:2000})
  assert.deepEqual(mem.remove('a'),{removed:1})
  assert.throws(()=>mem.remove('a'),/不存在/)
  assert.deepEqual(mem.clear(),{removed:1})
  assert.equal(mem.size,0)
})

test('digest is prompt-ready and says so when empty',()=>{
  const mem=fresh()
  assert.match(mem.digest(10),/还没有记住/)
  mem.add({id:'g',sender:'观众甲',text:'送出火箭',kind:'gift',at:1000})
  mem.add({id:'n',sender:'观众乙',text:'晚上好',kitchen:'x',kind:'chat',at:2000})
  assert.match(mem.digest(10),/- 观众甲（礼物）：送出火箭/)
  assert.match(mem.digest(10),/- 观众乙（弹幕）：晚上好/)
})

test('a corrupt file is set aside instead of crashing the world',()=>{
  const dir=mkdtempSync(join(tmpdir(),'lw-mem-'))
  writeFileSync(join(dir,'memory.json'),'{not json','utf8')
  const mem=new CommentMemory({dir})
  assert.equal(mem.size,0)
  assert.match(mem.lastError,/无法读取/)
  assert.ok(existsSync(join(dir,'memory.json.broken')))
  mem.add({id:'ok',sender:'观众',text:'还能记',at:1000})
  mem.flush()
  assert.ok(JSON.parse(readFileSync(join(dir,'memory.json'),'utf8')).entries.length===1)
})

test('the limit is applied on load too',()=>{
  const dir=mkdtempSync(join(tmpdir(),'lw-mem-'))
  const rows=Array.from({length:5},(_,n)=>({id:`m${n}`,sender:'观众',text:`第${n}句`,kind:'chat',at:1000+n}))
  writeFileSync(join(dir,'memory.json'),JSON.stringify({version:1,entries:rows}),'utf8')
  const mem=new CommentMemory({dir,limit:2})
  assert.deepEqual(mem.list().map(r=>r.text),['第3句','第4句'])
  assert.equal(MEMORY_LIMIT,500)
  assert.ok(readdirSync(dir).includes('memory.json'))
})
