// 验证「用户编辑过场景卡后再换剧情」不会让旧推导字段污染新剧情。
//
// 这是最隐蔽的一类失效：客户端下发的是整份场景卡，其中 beats / emotion / visual
// 是用户改不了的推导字段。若原样浅合并，换剧情后新算的 beats 会被旧值盖回去，
// 于是动态镜头数、前 3 秒钩子、情绪标注全部按旧剧情输出。
import { buildSceneCard, mergeSceneCardOverrides } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { decideHookType } from '../app/lib/prompt/hook-designer.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

// 剧情 A：3 个节拍，受辱开局
const ideaA = '女主在豪门酒会被假千金故意泼红酒受辱，她隐忍后退入后台，戴上项链霸气推门重回现场'
// 剧情 B：5 个节拍，完全不同的钩子类型
const ideaB = '女主被继母赶出家门，她拖着行李箱离开，在雨里蹲下哭，擦干眼泪站起来，打电话给律师，三年后她开着车回到老宅，推开门宣布公司已经收购'

const cardA = buildSceneCard(ideaA, analyzePlotIntent(ideaA))
const cardB = buildSceneCard(ideaB, analyzePlotIntent(ideaB))

// 剧情 C：悬念物件开局，钩子类型与 A/B 都不同，用来证明钩子确实随剧情变化
const ideaC = '女主在医院走廊得知母亲病危，她握紧化验单转身跑向病房'

console.log('=== 0. 不同剧情的推导结果本身必须不同（前提校验） ===')
check('A 与 B 的 beats 不同', JSON.stringify(cardA.event.beats) !== JSON.stringify(cardB.event.beats),
  'A=' + JSON.stringify(cardA.event.beats) + '\n       B=' + JSON.stringify(cardB.event.beats))
check('A 与 B 的 emotion 不同', cardA.emotion.start !== cardB.emotion.start)
const cardC = buildSceneCard(ideaC, analyzePlotIntent(ideaC))
check('钩子类型随剧情变化（A/B 是冲突冲击，C 是悬念物件）',
  decideHookType(cardC) !== decideHookType(cardA) && decideHookType(cardC) === 'suspense_object',
  'A=' + decideHookType(cardA) + ' C=' + decideHookType(cardC))

console.log('')
console.log('=== 1. 用户在 A 上编辑过台词后，用 B 的剧情重新生成 ===')
// 模拟客户端下发：整份 A 场景卡（含用户改过的台词），用户只动了台词一个字段。
const overridesFromA = JSON.parse(JSON.stringify(cardA))
overridesFromA.dialogue.tone = '压低声音、一字一顿'

const merged = mergeSceneCardOverrides(cardB, overridesFromA)

check('推导字段 beats 必须来自 B 而不是被 A 盖掉',
  JSON.stringify(merged.event.beats) === JSON.stringify(cardB.event.beats),
  '期望=' + JSON.stringify(cardB.event.beats) + '\n       实际=' + JSON.stringify(merged.event.beats))
check('opponentAction 必须来自 B',
  merged.event.opponentAction === cardB.event.opponentAction,
  '期望=' + cardB.event.opponentAction + ' 实际=' + merged.event.opponentAction)
check('emotion 必须来自 B',
  merged.emotion.start === cardB.emotion.start && merged.emotion.peak === cardB.emotion.peak,
  '期望=' + cardB.emotion.start + ' 实际=' + merged.emotion.start)
check('visual 必须来自 B',
  JSON.stringify(merged.visual) === JSON.stringify(cardB.visual),
  '期望=' + JSON.stringify(cardB.visual) + ' 实际=' + JSON.stringify(merged.visual))
check('intent 必须来自 B', JSON.stringify(merged.intent) === JSON.stringify(cardB.intent))
check('sourceText 必须来自 B', merged.sourceText === cardB.sourceText)

console.log('')
console.log('=== 2. 用户真正编辑过的字段必须被保留 ===')
check('用户改过的台词语气被保留', merged.dialogue.tone === '压低声音、一字一顿',
  '实际=' + merged.dialogue.tone)
// 用户改过的可编辑字段同样要生效
const overrides2 = JSON.parse(JSON.stringify(cardA))
overrides2.protagonist.label = '男主'
overrides2.protagonist.gender = 'male'
overrides2.setting.location = '废弃仓库'
overrides2.event.primaryAction = '男主转身走向门口'
const merged2 = mergeSceneCardOverrides(cardB, overrides2)
check('主角身份覆盖生效', merged2.protagonist.label === '男主', '实际=' + merged2.protagonist.label)
check('性别覆盖生效', merged2.protagonist.gender === 'male')
check('代词随性别派生为「他」', merged2.protagonist.pronoun === '他', '实际=' + merged2.protagonist.pronoun)
check('地点覆盖生效', merged2.setting.location === '废弃仓库', '实际=' + merged2.setting.location)
check('核心动作覆盖生效', merged2.event.primaryAction === '男主转身走向门口')

console.log('')
console.log('=== 3. 合并后镜头数/钩子必须按新剧情（B）走 ===')
const plansB = planSceneToShots(merged, [])
const plansBRef = planSceneToShots(cardB, [])
check('合并后的镜头数等于 B 的镜头数', plansB.length === plansBRef.length,
  '合并=' + plansB.length + ' B=' + plansBRef.length)
check('合并后仍产出 >3 镜（B 是 5 节拍）', plansB.length > 3, '实际=' + plansB.length)
check('合并后钩子类型等于 B 的钩子类型', decideHookType(merged) === decideHookType(cardB),
  '合并=' + decideHookType(merged) + ' B=' + decideHookType(cardB))

console.log('')
console.log('=== 4. 无覆盖 / 空覆盖时不得改变行为 ===')
check('overrides 为 undefined 时原样返回', mergeSceneCardOverrides(cardB, undefined) === cardB)
const emptyMerged = mergeSceneCardOverrides(cardB, {} as never)
check('overrides 为 {} 时推导字段不变',
  JSON.stringify(emptyMerged.event.beats) === JSON.stringify(cardB.event.beats))
check('overrides 为 null 时原样返回', mergeSceneCardOverrides(cardB, null) === cardB)

console.log('')
console.log('=== 5. 数组字段要过滤空值 ===')
const overrides3 = JSON.parse(JSON.stringify(cardA))
overrides3.dialogue.suggestedLines = ['第一句', '   ', '', '第二句']
const merged3 = mergeSceneCardOverrides(cardB, overrides3)
check('建议台词过滤空行', JSON.stringify(merged3.dialogue.suggestedLines) === JSON.stringify(['第一句', '第二句']),
  '实际=' + JSON.stringify(merged3.dialogue.suggestedLines))

console.log('')
console.log('覆盖合并专项：' + pass + ' 通过 / ' + fail + ' 失败')
