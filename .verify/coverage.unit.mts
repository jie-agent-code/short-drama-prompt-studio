// 验证「节拍 → 镜头」的两条硬约束，以及 6 秒模式多出来的镜头怎么填。
//
// 背景：6 秒模式的镜头数按 10/6 放大（3 个节拍 → 5 镜、4 个节拍 → 7 镜），
// 镜头数必然多于节拍数。多出来的镜头如果写成「在上一镜的结果上继续推进」，
// 会同时产生两个问题：两镜文案一模一样、而且这句话是元指令（没告诉模型任何具体信息）。
// 这里改为覆盖剪辑：插入镜（道具特写）+ 反应镜（对手的脸）+ 情绪特写镜。
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'
import { getDurationMode, retimeShotLengthText } from '../app/lib/prompt/duration-modes.ts'
import { allocateExtraShots, pickCoverageSpecs } from '../app/lib/prompt/beat-coverage.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

const ten = getDurationMode('ten_second')
const six = getDurationMode('six_second')

const cases = [
  '女主在豪门酒会被假千金故意泼红酒受辱，她隐忍后退入后台，戴上项链霸气推门重回现场',
  '女主在医院走廊得知母亲病危，她握紧化验单转身跑向病房',
  '女主被继母赶出家门，她拖着行李箱离开，在雨里蹲下哭，擦干眼泪站起来，打电话给律师，三年后她开着车回到老宅，推开门宣布公司已经收购',
  '女主在办公室发现同事偷窃自己的方案，她冷静收集证据后当面揭穿',
]

function run(idea, mode) {
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: scene.protagonist.gender === 'female' ? '她的' : '他的' }
  const plans = planSceneToShots(scene, il.recommendedMovements, mode)
  const base = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const continuity = auditAndRepairContinuity(base, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id), mode)
  const compiled = compilePromptSet(scene, plans, continuity.repairedShots, continuity.after, getStylePreset('hongguo_short_drama'), mode)
  return { scene, plans, compiled, continuity }
}

/** 元指令/占位词：出现在成品里等于什么都没告诉视频模型。 */
const META_PHRASES = ['继续推进', '完成一个新动作并改变局面', '推进到一个新的落点', '延展：', '待补充', '请写清', '如需']

console.log('=== 1. 镜头顺序必须等于剧情顺序（不得按情绪强度重排） ===')
for (const idea of cases) {
  const { scene, plans } = run(idea, ten)
  const beats = scene.event.beats
  // 每个节拍的第一镜（主镜）在镜头序列里的下标必须递增。
  const positions = beats.map((beat) => plans.findIndex((p) => p.objective.includes(beat)))
  const increasing = positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]))
  check('「' + idea.slice(0, 8) + '…」节拍落位严格递增', increasing,
    'beats=' + JSON.stringify(beats) + ' 落位=' + JSON.stringify(positions))
  // 受辱在前、退场在后的剧情，绝不能排成「先退场、再被泼红酒」。
  if (idea.includes('泼红酒')) {
    const douse = plans.findIndex((p) => p.objective.includes('泼红酒'))
    const retreat = plans.findIndex((p) => p.objective.includes('隐忍后退'))
    check('「泼红酒 → 隐忍退场」因果顺序正确', douse >= 0 && retreat >= 0 && douse < retreat,
      '泼红酒=' + douse + ' 隐忍后退=' + retreat)
  }
}

console.log('')
console.log('=== 2. 多出来的镜头必须是覆盖镜，不是复读上一镜 ===')
for (const idea of cases) {
  const { plans } = run(idea, six)
  const cores = plans.map((p) => (p.timeBlocks[0] || '').replace(/^0:00-0:04：/, ''))
  check('「' + idea.slice(0, 8) + '…」6 秒模式各镜主体不重复', new Set(cores).size === cores.length,
    JSON.stringify(cores.map((c) => c.slice(0, 24))))
  const titles = plans.map((p) => p.title)
  check('「' + idea.slice(0, 8) + '…」6 秒模式各镜标题不重复', new Set(titles).size === titles.length,
    JSON.stringify(titles))
  const objectives = plans.map((p) => p.objective)
  check('「' + idea.slice(0, 8) + '…」6 秒模式各镜目标不重复', new Set(objectives).size === objectives.length,
    JSON.stringify(objectives.map((o) => o.slice(0, 24))))
}

console.log('')
console.log('=== 3. 不得出现元指令 / 占位词 ===')
for (const idea of cases) {
  for (const mode of [ten, six]) {
    const { plans } = run(idea, mode)
    const all = plans.map((p) => [p.title, p.objective, ...p.timeBlocks, p.actionDirection, p.visualFocus, p.dialogueCue].join(' ')).join(' ')
    const hit = META_PHRASES.filter((phrase) => all.includes(phrase))
    check('「' + idea.slice(0, 8) + '…」' + mode.name + '：无元指令/占位词', hit.length === 0,
      '命中=' + JSON.stringify(hit))
  }
}

console.log('')
console.log('=== 4. 覆盖镜类型必须用上真实素材（道具 / 对手） ===')
{
  const { plans } = run(cases[0], six)
  const titles = plans.map((p) => p.title)
  check('有视觉符号「项链」时产出道具插入镜', titles.some((t) => t.includes('项链插入镜') || t.includes('项链第二角度')),
    JSON.stringify(titles))
  check('有对手「假千金」时产出反应镜', titles.some((t) => t.includes('假千金反应镜')), JSON.stringify(titles))
  // 同一个道具不该被连续拍两次同一个角度。
  const insertTitles = titles.filter((t) => t.includes('项链'))
  check('同一道具的覆盖镜不重复同一角度', new Set(insertTitles).size === insertTitles.length,
    JSON.stringify(insertTitles))
}
{
  const { scene, plans } = run(cases[3], six)
  check('案例无道具时覆盖镜退化为情绪特写', scene.visual.props.length > 0 || plans.some((p) => p.title.includes('情绪镜') || p.title.includes('细节镜')),
    JSON.stringify(plans.map((p) => p.title)))
}

console.log('')
console.log('=== 5. 覆盖镜不得新增用户未要求的动作 ===')
for (const idea of cases) {
  const { plans } = run(idea, six)
  const all = plans.map((p) => [p.title, ...p.timeBlocks, p.visualFocus].join(' ')).join(' ')
  check('「' + idea.slice(0, 8) + '…」覆盖镜未引入舞蹈/街舞', !/舞蹈|跳舞|街舞|耍帅/.test(all),
    all.match(/.{0,12}(舞蹈|跳舞|街舞|耍帅).{0,12}/)?.[0] || '')
}

console.log('')
console.log('=== 6. 覆盖镜的景别由覆盖类型决定 ===')
{
  const { plans } = run(cases[0], six)
  const insertShots = plans.filter((p) => p.title.includes('插入镜') || p.title.includes('第二角度'))
  const reactionShots = plans.filter((p) => p.title.includes('反应镜'))
  check('道具插入镜必须是特写', insertShots.length > 0 && insertShots.every((p) => p.shotSize === '特写'),
    JSON.stringify(insertShots.map((p) => p.shotSize)))
  check('反应镜必须是近景', reactionShots.length > 0 && reactionShots.every((p) => p.shotSize === '近景'),
    JSON.stringify(reactionShots.map((p) => p.shotSize)))
}

console.log('')
console.log('=== 7. 10 秒模式不产生覆盖镜（镜头数 = 节拍数） ===')
for (const idea of cases) {
  const { scene, plans } = run(idea, ten)
  check('「' + idea.slice(0, 8) + '…」10 秒模式镜头数等于节拍数', plans.length === scene.event.beats.length,
    '镜头=' + plans.length + ' 节拍=' + scene.event.beats.length)
  check('「' + idea.slice(0, 8) + '…」10 秒模式无覆盖镜',
    !plans.some((p) => /插入镜|反应镜|情绪镜|细节镜/.test(p.title)),
    JSON.stringify(plans.map((p) => p.title)))
}

console.log('')
console.log('=== 8. 6 秒模式的成品不得残留 10 秒的整镜时长表述 ===')
for (const idea of cases) {
  const { compiled } = run(idea, six)
  const all = compiled.shots.map((s) => s.prompt).join('\n')
  check('「' + idea.slice(0, 8) + '…」不含「每 10 秒」', !/每\s*10\s*秒/.test(all),
    all.match(/.{0,8}每\s*10\s*秒.{0,8}/)?.[0] || '')
  check('「' + idea.slice(0, 8) + '…」不含「连续 10 秒」', !/连续\s*10\s*秒/.test(all),
    all.match(/.{0,8}连续\s*10\s*秒.{0,8}/)?.[0] || '')
  check('「' + idea.slice(0, 8) + '…」已换算为「每 6 秒」', /每\s*6\s*秒/.test(all))
  check('「' + idea.slice(0, 8) + '…」已换算为「连续 6 秒」', /连续\s*6\s*秒/.test(all))
  const tenRun = run(idea, ten)
  const tenAll = tenRun.compiled.shots.map((s) => s.prompt).join('\n')
  check('「' + idea.slice(0, 8) + '…」10 秒模式仍保留「每 10 秒」（对照组）', /每\s*10\s*秒/.test(tenAll))
}

console.log('')
console.log('=== 9. 整镜时长换算工具 ===')
check('「每 10 秒只推进一个事件」→「每 6 秒只推进一个事件」',
  retimeShotLengthText('每 10 秒只推进一个事件', 10, 6) === '每 6 秒只推进一个事件',
  retimeShotLengthText('每 10 秒只推进一个事件', 10, 6))
check('「适合连续 10 秒拼接」→「适合连续 6 秒拼接」',
  retimeShotLengthText('冲突直接、节奏快、适合连续 10 秒拼接', 10, 6) === '冲突直接、节奏快、适合连续 6 秒拼接',
  retimeShotLengthText('冲突直接、节奏快、适合连续 10 秒拼接', 10, 6))
check('「每个严格 10 秒」→「每个严格 6 秒」',
  retimeShotLengthText('每个严格 10 秒', 10, 6) === '每个严格 6 秒',
  retimeShotLengthText('每个严格 10 秒', 10, 6))
// 钩子时点与镜头长度无关，不能被缩放成「0-1 秒」。
check('「开头 0.5-1 秒」不被改动',
  retimeShotLengthText('开头 0.5-1 秒出现明确人物或事件', 10, 6) === '开头 0.5-1 秒出现明确人物或事件',
  retimeShotLengthText('开头 0.5-1 秒出现明确人物或事件', 10, 6))
check('同模式时原样返回', retimeShotLengthText('每 10 秒只推进一个事件', 10, 10) === '每 10 秒只推进一个事件')

console.log('')
console.log('=== 10. 额外镜头分配：优先给情绪最重的节拍 ===')
{
  const roles = ['setup', 'turn', 'conflict', 'climax']
  const allocated = allocateExtraShots(4, 3, roles)
  check('3 个额外镜头全给爽点/冲突/转折，铺垫不拿', allocated[0] === 0 && allocated[3] === 1 && allocated[2] === 1 && allocated[1] === 1,
    JSON.stringify(allocated))
  const none = allocateExtraShots(4, 0, roles)
  check('没有额外镜头时全为 0', none.every((v) => v === 0), JSON.stringify(none))
  const clamped = allocateExtraShots(2, 5, ['climax', 'setup'])
  check('额外镜头多于节拍数时能分配完', clamped.reduce((a, b) => a + b, 0) === 5, JSON.stringify(clamped))
}

console.log('')
console.log('=== 11. 覆盖镜类型轮转（不连续拍同一种） ===')
{
  const ctx = { lead: '女主', opponent: '假千金', props: ['项链'], role: 'climax' }
  const specs = pickCoverageSpecs(3, ctx, 0)
  check('有道具和对手时轮转为 插入/反应/情绪',
    specs.map((s) => s.kind).join(',') === 'insert,reaction,emotion',
    JSON.stringify(specs))
  const continued = pickCoverageSpecs(1, ctx, 1)
  check('offset 让后续覆盖镜接着轮转', continued[0].kind === 'reaction', JSON.stringify(continued))
  const noProp = pickCoverageSpecs(2, { lead: '女主', opponent: '', props: [], role: 'turn' }, 0)
  check('无道具无对手时退化为情绪镜', noProp.every((s) => s.kind === 'emotion'), JSON.stringify(noProp))
}

console.log('')
console.log('=== 12. 节拍不足时走兜底模板，但镜头数仍按模式放大 ===')
for (const idea of ['女主推开办公室的门', '女主站在雨中']) {
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const tenPlans = planSceneToShots(scene, il.recommendedMovements, ten)
  const sixPlans = planSceneToShots(scene, il.recommendedMovements, six)
  check('「' + idea + '」走兜底路径（节拍 < 2）', scene.event.beats.length < 2,
    JSON.stringify(scene.event.beats))
  check('「' + idea + '」6 秒模式镜头数多于 10 秒模式（' + sixPlans.length + ' vs ' + tenPlans.length + '）',
    sixPlans.length > tenPlans.length)
  check('「' + idea + '」6 秒模式镜头编号连续',
    sixPlans.every((p, i) => p.id === 'S' + String(i + 1).padStart(2, '0')),
    JSON.stringify(sixPlans.map((p) => p.id)))
  const titles = sixPlans.map((p) => p.title)
  check('「' + idea + '」6 秒模式兜底路径标题不重复', new Set(titles).size === titles.length, JSON.stringify(titles))
}

console.log('')
console.log('覆盖镜与叙述顺序专项：' + pass + ' 通过 / ' + fail + ' 失败')
