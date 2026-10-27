import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {NativeBridge} from '../lib/native.js'
import {normalize} from '../lib/comments.js'

const scratch=mkdtempSync(join(tmpdir(),'livecom-native-')),powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
const children=[];const b=new NativeBridge({timeoutMs:30000})
async function fixture({draft='',keep=false,edit=false}={}){
  const id=String(Date.now());const output=join(scratch,id+'.txt');let errors=''
  const child=spawn(powershell,['-NoProfile','-NonInteractive','-Sta','-File',fileURLToPath(new URL('../tests/fixture.ps1',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,LIVEWIN_FIXTURE_ID:id,LIVEWIN_FIXTURE_OUT:output,LIVEWIN_FIXTURE_DRAFT:draft,LIVEWIN_FIXTURE_KEEP:keep?'1':'0',LIVEWIN_FIXTURE_EDIT:edit?'1':'0'}})
  children.push(child);child.stderr.on('data',s=>errors+=s)
  const hwnd=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture timeout '+errors)),15000);createInterface({input:child.stdout}).on('line',line=>{if(line.startsWith('HWND=')){clearTimeout(timer);resolve(line.slice(5))}});child.on('exit',()=>{clearTimeout(timer);reject(new Error('Fixture exited '+errors))})})
  const target=(await b.request('windows')).windows.find(w=>w.hwnd===hwnd);assert.ok(target,'fixture window registered')
  return {target,output,child}
}
try{
  const f=await fixture();const crop={x:.55,y:.10,width:.44,height:.50},points={input:{x:.70,y:.83},send:{x:.92,y:.85}}
  const shot=await b.request('capture',{target:f.target,crop,ocr:true});assert.match(normalize(shot.ocr.lines.map(r=>r.text).join('')),/你好/)
  const controls=await b.request('inspect',{target:f.target});assert.ok(controls.controls.some(c=>c.value))
  const calibration=await b.request('calibrate',{target:f.target,points});assert.ok(calibration.input.runtimeId);assert.equal(existsSync(f.output),false,'calibration must not send')
  await assert.rejects(b.request('send',{target:f.target,points,calibration:{...calibration,width:1},text:'no'}),/LAYOUT_CHANGED/)
  await assert.rejects(b.request('send',{target:{...f.target,pid:1},points,calibration,text:'no'}),/WINDOW_STALE/)
  assert.equal(existsSync(f.output),false,'invalid target/layout must not send')
  const result=await b.request('send',{target:f.target,points,calibration,text:'测试回复'});assert.equal(result.state,'input-cleared');assert.equal(readFileSync(f.output,'utf8'),'测试回复\n')
  const busy=await fixture({draft:'用户原稿'});const bc=await b.request('calibrate',{target:busy.target,points})
  await assert.rejects(b.request('send',{target:busy.target,points,calibration:bc,text:'不要覆盖'}),/INPUT_BUSY/);assert.equal(existsSync(busy.output),false)
  const edited=await fixture({edit:true});const ec=await b.request('calibrate',{target:edited.target,points})
  await assert.rejects(b.request('send',{target:edited.target,points,calibration:ec,text:'must not send'}),/INPUT_MISMATCH/);assert.equal(existsSync(edited.output),false,'operator edit while waiting must not be sent')
  const uncertain=await fixture({keep:true});const uc=await b.request('calibrate',{target:uncertain.target,points})
  const unknown=await b.request('send',{target:uncertain.target,points,calibration:uc,text:'不重试'});assert.equal(unknown.state,'unknown');assert.equal(readFileSync(uncertain.output,'utf8'),'不重试\n')
  console.log(JSON.stringify({ok:true,ocr:shot.ocr.lines.map(r=>r.text),checks:['window capture + local Chinese OCR','read-only calibration','stale window guard','layout guard','verified input + invoke + clear','existing draft preserved','operator edit before send preserved','unknown receipt (no retry)']}))
}finally{b.close();for(const child of children)child.kill();await new Promise(r=>setTimeout(r,300));rmSync(scratch,{recursive:true,force:true})}
