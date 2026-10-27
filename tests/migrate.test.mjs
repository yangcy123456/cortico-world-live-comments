import assert from 'node:assert/strict'
import {mkdtempSync,existsSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {LEGACY_ID,MIGRATED_KEY,legacyPatch,legacySection,moveMemory} from '../lib/migrate.js'

const scratch=()=>{const dir=mkdtempSync(join(tmpdir(),'livecom-migrate-'));return {dir,clean:()=>rmSync(dir,{recursive:true,force:true})}}
const config=(dir,worlds)=>{const file=join(dir,'config.json');writeFileSync(file,JSON.stringify({worlds},null,1),'utf8');return file}

test('改名只搬一次：记录迁移标记用的旧 id 是 live-window',()=>{
  assert.equal(LEGACY_ID,'live-window')
  assert.equal(MIGRATED_KEY,'migratedFrom')
})

test('legacySection 读得到旧段落，坏文件与缺文件都回答 null',()=>{
  const {dir,clean}=scratch()
  try{
    const file=config(dir,{'live-window':{target:{hwnd:'1'},cropConfirmed:true}})
    assert.equal(legacySection(file).crop,undefined)
    assert.equal(legacySection(file).cropConfirmed,true)
    assert.equal(legacySection(file,'live-comments'),null)
    assert.equal(legacySection(join(dir,'missing.json')),null)
    writeFileSync(join(dir,'broken.json'),'{not json','utf8')
    assert.equal(legacySection(join(dir,'broken.json')),null)
  }finally{clean()}
})

test('legacyPatch 只搬有意义的设置，纯默认值不覆盖新安装',()=>{
  assert.deepEqual(legacyPatch(null),{})
  assert.deepEqual(legacyPatch({enabled:true,selfNames:[]}),{})
  const patch=legacyPatch({enabled:true,target:{hwnd:'395458'},crop:{x:0.8,y:0.3,width:0.1,height:0.6},cropConfirmed:true,layout:{width:2560,height:1528,dpi:144},selfNames:['主播'],weights:{chat:4,gift:2},voice:'zh-CN-YunxiNeural',outputDevice:'LegionZone虚拟扬声器'})
  assert.equal(patch.cropConfirmed,true)
  assert.equal(patch.target.hwnd,'395458')
  assert.deepEqual(patch.selfNames,['主播'])
  assert.deepEqual(patch.weights,{chat:4,gift:2})
  assert.equal(patch.voice,'zh-CN-YunxiNeural')
  assert.equal(patch.outputDevice,'LegionZone虚拟扬声器')
  assert.equal('enabled' in patch,false,'enabled 由部署自己决定，不随改名搬')
})

test('只保存过窗口没有框选也算有意义（不然用户要重新绑定一次）',()=>{
  const patch=legacyPatch({target:{hwnd:'1903058'}})
  assert.deepEqual(patch.target,{hwnd:'1903058'})
})

test('旧记忆从 dataDir 根目录搬到 worlds/<id>/，已有新文件就不覆盖',()=>{
  const {dir,clean}=scratch()
  try{
    writeFileSync(join(dir,'memory.json'),JSON.stringify({version:1,entries:[{id:'a',sender:'观众',text:'你好',kind:'chat',at:1}]}),'utf8')
    const to=join(dir,'live-comments')
    assert.equal(moveMemory({fromDir:dir,toDir:to}),true)
    const moved=JSON.parse(readFileSync(join(to,'memory.json'),'utf8'))
    assert.equal(moved.entries.length,1)
    assert.equal(moveMemory({fromDir:dir,toDir:to}),false,'第二次不再复制')
    mkdirSync(join(dir,'kept'),{recursive:true})
    writeFileSync(join(dir,'kept','memory.json'),JSON.stringify({version:1,entries:[]}),'utf8')
    assert.equal(moveMemory({fromDir:dir,toDir:join(dir,'kept')}),false,'新文件存在时不覆盖')
    assert.equal(existsSync(join(to,'memory.json')),true)
  }finally{clean()}
})
