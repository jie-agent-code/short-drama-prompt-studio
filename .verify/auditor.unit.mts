// 直接验证审核器的否定语境感知与分句删除逻辑
import { auditContinuity, repairContinuity, hasReverseMotionRisk } from '../app/lib/prompt/continuity-auditor.ts'

let pass = 0
let fail = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + '\n       got      ' + JSON.stringify(actual) + '\n       expected ' + JSON.stringify(expected)) }
}

const lead = { label: '女主', pronoun: '她', possessive: '她的' }

// ---------- hasReverseMotionRisk ----------
check('防退化断言不算倒退风险', hasReverseMotionRisk('人物面朝前方正常向前移动，不倒退、不倒放'), false)
check('真倒退算风险', hasReverseMotionRisk('她倒退着走'), true)
check('真倒放算风险', hasReverseMotionRisk('画面倒放'), true)
// 回归：模型常在片尾写「禁止穿模、倒放、肢体扭曲」，顿号隔断了否定词，曾被误判
check('顿号并列禁止项不算倒退风险',
  hasReverseMotionRisk('女主自光柱中心缓缓下降，双足并拢，面朝正前方。禁止穿模、倒放、肢体扭曲、多余人物。'), false)
check('「禁止倒退、倒放」并列不算风险', hasReverseMotionRisk('禁止倒退、倒放和反向滑行。'), false)
check('垂直下降动作不该被判定为倒退', hasReverseMotionRisk('女主垂直下落，无旋转，衣摆向上微扬。无台词。'), false)

// ---------- forbidden-default 不误报否定句 ----------
const shotsWithNegation = [
  { id: 'S01', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接',
    prompt: '严格 10 秒。0:00-0:10：人物正常向前，不倒退、不倒放，保持景别。\n负面约束：不要倒退行走' },
  { id: 'S02', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接 S01 尾帧',
    prompt: '严格 10 秒。承接 S01 最后一帧，保持站位。不倒退、不倒放。\n负面约束：不要倒退行走' },
  { id: 'S03', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接 S02 尾帧',
    prompt: '严格 10 秒。承接 S02 最后一帧，保持站位。不倒退、不倒放。\n负面约束：不要倒退行走' },
]
const r1 = auditContinuity(shotsWithNegation, lead, ['倒退', '倒放'])
check('否定句「不倒退」不触发 forbidden-default',
  r1.issues.filter((i) => i.code === 'forbidden-default').length, 0)

// ---------- forbidden-default 真的拦截正面描述 ----------
const shotsWithDance = [
  { id: 'S01', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接',
    prompt: '严格 10 秒。0:00-0:10：女主原地跳街舞，动作有力。\n负面约束：不要跳舞' },
  { id: 'S02', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接 S01 尾帧',
    prompt: '严格 10 秒。承接 S01 最后一帧。\n负面约束：不要跳舞' },
  { id: 'S03', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接 S02 尾帧',
    prompt: '严格 10 秒。承接 S02 最后一帧。\n负面约束：不要跳舞' },
]
const r2 = auditContinuity(shotsWithDance, lead, ['街舞'])
const fd2 = r2.issues.filter((i) => i.code === 'forbidden-default')
check('正文正面写街舞被拦截', fd2.length, 1)
check('拦截定位在 S01', fd2[0]?.shotId, 'S01')

// ---------- 修正器：删掉违规分句，但保留否定句与负面约束 ----------
const repaired = repairContinuity(shotsWithDance, r2, lead, ['街舞'])
check('修正后 S01 不再有正面街舞',
  repaired[0].prompt.split('\n').filter((l) => !/^负面约束/.test(l)).join('').includes('街舞'), false)
check('修正后负面约束仍保留不要跳舞', /不要跳舞/.test(repaired[0].prompt), true)

const repaired2 = repairContinuity(shotsWithNegation, auditContinuity(shotsWithNegation, lead, ['倒退', '倒放']), lead, ['倒退', '倒放'])
check('修正器不破坏「不倒退、不倒放」', /不倒退、不倒放/.test(repaired2[0].prompt), true)

// ---------- 违规词在中间行也能被清掉（旧实现的 bug） ----------
const midLineShots = [
  { id: 'S01', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接',
    prompt: '严格 10 秒。\n景别与运镜：中景，女主原地跳街舞。\n动作方向：正常向前。\n负面约束：不要街舞' },
  { id: 'S02', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接 S01 尾帧',
    prompt: '严格 10 秒。承接 S01 最后一帧。\n动作方向：正常向前。\n负面约束：不要街舞' },
  { id: 'S03', title: 'x', shotSize: '中景', movement: '跟拍', transition: '切', audit: '严格承接 S02 尾帧',
    prompt: '严格 10 秒。承接 S02 最后一帧。\n动作方向：正常向前。\n负面约束：不要街舞' },
]
const r3 = auditContinuity(midLineShots, lead, ['街舞'])
check('中间行违规词也被拦截', r3.issues.filter((i) => i.code === 'forbidden-default').length, 1)
const rep3 = repairContinuity(midLineShots, r3, lead, ['街舞'])
check('中间行违规词被清除',
  rep3[0].prompt.split('\n').filter((l) => !/^负面约束/.test(l)).join('').includes('街舞'), false)

console.log('')
console.log('审核器语境感知专项：' + pass + ' 通过 / ' + fail + ' 失败')
