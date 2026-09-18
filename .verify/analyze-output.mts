// 直接走本地编译链路，导出成品提示词，用于对照行业标准分镜要素做差距分析
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'

const idea = '女主在豪门酒会被假千金故意泼红酒受辱，她隐忍后退入后台，摘下眼镜戴上项链，霸气推门重回现场'

const intentLabel = analyzePlotIntent(idea)
const scene = buildSceneCard(idea, intentLabel)
const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: scene.protagonist.gender === 'female' ? '她的' : '他的' }
const plans = planSceneToShots(scene, intentLabel.recommendedMovements)
const baseShots = plans.map((p) => ({
  id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement,
  prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '',
}))
const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults)
const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))

console.log('意图:', intentLabel.label, '| 主角:', scene.protagonist.label, '| 场景:', scene.setting.location)
console.log('规划镜头数:', plans.length, '| 审核分:', result.after.score)
console.log('')
compiled.shots.forEach((s) => {
  console.log('========== ' + s.id + ' ==========')
  console.log(s.prompt)
  console.log('')
})

console.log('########## 字段清单 ##########')
const fields = compiled.shots[0].prompt.split('\n').map((l) => l.split('：')[0])
console.log(fields.join(' | '))
