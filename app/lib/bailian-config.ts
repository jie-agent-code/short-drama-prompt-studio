import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type BailianConfig = { key: string; baseUrl: string; model: string }

function parseEnv(source: string) {
  const values: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

// Read on each request so a key saved from the local settings window works immediately.
export async function getBailianConfig(): Promise<BailianConfig> {
  let local: Record<string, string> = {}
  try { local = parseEnv(await readFile(path.join(process.cwd(), '.env.local'), 'utf8')) } catch { /* Optional local config. */ }
  return {
    key: local.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    baseUrl: (local.DASHSCOPE_BASE_URL || process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
    model: local.DASHSCOPE_MODEL || process.env.DASHSCOPE_MODEL || 'qwen-plus'
  }
}
