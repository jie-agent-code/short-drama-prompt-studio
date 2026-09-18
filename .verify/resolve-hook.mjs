// Node ESM 解析钩子：让无扩展名的相对引用（如 './state'）能解析到 .ts 文件。
// Next 的打包器默认支持省略扩展名，但 Node 直跑 .ts/.mts 时需要显式解析。
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const CANDIDATES = ['.ts', '.tsx', '.mts', '/index.ts']

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const base = context.parentURL
      ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      : specifier
    if (!path.extname(base) || !existsSync(base)) {
      for (const ext of CANDIDATES) {
        const candidate = base + ext
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true }
        }
      }
    }
  }
  return nextResolve(specifier, context)
}
