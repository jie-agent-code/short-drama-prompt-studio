import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

const allowed = ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_MODEL'] as const

export async function POST(req: Request) {
  const { key, baseUrl, model } = await req.json()
  if (!key || typeof key !== 'string' || key.trim().length < 10) {
    return NextResponse.json({ message: '请输入完整的 API Key。' }, { status: 400 })
  }
  const values: Record<(typeof allowed)[number], string> = {
    DASHSCOPE_API_KEY: key.trim(),
    DASHSCOPE_BASE_URL: String(baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim(),
    DASHSCOPE_MODEL: String(model || 'qwen-plus').trim()
  }
  const envPath = path.join(process.cwd(), '.env.local')
  try {
    let existing = ''
    try { existing = await readFile(envPath, 'utf8') } catch { /* First local configuration. */ }
    const retained = existing.split(/\r?\n/).filter(line => !allowed.some(name => line.startsWith(`${name}=`)))
    const next = [...retained.filter(Boolean), ...allowed.map(name => `${name}=${values[name]}`), ''].join('\n')
    await writeFile(envPath, next, 'utf8')
    return NextResponse.json({ ok: true, message: '已保存到 .env.local，配置即时生效。' })
  } catch {
    return NextResponse.json({ message: '无法写入 .env.local，请确认项目目录有写入权限。' }, { status: 500 })
  }
}
