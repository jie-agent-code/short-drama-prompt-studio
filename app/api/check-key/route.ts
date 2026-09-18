import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { key, baseUrl, model } = await req.json()
  if (!key || typeof key !== 'string' || key.trim().length < 10) {
    return NextResponse.json({ ok: false, message: '请先输入完整的 API Key。' }, { status: 400 })
  }
  const base = String(baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({ model: model || 'qwen-plus', messages: [{ role: 'user', content: '仅回复 OK' }], max_tokens: 4, temperature: 0 })
    })
    if (response.ok) return NextResponse.json({ ok: true, message: '连接成功，Key 有效。' })
    const detail = await response.text()
    if (response.status === 401 || response.status === 403) return NextResponse.json({ ok: false, message: '鉴权失败：Key 无效、已过期，或与 Base URL 地域不匹配。' }, { status: 401 })
    return NextResponse.json({ ok: false, message: `百炼返回 HTTP ${response.status}，请检查模型名或 Base URL。`, detail: detail.slice(0, 200) }, { status: 502 })
  } catch {
    return NextResponse.json({ ok: false, message: '无法连接百炼，请检查网络或 Base URL。' }, { status: 502 })
  }
}
