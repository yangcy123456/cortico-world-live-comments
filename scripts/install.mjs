import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,realpathSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'

const root=fileURLToPath(new URL('..',import.meta.url)),app=resolve(root,'../Coopanion'),dir=join(app,'data/extensions'),base='http://127.0.0.1:17788',name='cortico-world-live-comments'
const hash=data=>createHash('sha256').update(data).digest('hex')
function installed(){
  const manifest=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));const packages={}
  for(const [name,spec]of Object.entries(manifest.dependencies||{})){
    const p=join(dir,'node_modules',name),file=join(p,'package.json')
    if(!existsSync(file)){packages[name]={spec,missing:true};continue}
    const raw=readFileSync(file),pkg=JSON.parse(raw),files={}
    for(const f of [pkg.main,pkg.cortico?.webUiClient,pkg.cortico?.webUiStyle].filter(f=>typeof f==='string'))if(existsSync(join(p,f)))files[f]=hash(readFileSync(join(p,f)))
    packages[name]={spec,path:realpathSync(p),version:pkg.version,manifest:hash(raw),files}
  }
  return {manifest,packages}
}
async function api(path,body){
  const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const data=await r.json();if(!r.ok)throw new Error(`${path}: ${r.status} ${data.error||JSON.stringify(data)}`);return data
}
const before=installed(),cfgFile=join(app,'data/home/companion/config.json'),cfgBefore=readFileSync(cfgFile),lock=join(dir,'pnpm-lock.yaml'),lockBefore=existsSync(lock)?readFileSync(lock,'utf8'):''
const backup=join(root,'_backups',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(backup,{recursive:true})
for(const f of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'])if(existsSync(join(dir,f)))copyFileSync(join(dir,f),join(backup,f))
copyFileSync(cfgFile,join(backup,'config.json'));writeFileSync(join(backup,'before.json'),JSON.stringify(before,null,2))
// This build validates the raw path with an ASCII-only whitelist before resolving it.
const targetPath=relative(join(app,'resources/app/build/cortico'),root).replaceAll('\\','/')
const check=await api('/api/extensions/check',{target:{path:targetPath},kind:'world'});assert.equal(check.name,name)
if(!before.packages[name])await api('/api/extensions/install',{path:targetPath})
const after=installed()
for(const [n,info]of Object.entries(before.packages))assert.deepEqual(after.packages[n],info,`Existing extension changed: ${n}; inspect ${backup}`)
const lockAfter=existsSync(lock)?readFileSync(lock,'utf8'):''
const packagesBlock=text=>text.includes('\npackages:')?text.slice(text.indexOf('\npackages:')):''
assert.equal(packagesBlock(lockAfter),packagesBlock(lockBefore),'Unrelated dependency lock entries changed; inspect backup')
assert.equal(hash(readFileSync(cfgFile)),hash(cfgBefore),'Runtime config changed during installation; inspect before proceeding')
const result={ok:true,installed:name,version:check.version,backup,existingExtensionsUnchanged:Object.keys(before.packages),configUnchanged:true,dependencyPackagesUnchanged:true,next:'重启空闲的 Coopanion 进程，再到 World 总览启用窗口评论；选择直播窗口后框选评论区。'}
writeFileSync(join(backup,'install-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
