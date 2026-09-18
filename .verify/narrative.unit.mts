// 验证「剧情节拍 → 动态分镜」链路：剧情是否真正进入成品提示词
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { buildNarrativeBeats, decideShotCount } from '../app/lib/prompt/narrative-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

const cases = [
  {
    idea: '女主在豪门酒会被假千金故意泼红酒受辱，她隐忍后退入后台，戴上项链霸气推门重回现场',
    mustAppear: ['红酒', '假千金'],
    wantSymbol: '项链',
  },
  {
    idea: '女主在医院走廊得知母亲病危，她握紧化验单转身跑向病房',
    mustAppear: ['化验单'],
    wantSymbol: '化验单',
  },
  {
    idea: '女主在办公室发现同事偷窃自己的方案，她冷静收集证据后当面揭穿',
    mustAppear: ['同事', '方案'],
    wantSymbol: null,
  },
]

console.log('=== 1. 剧情词必须进入镜头规划 ===')
for (const c of cases) {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const planText = plans.map((p) => [p.title, p.objective, ...p.timeBlocks, p.visualFocus].join(' ')).join(' ')

  c.mustAppear.forEach((word) => {
    check('「' + c.idea.slice(0, 10) + '…」规划含剧情词「' + word + '」', planText.includes(word),
      '规划文本: ' + planText.slice(0, 100))
  })

  check('「' + c.idea.slice(0, 10) + '…」抽出了事件节拍', scene.event.beats.length >= 2,
    'beats=' + JSON.stringify(scene.event.beats))
}

console.log('')
console.log('=== 2. 不同剧情不得产出雷同时间轴 ===')
const sigs = cases.map((c) => {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  return planSceneToShots(scene, il.recommendedMovements).map((p) => p.timeBlocks.join('|')).join('||')
})
check('案例1 != 案例2', sigs[0] !== sigs[1])
check('案例1 != 案例3', sigs[0] !== sigs[2])
check('案例2 != 案例3', sigs[1] !== sigs[2])

console.log('')
console.log('=== 3. 同一镜头内不得复读同一句 beat ===')
for (const c of cases) {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const cores = plans.map((p) => (p.timeBlocks[1] || '').replace(/^0:01-0:06：/, ''))
  const coreSet = new Set(cores.filter(Boolean))
  check('「' + c.idea.slice(0, 10) + '…」各镜核心动作不重复', coreSet.size === cores.filter(Boolean).length,
    '核心动作: ' + JSON.stringify(cores))
  // 目标标题也不能复读——标题复读会让 UI 上出现两个一模一样的镜头卡。
  const titles = plans.map((p) => p.objective)
  check('「' + c.idea.slice(0, 10) + '…」各镜目标不重复', new Set(titles).size === titles.length,
    '目标: ' + JSON.stringify(titles))
}

console.log('')
console.log('=== 4. 情绪节拍角色分配合理 ===')
const beats = buildNarrativeBeats(cases[0].idea ? buildSceneCard(cases[0].idea, analyzePlotIntent(cases[0].idea)).event.beats : [])
check('节拍数量 > 0', beats.length > 0, 'beats=' + beats.length)
check('存在 climax 或 conflict 节拍', beats.some((b) => b.role === 'climax' || b.role === 'conflict'),
  'roles=' + JSON.stringify(beats.map((b) => b.role)))
// shotIndex 必须落在该剧情实际生成的镜头数范围内，而不是写死的 0-2。
for (const c of cases) {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const idxs = buildNarrativeBeats(scene.event.beats).map((b) => b.shotIndex)
  check('「' + c.idea.slice(0, 10) + '…」节拍落位在 ' + plans.length + ' 镜范围内',
    idxs.every((i) => i >= 0 && i < plans.length),
    'shotIndexes=' + JSON.stringify(idxs) + ' 镜头数=' + plans.length)
}

console.log('')
console.log('=== 4c. 镜头数由节拍数决定（不写死 3） ===')
for (const c of cases) {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const beatCount = scene.event.beats.length
  const expected = decideShotCount(beatCount)
  check('「' + c.idea.slice(0, 10) + '…」' + beatCount + ' 个节拍 → ' + expected + ' 镜（实际 ' + plans.length + '）',
    plans.length === expected,
    'beats=' + JSON.stringify(scene.event.beats))
}

// 多镜剧情必须真的产出 >3 镜，否则「动态镜头数」就是空话。
const longIdea = '女主被继母赶出家门，她拖着行李箱离开，在雨里蹲下哭，擦干眼泪站起来，打电话给律师，三年后她开着车回到老宅，推开门宣布公司已经收购'
{
  const il = analyzePlotIntent(longIdea)
  const scene = buildSceneCard(longIdea, il)
  const plans = planSceneToShots(scene, il.recommendedMovements)
  check('长剧情产出 >3 镜（实际 ' + plans.length + ' 镜）', plans.length > 3,
    'id=' + plans.map((p) => p.id).join(','))
  check('镜头编号连续且补零到两位', plans.every((p, i) => p.id === 'S' + String(i + 1).padStart(2, '0')),
    'id=' + plans.map((p) => p.id).join(','))
  // 爽点镜必须收到最紧景别，否则情绪放大不到位。
  const climaxShot = plans.find((p) => p.title.startsWith('爽点'))
  check('爽点镜景别收最紧（特写）', !climaxShot || climaxShot.shotSize.includes('特写'),
    '爽点镜景别=' + (climaxShot ? climaxShot.shotSize : '无爽点镜'))
}

// 因果顺序：同一镜头内的 beat 必须保持原始叙述顺序，
// 否则会出现「先退场、再被泼红酒」这种因果颠倒的描述。
console.log('')
console.log('=== 4b. 同一镜头内的 beat 保持原始叙述顺序 ===')
for (const c of cases) {
  const scene = buildSceneCard(c.idea, analyzePlotIntent(c.idea))
  const ordered = buildNarrativeBeats(scene.event.beats)
  const byShot = new Map()
  ordered.forEach((b, i) => {
    if (!byShot.has(b.shotIndex)) byShot.set(b.shotIndex, [])
    byShot.get(b.shotIndex).push(i)
  })
  let ok = true
  byShot.forEach((indexes) => {
    for (let k = 1; k < indexes.length; k += 1) {
      if (indexes[k] < indexes[k - 1]) ok = false
    }
  })
  check('「' + c.idea.slice(0, 10) + '…」镜头内 beat 顺序未被排序打乱', ok,
    '分配=' + JSON.stringify(ordered.map((b) => b.shotIndex + ':' + b.text.slice(0, 8))))
}

console.log('')
console.log('=== 5. 视觉符号进入成品 ===')
for (const c of cases) {
  if (!c.wantSymbol) continue
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: scene.protagonist.gender === 'female' ? '她的' : '他的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const baseShots = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults)
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const all = compiled.shots.map((s) => s.prompt).join('\n')
  check('成品含视觉符号「' + c.wantSymbol + '」', all.includes(c.wantSymbol))
  check('成品输出了独立的视觉符号行', /^视觉符号[:：].*关键镜头重复|^视觉符号[:：].*冲突镜和爽点镜/m.test(all),
    '未找到视觉符号行')
}

console.log('')
console.log('=== 6. 情绪曲线来自剧情而非意图模板 ===')
for (const c of cases) {
  const scene = buildSceneCard(c.idea, analyzePlotIntent(c.idea))
  const isGeneric = scene.emotion.start === '从输入剧情的初始情绪开始'
  check('「' + c.idea.slice(0, 10) + '…」情绪曲线已按剧情推导', !isGeneric,
    'emotion.start=' + scene.emotion.start)
}

console.log('')
console.log('=== 7. 情绪标注必须进入成品提示词 ===')
for (const c of cases) {
  const il = analyzePlotIntent(c.idea)
  const scene = buildSceneCard(c.idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: scene.protagonist.gender === 'female' ? '她的' : '他的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const baseShots = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id))
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const all = compiled.shots.map((s) => s.prompt)
  const withEmotion = all.filter((p) => /^情绪标注[:：]/m.test(p))
  check('「' + c.idea.slice(0, 10) + '…」每一镜都有情绪标注', withEmotion.length === all.length,
    '有情绪标注的镜头数 ' + withEmotion.length + '/' + all.length)
  // 情绪必须落到可执行的表演指令，不能只贴一个标签。
  check('「' + c.idea.slice(0, 10) + '…」情绪标注带外化表演指令',
    withEmotion.every((p) => /外化表演[:：]/.test(p)),
    withEmotion[0] ? withEmotion[0].match(/^情绪标注.*$/m)?.[0]?.slice(0, 80) : '无')
  // 剧情推导出的情绪原句必须出现，不能被泛化掉。
  const derivedEmotionUsed = withEmotion.some((p) => p.includes(scene.emotion.peak) || p.includes(scene.emotion.start) || p.includes(scene.emotion.end))
  check('「' + c.idea.slice(0, 10) + '…」使用了剧情推导出的情绪原句', derivedEmotionUsed,
    '推导: start=' + scene.emotion.start + ' / peak=' + scene.emotion.peak)
}

console.log('')
console.log('=== 7b. 情绪强度必须随镜头推进而变化（不得每镜同一情绪） ===')
{
  const idea = cases[0].idea
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: '她的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const baseShots = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(baseShots, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id))
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  const labels = compiled.shots.map((s) => (s.prompt.match(/^情绪标注[:：]([^：]+)[:：]/m) || [])[1] || '')
  check('情绪阶段标签不全相同', new Set(labels.filter(Boolean)).size > 1, JSON.stringify(labels))
}

console.log('')
console.log('=== 8. 模型少给镜头时，编译器必须用规划器补位 ===')
{
  // 模拟「5 个节拍 → 5 镜规划，但模型只返回 3 镜」的场景。
  const idea = '女主被继母赶出家门，她拖着行李箱离开，在雨里蹲下哭，擦干眼泪站起来，打电话给律师，三年后她开着车回到老宅，推开门宣布公司已经收购'
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: '她的' }
  const plans = planSceneToShots(scene, il.recommendedMovements)
  const partial = plans.slice(0, 3).map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const result = auditAndRepairContinuity(partial, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id))
  const compiled = compilePromptSet(scene, plans, result.repairedShots, result.after, getStylePreset('hongguo_short_drama'))
  check('规划 5 镜时成品仍为 5 镜（不被模型的 3 镜截断）', compiled.shots.length === plans.length,
    '成品=' + compiled.shots.length + ' 规划=' + plans.length)
  // 补位镜必须带完整时间轴，不能只有一句目标。
  const padded = compiled.shots.slice(3)
  check('补位镜含完整时间轴', padded.every((s) => /0:0\d-0:0\d/.test(s.prompt)),
    padded.map((s) => s.prompt.slice(0, 60)).join(' || '))
  check('补位镜不是空壳（有动作方向）', padded.every((s) => /动作方向[:：]/.test(s.prompt)))
}

console.log('')
console.log('动态分镜专项：' + pass + ' 通过 / ' + fail + ' 失败')
