// 验证角色识别顺序改动后，审核器不会对「含异性配角的正常剧情」产生假阳性
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

// 这些剧情都合法包含异性配角，不该被判成角色漂移
const cases = [
  { idea: '妻子在雨夜发现丈夫背叛，克制情绪后转身离开', wantLead: '女主' },
  { idea: '女主在街头被男主的车险些撞到，她抬手挡了一下', wantLead: '女主' },
  { idea: '丈夫发现妻子藏了秘密，他克制情绪后转身离开', wantLead: '男主' },
  { idea: '女主如神明般降临现场', wantLead: '女主' },
  { idea: '男主在废墟广场与敌人开始交手，激烈打斗', wantLead: '男主' },
]

for (const c of cases) {
  const intentLabel = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, intentLabel)
  const lead = {
    label: scene.protagonist.label,
    pronoun: scene.protagonist.pronoun,
    possessive: scene.protagonist.pronoun === '他' ? '他的' : scene.protagonist.pronoun === '她' ? '她的' : '主角的',
  }
  const plans = planSceneToShots(scene, intentLabel.recommendedMovements)
  const baseShots = plans.map((p) => ({
    id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement,
    prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '',
  }))

  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults)
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const tag = c.idea.slice(0, 14)

  check(tag + ' 角色=' + c.wantLead, scene.protagonist.label === c.wantLead, '实际=' + scene.protagonist.label)
  check(tag + ' 无 gender-drift', !result.after.issues.some((i) => i.code === 'gender-drift'),
    JSON.stringify(result.after.issues.filter((i) => i.code === 'gender-drift')))
  check(tag + ' 无 pronoun-drift', !result.after.issues.some((i) => i.code === 'pronoun-drift'),
    JSON.stringify(result.after.issues.filter((i) => i.code === 'pronoun-drift')))
  check(tag + ' 审核通过', result.after.passed === true, 'score=' + result.after.score + ' issues=' + JSON.stringify(result.after.issues.map((i) => i.code)))

  // 主角代词必须与判定性别一致，不能出现「女主…他的」
  const body = compiled.shots.map((s) => s.prompt).join('\n')
  if (c.wantLead === '女主') {
    check(tag + ' 未把主角写成他', !/女主[^，。；\n]{0,10}他的/.test(body), '出现「女主…他的」')
  }
}

console.log('')
console.log('角色识别与审核协同专项：' + pass + ' 通过 / ' + fail + ' 失败')
