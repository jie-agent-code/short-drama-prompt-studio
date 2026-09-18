// 验证黄金前 3 秒钩子：不同类型剧情应产出不同钩子，且必须落到成品首镜
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'
import { decideHookType, designHook } from '../app/lib/prompt/hook-designer.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

const expectType = [
  { idea: '女主在豪门酒会被假千金故意泼红酒受辱，她隐忍后退入后台，戴上项链霸气推门重回现场', type: 'conflict_shock', name: '受辱开局' },
  { idea: '女主如神明般降临现场', type: 'arrival_shock', name: '神明降临' },
  { idea: '女主在医院走廊得知母亲病危，她握紧化验单转身跑向病房', type: 'suspense_object', name: '化验单开局' },
  { idea: '女主在办公室发现同事偷窃自己的方案，她冷静收集证据后当面揭穿', type: 'suspense_object', name: '偷窃开局' },
  { idea: '女主踹开会议室的门闯进董事会', type: 'impossible_action', name: '闯门开局' },
]

console.log('=== 1. 钩子类型判定正确 ===')
for (const c of expectType) {
  const scene = buildSceneCard(c.idea, analyzePlotIntent(c.idea))
  const t = decideHookType(scene)
  check(`${c.name} → ${c.type}（实际 ${t}）`, t === c.type, '剧情: ' + c.idea.slice(0, 20))
}

console.log('')
console.log('=== 2. 钩子内容必须具体可拍，不是空话 ===')
const forbiddenVague = ['要有冲击力', '要有钩子', '吸引观众', '抓人眼球', '引人入胜']
for (const c of expectType) {
  const scene = buildSceneCard(c.idea, analyzePlotIntent(c.idea))
  const hook = designHook(scene)
  check(`${c.name}：cue 含具体时间码`, /0:00-0:0[13]/.test(hook.cue), hook.cue.slice(0, 60))
  check(`${c.name}：cue 含明确景别`, /远景|中景|中近景|近景|特写/.test(hook.cue), hook.cue.slice(0, 60))
  check(`${c.name}：cue 不含空洞描述`, !forbiddenVague.some((word) => hook.cue.includes(word)), hook.cue.slice(0, 60))
  check(`${c.name}：说明了信息缺口`, hook.gap.length > 10 && /不知道|为什么|意味着/.test(hook.gap), hook.gap.slice(0, 50))
  check(`${c.name}：给出第 3 秒尾帧状态`, hook.tailState.length > 8 && /第 3 秒/.test(hook.tailState), hook.tailState.slice(0, 50))
}

console.log('')
console.log('=== 3. 不同剧情产出不同钩子（不得雷同） ===')
const cues = expectType.map((c) => designHook(buildSceneCard(c.idea, analyzePlotIntent(c.idea))).cue)
check('受辱 != 降临', cues[0] !== cues[1])
check('化验单 != 偷窃', cues[2] !== cues[3])
const types = expectType.map((c) => decideHookType(buildSceneCard(c.idea, analyzePlotIntent(c.idea))))
check('钩子类型种类 >= 3（不是所有剧情都同一个钩子）', new Set(types).size >= 3, JSON.stringify(types))

console.log('')
console.log('=== 4. 钩子必须落到成品提示词，且只在首镜 ===')
for (const c of expectType.slice(0, 3)) {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: scene.protagonist.gender === 'female' ? '她的' : '他的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const baseShots = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id))
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const first = compiled.shots[0].prompt
  const rest = compiled.shots.slice(1).map((s) => s.prompt).join('\n')
  check(`${c.name}：首镜含「前 3 秒钩子」字段`, /^前 3 秒钩子.*[:：]/m.test(first), first.slice(0, 80))
  check(`${c.name}：非首镜不得含钩子字段`, !/^前 3 秒钩子.*[:：]/m.test(rest))
  check(`${c.name}：首镜钩子含时间码`, /0:00-0:0[13]/.test(first))
}

console.log('')
console.log('=== 5. 钩子不得破坏既有约束 ===')
{
  const idea = expectType[1].idea // 神明降临
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: '她的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const baseShots = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id))
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const first = compiled.shots[0].prompt
  // 降临类钩子提到"从异常中心出现"，不得因此引入舞蹈。
  check('降临钩子未引入舞蹈', !/舞蹈|跳舞|街舞|耍帅/.test(first.split('负面约束')[0]), first.slice(0, 120))
  check('降临钩子仍含光柱/降临类画面', /光柱|降临|神迹|异常/.test(first))
  check('镜头仍为 10 秒', /10 秒/.test(first))
}

console.log('')
console.log('=== 6. 钩子景别必须与首镜景别一致（不得自相矛盾） ===')
for (const c of expectType) {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: '她的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const baseShots = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id))
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const first = compiled.shots[0].prompt
  const sizeLine = (first.match(/^景别与运镜[:：]([^；;]+)/m) || [])[1] || ''
  const hookSize = designHook(scene).preferredShotSize
  check(`${c.name}：首镜景别「${sizeLine}」= 钩子要求「${hookSize}」`, sizeLine.includes(hookSize),
    '首镜景别行=' + sizeLine + ' 钩子要求=' + hookSize)
}

console.log('')
console.log('=== 7. 爽点镜情绪必须是「情绪释放」而非「情绪高点」 ===')
{
  const idea = expectType[0].idea
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: '她的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const baseShots = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id))
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const payoff = compiled.shots.find((s) => /承担「爽点」/.test(s.prompt))
  check('存在爽点镜', Boolean(payoff), '未找到爽点镜')
  if (payoff) {
    const line = (payoff.prompt.match(/^情绪标注[:：].*$/m) || [])[0] || ''
    check('爽点镜情绪标注为「情绪释放」', line.includes('情绪释放'), line.slice(0, 90))
    check('爽点镜用的是 end 情绪原句（转为蓄势待发的冷静）', line.includes(scene.emotion.end),
      'end=' + scene.emotion.end + ' | 实际=' + line.slice(0, 90))
  }
  // 爽点镜景别必须是特写——情绪的物理放大器。
  check('爽点镜景别为特写', !payoff || payoff.shotSize.includes('特写'),
    '爽点镜景别=' + (payoff ? payoff.shotSize : '无'))
}

console.log('')
console.log('黄金 3 秒钩子专项：' + pass + ' 通过 / ' + fail + ' 失败')
