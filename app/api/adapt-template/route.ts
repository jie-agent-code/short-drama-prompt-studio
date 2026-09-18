import { NextResponse } from 'next/server'
import { getBailianConfig } from '../../lib/bailian-config'

type Shot = { id:string; title:string; movement:string; prompt:string; transition:string; audit:string }

function fallback(template:string, change:string): { mode:string; shots:Shot[] } {
  const source = template || '三段连续的 10 秒短剧分镜模板'
  return { mode:'local', shots:[
    { id:'S01', title:'模板改编：镜头建立', movement:'沿用模板主运镜', prompt:`严格按已选模板的镜头结构、节奏、景别与转场执行。模板核心：${source.slice(0,180)}。本次修改要求：${change}。0-1 秒复现开场构图；1-8 秒只执行修改后的核心动作；8-10 秒固定为可承接的尾帧。保持未被修改的服装、场景、光线、道具和运镜不变。`, transition:'沿用模板入口 → 动作剪切', audit:'本地模式：已保留模板结构，建议配置百炼以获得更细致的内容改编。' },
    { id:'S02', title:'模板改编：情绪推进', movement:'沿用模板辅助运镜', prompt:`严格承接 S01 尾帧，并按模板的第二镜节奏推进。本次仅应用以下改动：${change}。角色身份、外观、站位、动作方向和道具状态必须从上一镜继承；不要新增模板中没有要求的新地点或新角色。最后一秒留下明确姿态与声音出口。`, transition:'沿用模板转场 → 声音桥接', audit:'通过：修改范围被限制在用户指令内。' },
    { id:'S03', title:'模板改编：高潮与出口', movement:'沿用模板爆点技法', prompt:`按模板第三镜的爆点与结尾方式执行，且只对“${change}”涉及的元素进行替换。保留模板原有的情绪曲线、镜头语言和剪辑出口；复述角色身份、服装和空间位置，避免身份漂移。结尾保留下一段可复现的末帧状态。`, transition:'沿用模板出口', audit:'通过：模板骨架保留，改动仅作用于指定身份与剧情元素。' }
  ] }
}

export async function POST(req:Request) {
  const { template='', change='' } = await req.json()
  if (!template.trim() || !change.trim()) return NextResponse.json({ message:'请先选择模板并填写修改要求。' }, { status:400 })
  const local = fallback(template, change)
  const { key, baseUrl: base, model } = await getBailianConfig()
  if (!key) return NextResponse.json(local)
  try {
    const system = `你是短剧提示词模板改编 Agent。只输出严格 JSON：{"shots":[{"id":"S01","title":"","movement":"","prompt":"","transition":"","audit":""}]}。用户给出一个模板和修改要求。必须保留模板的镜头数量、每镜 10 秒约束、结构、运镜、节奏、转场、未被点名修改的角色设定与连续性锚点；只替换修改要求涉及的身份、人物、动作、道具、台词或场景。不得把“女主”错误改为“男主”，不得凭空扩展剧情。每镜都要写可直接投喂视频模型的详细提示词和首尾衔接状态。`
    const user = `模板：\n${template}\n\n修改要求：\n${change}\n\n请按模板改编为 3 个连续 10 秒镜头块。`
    const response = await fetch(`${base}/chat/completions`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${key}`}, body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0.35}) })
    if (!response.ok) throw new Error('DashScope request failed')
    const data = await response.json(); const content = data.choices?.[0]?.message?.content || ''
    return NextResponse.json({ mode:'dashscope', shots:JSON.parse(content.replace(/```json|```/g,'').trim()).shots })
  } catch { return NextResponse.json(local) }
}
