// 验证「10 秒 / 6 秒」两种镜头时长模式。
//
// 关键点：6 秒模式不只是把数字从 10 改成 6——
// 时间块结构、镜头数、以及「是否承接尾帧」都跟着变，而且三者必须自洽，
// 否则提示词里会同时出现「严格 6 秒」和 0:10 的时间码。
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'
import { getDurationMode, rescaleTimelineText, mentionsDuration, mentionsTimeline } from '../app/lib/prompt/duration-modes.ts'

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

/** 跑完整链路，返回 { plans, compiled, continuity } */
function run(idea, mode) {
  const il = analyzePlotIntent(idea)
  const scene = buildSceneCard(idea, il)
  const lead = { label: scene.protagonist.label, pronoun: scene.protagonist.pronoun, possessive: scene.protagonist.gender === 'female' ? '她的' : '他的' }
  const plans = planSceneToShots(scene, il.recommendedMovements, mode)
  const base = plans.map((p) => ({ id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement, prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '' }))
  const continuity = auditAndRepairContinuity(base, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id), mode)
  const compiled = compilePromptSet(scene, plans, continuity.repairedShots, continuity.after, getStylePreset('hongguo_short_drama'), mode)
  return { scene, plans, compiled, continuity, mode }
}

console.log('=== 1. 模式定义本身必须自洽 ===')
for (const mode of [ten, six]) {
  const slots = mode.slots
  check(`${mode.name}：时间块从 0 开始`, slots[0].from === 0, JSON.stringify(slots))
  check(`${mode.name}：时间块到 ${mode.seconds} 结束`, slots[slots.length - 1].to === mode.seconds, JSON.stringify(slots))
  let contiguous = true
  for (let i = 1; i < slots.length; i += 1) if (slots[i].from !== slots[i - 1].to) contiguous = false
  check(`${mode.name}：时间块首尾相接无空隙`, contiguous, JSON.stringify(slots))
  check(`${mode.name}：lead 块只在承接模式下存在`,
    mode.chained ? slots.some((s) => s.role === 'lead') : !slots.some((s) => s.role === 'lead'),
    JSON.stringify(slots.map((s) => s.role)))
}
check('10 秒模式承接尾帧', ten.chained === true)
check('6 秒模式不承接尾帧', six.chained === false)
check('6 秒模式镜头数系数为 10/6', Math.abs(six.shotRatio - 10 / 6) < 0.001)

console.log('')
console.log('=== 2. 每镜时长必须等于模式时长 ===')
for (const idea of cases) {
  for (const mode of [ten, six]) {
    const { plans } = run(idea, mode)
    check(`「${idea.slice(0, 8)}…」${mode.name}：所有镜头都是 ${mode.seconds} 秒`,
      plans.every((p) => p.durationSeconds === mode.seconds),
      JSON.stringify(plans.map((p) => p.durationSeconds)))
  }
}

console.log('')
console.log('=== 3. 时间块必须落在本镜时长之内（不得出现超长时间码） ===')
for (const idea of cases) {
  for (const mode of [ten, six]) {
    const { plans } = run(idea, mode)
    const allCodes = plans.flatMap((p) => p.timeBlocks).join('；').match(/0:(\d{2})/g) || []
    const maxCode = allCodes.reduce((max, token) => Math.max(max, Number(token.slice(2))), 0)
    check(`「${idea.slice(0, 8)}…」${mode.name}：最大时间码 ${maxCode} 不超过 ${mode.seconds}`,
      maxCode <= mode.seconds, '时间码: ' + allCodes.join(','))
  }
}

console.log('')
console.log('=== 4. 6 秒模式必须没有承接块 ===')
for (const idea of cases) {
  const { plans } = run(idea, six)
  const allBlocks = plans.flatMap((p) => p.timeBlocks).join('；')
  check(`「${idea.slice(0, 8)}…」6 秒模式无「承接 XX 最后一帧」`,
    !/承接\s*S\d+\s*最后一帧/.test(allBlocks),
    allBlocks.slice(0, 120))
  const tenRun = run(idea, ten)
  const tenBlocks = tenRun.plans.flatMap((p) => p.timeBlocks).join('；')
  check(`「${idea.slice(0, 8)}…」10 秒模式仍有承接块（对照组）`,
    /承接\s*S\d+\s*最后一帧/.test(tenBlocks) || tenRun.plans.length < 2,
    tenBlocks.slice(0, 120))
}

console.log('')
console.log('=== 5. 6 秒模式镜头数更多、总时长与 10 秒模式接近 ===')
for (const idea of cases) {
  const a = run(idea, ten).plans
  const b = run(idea, six).plans
  const totalTen = a.length * ten.seconds
  const totalSix = b.length * six.seconds
  check(`「${idea.slice(0, 8)}…」6 秒镜头数 ${b.length} > 10 秒镜头数 ${a.length}`, b.length > a.length,
    `10秒=${a.length}镜(${totalTen}s) 6秒=${b.length}镜(${totalSix}s)`)
  // 总时长接近：允许 ±35% 偏差（取整和上限会造成浮动）
  const ratio = totalSix / totalTen
  check(`「${idea.slice(0, 8)}…」总时长接近（${totalSix}s vs ${totalTen}s，比值 ${ratio.toFixed(2)}）`,
    ratio >= 0.65 && ratio <= 1.35)
}

console.log('')
console.log('=== 6. 6 秒模式的审核必须能通过（不该被判缺承接） ===')
for (const idea of cases) {
  const { continuity } = run(idea, six)
  const anchorIssues = continuity.after.issues.filter((i) => i.code === 'missing-anchor')
  check(`「${idea.slice(0, 8)}…」6 秒模式无 missing-anchor 问题`, anchorIssues.length === 0,
    JSON.stringify(anchorIssues.map((i) => i.message)))
  const durationIssues = continuity.after.issues.filter((i) => i.code === 'duration')
  check(`「${idea.slice(0, 8)}…」6 秒模式无时长缺失问题`, durationIssues.length === 0,
    JSON.stringify(durationIssues.map((i) => i.message)))
  check(`「${idea.slice(0, 8)}…」6 秒模式审核规则里没有「上一镜尾帧承接」`,
    !continuity.after.checkedRules.includes('上一镜尾帧承接'),
    JSON.stringify(continuity.after.checkedRules))
  const tenRun = run(idea, ten)
  check(`「${idea.slice(0, 8)}…」10 秒模式审核规则里仍有「上一镜尾帧承接」（对照组）`,
    tenRun.continuity.after.checkedRules.includes('上一镜尾帧承接'))
}

console.log('')
console.log('=== 7. 成品提示词必须写明本模式的时长 ===')
for (const idea of cases) {
  for (const mode of [ten, six]) {
    const { compiled } = run(idea, mode)
    const all = compiled.shots.map((s) => s.prompt).join('\n')
    check(`「${idea.slice(0, 8)}…」${mode.name}：含「严格 ${mode.seconds} 秒」`,
      new RegExp(`严格 ${mode.seconds} 秒`).test(all))
    check(`「${idea.slice(0, 8)}…」${mode.name}：不含另一个模式的时长表述`,
      !new RegExp(`严格 ${mode.seconds === 10 ? 6 : 10} 秒`).test(all),
      all.match(new RegExp(`严格 \\d+ 秒`, 'g'))?.join(','))
  }
}

console.log('')
console.log('=== 8. 6 秒模式不得输出承接字段，必须输出衔接方式 ===')
for (const idea of cases) {
  const { compiled } = run(idea, six)
  const all = compiled.shots.map((s) => s.prompt).join('\n')
  check(`「${idea.slice(0, 8)}…」6 秒模式无「上一镜承接」字段`, !/^上一镜承接[:：]/m.test(all))
  check(`「${idea.slice(0, 8)}…」6 秒模式无「尾帧承接」字段`, !/^尾帧承接[:：]/m.test(all))
  check(`「${idea.slice(0, 8)}…」6 秒模式有「衔接方式」字段`, /^衔接方式[:：]/m.test(all))
  check(`「${idea.slice(0, 8)}…」衔接方式写明由后期硬切`, /硬切/.test(all))
  const tenRun = run(idea, ten)
  const tenAll = tenRun.compiled.shots.map((s) => s.prompt).join('\n')
  check(`「${idea.slice(0, 8)}…」10 秒模式仍有承接字段（对照组）`,
    /^上一镜承接[:：]/m.test(tenAll) && /^尾帧承接[:：]/m.test(tenAll))
}

console.log('')
console.log('=== 9. 6 秒模式仍保留钩子 / 情绪 / 视觉符号 ===')
for (const idea of cases.slice(0, 2)) {
  const { compiled } = run(idea, six)
  const first = compiled.shots[0].prompt
  const all = compiled.shots.map((s) => s.prompt).join('\n')
  check(`「${idea.slice(0, 8)}…」6 秒模式首镜仍有前 3 秒钩子`, /^前 3 秒钩子.*[:：]/m.test(first))
  check(`「${idea.slice(0, 8)}…」6 秒模式每镜仍有情绪标注`,
    compiled.shots.every((s) => /^情绪标注[:：]/m.test(s.prompt)))
  check(`「${idea.slice(0, 8)}…」6 秒模式仍输出视觉符号`, /^视觉符号[:：]/m.test(all))
}

console.log('')
console.log('=== 10. 时间描述换算工具 ===')
check('「0-1 秒」按 0.6 缩放为「0-1 秒」', rescaleTimelineText('0-1 秒：动作', 10, 6) === '0-1 秒：动作',
  rescaleTimelineText('0-1 秒：动作', 10, 6))
check('「9-10 秒」按 0.6 缩放为「5-6 秒」', rescaleTimelineText('9-10 秒：收尾', 10, 6) === '5-6 秒：收尾',
  rescaleTimelineText('9-10 秒：收尾', 10, 6))
check('「严格 10 秒」缩放为「严格 6 秒」', rescaleTimelineText('严格 10 秒。', 10, 6) === '严格 6 秒。',
  rescaleTimelineText('严格 10 秒。', 10, 6))
check('「10 秒内说完」缩放为「6 秒内说完」', rescaleTimelineText('10 秒内说完', 10, 6) === '6 秒内说完',
  rescaleTimelineText('10 秒内说完', 10, 6))
check('同模式时原样返回', rescaleTimelineText('严格 10 秒。', 10, 10) === '严格 10 秒。')
check('不含时间描述的文本不受影响', rescaleTimelineText('女主推开门走进去', 10, 6) === '女主推开门走进去')

console.log('')
console.log('=== 11. 时长与时间轴判定工具按模式工作 ===')
check('10 秒文本对 10 秒模式判定为有时长', mentionsDuration('严格 10 秒。', ten))
check('10 秒文本对 6 秒模式判定为缺时长', !mentionsDuration('严格 10 秒。', six))
check('6 秒文本对 6 秒模式判定为有时长', mentionsDuration('严格 6 秒。', six))
check('10 秒时间轴对 6 秒模式判定为不合格', !mentionsTimeline('0:00-0:04：动作；0:04-0:10：收尾', six),
  '最大时间码 10 超过 6')
check('6 秒时间轴对 6 秒模式判定为合格', mentionsTimeline('0:00-0:04：动作；0:04-0:06：收尾', six))
check('10 秒时间轴对 10 秒模式判定为合格', mentionsTimeline('0:00-0:01：承接；0:01-0:06：动作；0:06-0:10：收尾', ten))

console.log('')
console.log('时长模式专项：' + pass + ' 通过 / ' + fail + ' 失败')
