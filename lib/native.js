import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export class NativeBridge {
  constructor({ timeoutMs = 20000 } = {}) { this.timeoutMs=timeoutMs; this.child=null; this.pending=new Map(); this.seq=0 }
  open() {
    if (process.platform !== 'win32') throw new Error('此插件的窗口采集目前只支持 Windows')
    if(this.child)return
    const exe=join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
    const child=spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../native/worker.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    this.child=child; let stderr=''
    child.stderr.setEncoding('utf8'); child.stderr.on('data',s=>{stderr=(stderr+s).slice(-4000)})
    createInterface({input:child.stdout}).on('line',line=>{
      let data;try{data=JSON.parse(line)}catch{return}
      const p=this.pending.get(data.id);if(!p)return
      this.pending.delete(data.id);clearTimeout(p.timer)
      data.ok?p.resolve(data.result):p.reject(new Error(data.error||'本地采集失败'))
    })
    child.on('error',err=>this.fail(child,err))
    child.on('exit',()=>this.fail(child,new Error(stderr.trim()||'本地采集进程退出')))
  }
  fail(child,error) {
    if(this.child!==child)return
    this.child=null
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error)}
    this.pending.clear();child.kill()
  }
  request(op,args={}) {
    this.open(); const child=this.child; const id=++this.seq
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail(child,new Error(`本地 ${op} 超时，已停止辅助进程；发送操作不得自动重试`)),this.timeoutMs)
      this.pending.set(id,{resolve,reject,timer})
      child.stdin.write(JSON.stringify({id,op,args})+'\n',err=>{if(err)this.fail(child,err)})
    })
  }
  close(){if(this.child)this.fail(this.child,new Error('直播互动已停止'))}
}
