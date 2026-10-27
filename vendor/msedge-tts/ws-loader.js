/**
 * The `ws` client, resolved when the first socket is dialled instead of at import time.
 *
 * The vendored Edge TTS client only needs a WebSocket class, but hard-requiring the package at
 * import time would make the whole extension fail to load wherever `ws` is not installed yet —
 * a fresh install, or a Coopanion whose extension dependencies were pruned. So the class below
 * looks the library up on demand, in this order:
 *
 *   1. this extension's own node_modules/ws (what scripts/install.mjs provisions)
 *   2. <Coopanion>/data/extensions/node_modules/ws (the dependency set the other extensions share)
 *   3. the bare `ws` specifier, in case the host resolves it some other way
 *
 * When none resolves, the error names the fix instead of surfacing MODULE_NOT_FOUND from deep
 * inside a synthesis attempt.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const vendorDir = dirname(fileURLToPath(import.meta.url))
/** <extension root>/vendor/msedge-tts → <extension root> */
const pluginRoot = dirname(dirname(vendorDir))

let cached = null

/** The extension roots that may carry a node_modules/ws, nearest first. */
function candidateRoots() {
  const roots = [pluginRoot]
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  if (resources) roots.push(join(dirname(resources), 'data', 'extensions'))
  const override = process.env.LIVECOM_EXTENSIONS_DIR
  if (override) roots.push(override)
  return roots
}

/** The directory of the `ws` package this process can load, or '' when there is none. */
export function wsPackageDir() {
  for (const root of candidateRoots()) {
    const dir = join(root, 'node_modules', 'ws')
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return ''
}

/** True when a WebSocket library resolved; the panel shows this so a missing dependency is visible before a reply tries to speak. */
export function webSocketAvailable() {
  return wsPackageDir() !== ''
}

function resolveImpl() {
  if (cached) return cached
  const dir = wsPackageDir()
  for (const spec of dir ? [dir, 'ws'] : ['ws']) {
    try {
      const mod = require(spec)
      const impl = typeof mod === 'function' ? mod : (mod && (mod.WebSocket ?? mod.default))
      if (typeof impl === 'function') {
        cached = impl
        return impl
      }
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `EDGE_TTS_NO_WS: 找不到 WebSocket 库（ws）。把 ws 复制到 ${join(pluginRoot, 'node_modules', 'ws')}，`
    + '或让 Coopanion 的扩展依赖里保留一份 ws，然后重试朗读。',
  )
}

/**
 * A stand-in for the `ws` default export. Constructing it hands back a real socket, so the
 * vendored client sees the library it expects while nothing is loaded before it is needed.
 */
export default class WebSocketClient {
  constructor(url, options) {
    const Impl = resolveImpl()
    return new Impl(url, options)
  }

  static get CONNECTING() {
    return 0
  }

  static get OPEN() {
    return 1
  }

  static get CLOSING() {
    return 2
  }

  static get CLOSED() {
    return 3
  }
}
