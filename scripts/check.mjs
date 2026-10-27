import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import def from '../index.js'
const root=fileURLToPath(new URL('..',import.meta.url)),framework=resolve(root,'../Coopanion/resources/app/build/cortico')
const {dryMountWorld}=await import(pathToFileURL(join(framework,'src/extensions/dry-mount.ts')))
const {parseExtensionManifest}=await import(pathToFileURL(join(framework,'src/extensions/manifest.ts')))
const {exportDescribe,checkDescribe}=await import(pathToFileURL(join(framework,'src/extensions/describe-export.ts')))
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));assert.ok(parseExtensionManifest(pkg).ok)
for(const f of [pkg.cortico.webUiClient,pkg.cortico.webUiStyle])assert.ok(existsSync(join(root,f)))
assert.equal(readFileSync(join(root,'native/worker.ps1'),'utf8').charCodeAt(0),0xfeff,'PowerShell 5 UTF-8 BOM required')
const scratch=mkdtempSync(join(tmpdir(),'livecom-contract-')),opts={scratchDir:scratch,packageDir:root,repoRoot:framework,hasWebUiClient:true}
try{
  const descriptor=await exportDescribe('world',def,opts)
  if(process.argv.includes('--write-describe'))writeFileSync(join(root,'describe.json'),JSON.stringify(descriptor,null,2)+'\n')
  const report=await dryMountWorld(def,opts)
  const describeReport=await checkDescribe('world',def,pkg.cortico.describe,opts)
  report.ok.push(...describeReport.ok);report.warnings.push(...describeReport.warnings);report.failures.push(...describeReport.failures)
  console.log(JSON.stringify(report,null,2));assert.deepEqual(report.failures,[])
}finally{rmSync(scratch,{recursive:true,force:true})}
