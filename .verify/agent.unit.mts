// 验证 Agent 链路与正式生成链路结果一致（消除两套实现）
import { runPromptAgent } from '../app/lib/agent/graph.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { protagonistFrom } from '../app/lib/prompt/scene-card.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

const cases = [
  { idea: '女主如神明般降临现场', wantLead: '女主', wantIntent: 'epic_arrival' },
  { idea: '男主如神明般降临现场', wantLead: '男主', wantIntent: 'epic_arrival' },
  { idea: '妻子在雨夜发现丈夫背叛，克制情绪后转身离开', wantLead: '女主', wantIntent: 'dramatic' },
  { idea: '女主不要跳舞，她如神明般降临现场', wantLead: '女主', wantIntent: 'epic_arrival' },
  { idea: '男主在废墟广场与敌人开始交手，激烈打斗', wantLead: '男主', wantIntent: 'action' },
  { idea: '女主在雨夜街头被追赶，一路奔跑逃跑', wantLead: '女主', wantIntent: 'chase' },
  { idea: '女主在舞台跳一段街舞', wantLead: '女主', wantIntent: 'dance' },
]

console.log('=== 1. Agent 与正式链路角色/意图一致性 ===')
for (const c of cases) {
  const state = await runPromptAgent({ idea: c.idea, movements: ['跟拍'] })
  const officialLead = protagonistFrom(c.idea)
  const officialIntent = analyzePlotIntent(c.idea).intent

  check(c.idea.slice(0, 14) + ' 角色一致(' + c.wantLead + ')',
    state.lead?.label === officialLead.label && state.lead?.label === c.wantLead,
    'agent=' + state.lead?.label + ' official=' + officialLead.label)

  check(c.idea.slice(0, 14) + ' 意图一致(' + c.wantIntent + ')',
    state.intent === officialIntent && state.intent === c.wantIntent,
    'agent=' + state.intent + ' official=' + officialIntent)

  check(c.idea.slice(0, 14) + ' 代词同步',
    state.lead?.pronoun === officialLead.pronoun && state.lead?.pronoun !== '角色',
    'agent=' + state.lead?.pronoun + ' official=' + officialLead.pronoun)
}

console.log('')
console.log('=== 2. Agent 链路真的产出镜头（旧实现 shots 恒为空） ===')
const s = await runPromptAgent({ idea: '女主如神明般降临现场', movements: ['跟拍'] })
check('Agent 产出 3 个镜头', s.shots.length === 3, '实际=' + s.shots.length)
check('Agent 镜头编号为 S01/S02/S03', s.shots.map((x) => x.id).join(',') === 'S01,S02,S03', s.shots.map((x) => x.id).join(','))
check('Agent 走到 complete 阶段', s.stage === 'complete', '实际=' + s.stage)
check('Agent 无执行错误', s.errors.length === 0, JSON.stringify(s.errors))
check('Agent 记录了审核分数', typeof s.metadata?.continuityScore === 'number', 'metadata=' + JSON.stringify(s.metadata))

console.log('')
console.log('=== 3. Agent 审核能力（禁项/角色硬规则） ===')
const s2 = await runPromptAgent({ idea: '女主如神明般降临现场，不要跳舞', movements: ['跟拍'] })
const allPrompt = s2.shots.map((x) => x.prompt).join('\n')
const bodyOnly = allPrompt.split('\n').filter((l) => !/^\s*(负面约束|禁止项|禁忌)\s*[:：]/.test(l)).join('\n')
// 否定句「不要跳舞」本身是合规声明，用分句粒度判断是否真的在描述该动作
const assertedDance = bodyOnly
  .split(/[\n，。；;、！？!?]+/)
  .some((cl) => cl.includes('跳舞') && !/^(不|禁止|严禁|杜绝|避免|不可|不得|无|没有|防止|切勿|不要|别)/.test(cl.trim()))
check('Agent 链路未在正文正面描述跳舞', !assertedDance, '命中分句: ' + bodyOnly.split(/[\n，。；;、！？!?]+/).filter((cl) => cl.includes('跳舞')).join(' | '))
check('Agent 链路 intent=epic_arrival（未被舞蹈带偏）', s2.intent === 'epic_arrival', '实际=' + s2.intent)

console.log('')
console.log('Agent 一致性专项：' + pass + ' 通过 / ' + fail + ' 失败')
