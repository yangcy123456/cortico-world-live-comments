/** Where this extension and its dependencies live, so the speech engine can tell what is installed. */
import {existsSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

/** <extension root>; this file sits in lib/speech/. */
export const pluginRoot=dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * The directories that hold installed extensions, nearest first.
 *
 * Coopanion keeps them in <app>/data/extensions next to its resources directory. A packaged
 * build passes that path through process.resourcesPath; a source run or a test has no such
 * value, so the environment override covers those.
 */
export function extensionRoots(){
  const roots=[]
  const resources=typeof process.resourcesPath==='string'?process.resourcesPath:''
  if(resources)roots.push(join(dirname(resources),'data','extensions'))
  const override=process.env.LIVECOM_EXTENSIONS_DIR||process.env.LIVEWIN_EXTENSIONS_DIR
  if(override)roots.push(override)
  return roots
}

/** True when another extension package is present on disk (installed, or linked into the set). */
export function packageInstalled(name){
  for(const root of extensionRoots()){
    if(existsSync(join(root,'node_modules',name,'package.json')))return true
    if(existsSync(join(root,name,'package.json')))return true
  }
  return false
}

/** This extension's own dependency directory, where scripts/install.mjs provisions `ws`. */
export function localNodeModules(){
  return join(pluginRoot,'node_modules')
}
