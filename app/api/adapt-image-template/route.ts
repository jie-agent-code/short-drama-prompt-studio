import { NextResponse } from 'next/server'
import { getBailianConfig } from '../../lib/bailian-config'

function requestedValues(change: string) {
  const name = change.match(/(?:名字|姓名|名称)\s*(?:改为|设为|是|为)\s*[“"「]?([^，。；;\n"”」]+)/)?.[1]?.trim()
  const identity = change.match(/(?:身份|职业|角色)\s*(?:改为|设为|是|为)\s*[“"「]?([^，。；;\n"”」]+)/)?.[1]?.trim()
  return { name, identity }
}

export async function POST(req: Request) {
  const { template = '', change = '' } = await req.json()
  if (!template.trim() || !change.trim()) {
    return NextResponse.json({ message: '请先选择图片提示词模板并填写修改要求。' }, { status: 400 })
  }
  const { key, baseUrl: base, model } = await getBailianConfig()
  if (!key) {
    return NextResponse.json({ message: '未检测到 DASHSCOPE_API_KEY。请在右上角“百炼配置”窗口保存 Key，保存后会立即生效。' }, { status: 503 })
  }
  try {
    const requested = requestedValues(change)
    const system = '你是专业图片生成提示词改编 Agent。你的任务是做“格式锁定改写”：模板是唯一输出骨架。只输出改写后的单条图片提示词，不要解释、标题、Markdown 或修改报告。必须原样保留模板的段落数量、字段顺序、标签、标点、换行结构和未被要求修改的内容；只替换与用户修改相关的值，并让新身份带来合理匹配的服装、道具、姿态和环境细节。用户提出的每一项修改都必须出现在最终提示词中。禁止把修改要求附加在模板末尾，禁止返回原模板。'
    const user = `【原始模板，必须按此格式输出】\n${template}\n【修改要求】\n${change}\n【硬性校验】\n${requested.name ? `最终结果必须出现姓名“${requested.name}”。` : ''}${requested.identity ? `最终结果必须出现身份“${requested.identity}”，并将与身份相关的服装、道具和动作改得合理。` : ''}\n只返回改写后的完整模板。`
    let response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.15 }) })
    if (!response.ok) {
      const detail = await response.text()
      return NextResponse.json({ message: `百炼改写失败（HTTP ${response.status}）。请检查 Key、Base URL 和模型名。`, detail: detail.slice(0, 180) }, { status: 502 })
    }
    let data = await response.json()
    let prompt = data.choices?.[0]?.message?.content?.trim()
    if (!prompt) return NextResponse.json({ message: '百炼没有返回改写结果，请重试。' }, { status: 502 })
    const missing = (requested.name && !prompt.includes(requested.name)) || (requested.identity && !prompt.includes(requested.identity))
    if (missing) {
      response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: `${user}\n上一次结果没有通过校验。请重新完整输出，必须包含指定姓名和身份，且不得改变模板格式。` }], temperature: 0.05 }) })
      if (!response.ok) return NextResponse.json({ message: '改写结果未通过身份校验，请重试。' }, { status: 502 })
      data = await response.json(); prompt = data.choices?.[0]?.message?.content?.trim()
      if (!prompt || (requested.name && !prompt.includes(requested.name)) || (requested.identity && !prompt.includes(requested.identity))) return NextResponse.json({ message: '模型未按要求写入姓名或身份，请把修改写得更明确后重试。' }, { status: 502 })
    }
    return NextResponse.json({ mode: 'dashscope', prompt })
  } catch {
    return NextResponse.json({ message: '无法连接百炼，请检查网络或 Base URL。' }, { status: 502 })
  }
}
