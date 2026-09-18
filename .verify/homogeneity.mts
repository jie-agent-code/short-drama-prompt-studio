// 验证：不同剧情但相同意图时，规划器产出是否高度雷同
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'

const ideas = [
  '女主在豪门酒会被假千金故意泼红酒受辱，她隐忍后退入后台，戴上项链霸气推门重回现场',
  '女主在医院走廊得知母亲病危，她握紧化验单转身跑向病房',
  '女主在办公室发现同事偷窃自己的方案，她冷静收集证据后当面揭穿',
]

const results = ideas.map((idea) => {
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const plans = planSceneToShots(scene, il.recommendedMovements)
  return { idea, intent: il.intent, location: scene.setting.location, action: scene.event.primaryAction, plans }
})

results.forEach((r, i) => {
  console.log('--- 案例 ' + (i + 1) + ' ---')
  console.log('剧情: ' + r.idea.slice(0, 30))
  console.log('意图: ' + r.intent + ' | 场景: ' + r.location)
  console.log('主角动作: ' + r.action)
  console.log('S01 时间轴: ' + r.plans[0].timeBlocks.join(' | '))
  console.log('S02 时间轴: ' + r.plans[1].timeBlocks.join(' | '))
  console.log('S03 时间轴: ' + r.plans[2].timeBlocks.join(' | '))
  console.log('')
})

// 雷同度检测
const sig = (plans) => plans.map((p) => p.timeBlocks.join('')).join('||')
const s0 = sig(results[0].plans)
const s1 = sig(results[1].plans)
const s2 = sig(results[2].plans)
console.log('=== 雷同度 ===')
console.log('案例1 vs 案例2 时间轴完全相同:', s0 === s1)
console.log('案例1 vs 案例3 时间轴完全相同:', s0 === s2)
console.log('')
console.log('=== 剧情关键词是否进入提示词 ===')
const keywords = ['红酒', '泼', '假千金', '后台', '眼镜', '项链', '推门', '化验单', '母亲', '病房', '方案', '证据']
results.forEach((r, i) => {
  const text = r.plans.map((p) => [p.objective, ...p.timeBlocks, p.visualFocus, p.outgoingAnchor].join(' ')).join(' ')
  const hit = keywords.filter((k) => text.includes(k))
  console.log('案例' + (i + 1) + ' 在规划里出现的剧情词: ' + (hit.length ? hit.join('、') : '【无】'))
})
