// 验证兜底动作方向不再泄漏元指令，且各意图都有可执行描述
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

// 元指令特征：写着“请/必须写清……”，模型拿不到具体内容，等于没写。
const META_PATTERNS = /必须写清|请写清|如需移动|请根据|待补充|待填/

const cases = [
  { idea: '女主如神明般降临现场', wantLead: '女主' },
  { idea: '男主在废墟广场与敌人开始交手，激烈打斗', wantLead: '男主' },
  { idea: '女主在雨夜街头被追赶，一路奔跑逃跑', wantLead: '女主' },
  { idea: '女主在舞台跳一段街舞', wantLead: '女主' },
  { idea: '女主在雨夜发现男友背叛，克制情绪后转身离开', wantLead: '女主' },
]

for (const c of cases) {
  const intentLabel = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, intentLabel)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: scene.protagonist.possessive }
  const plans = planSceneToShots(scene, intentLabel.recommendedMovements)
  const style = getStylePreset('hongguo_short_drama')

  const baseShots = plans.map((p) => ({
    id: p.id,
    title: p.title,
    shotSize: p.shotSize,
    movement: p.movement,
    prompt: p.timeBlocks.join('；') + '。',
    transition: p.transition,
    audit: '',
  }))

  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults)
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, style)

  const tag = intentLabel.intent + '（' + c.idea.slice(0, 10) + '）'
  const all = compiled.shots.map((s) => s.prompt).join('\n')

  const dirty = all.match(META_PATTERNS)
  check(tag + ' 无元指令泄漏', !dirty, dirty ? '命中: ' + [...new Set(dirty)].join(',') : '')

  check(tag + ' 主角正确=' + c.wantLead, scene.protagonist.label === c.wantLead, '实际=' + scene.protagonist.label)

  compiled.shots.forEach((s) => {
    const m = s.prompt.match(/^动作方向[:：]\s*(.+)$/m)
    check(tag + ' ' + s.id + ' 动作方向可执行', !!m && m[1].trim().length > 5 && !META_PATTERNS.test(m[1]),
      m ? m[1] : '未找到动作方向行')
  })
}

console.log('')
console.log('兜底方向描述专项：' + pass + ' 通过 / ' + fail + ' 失败')
