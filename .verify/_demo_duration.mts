// 一次性演示脚本：用同一段剧情分别跑 10 秒模式与 6 秒模式，导出成品对照。
import { writeFileSync } from 'node:fs'
import { buildSceneCard } from '../app/lib/prompt/scene-card.ts'
import { analyzePlotIntent } from '../app/lib/prompt/intent-classifier.ts'
import { planSceneToShots } from '../app/lib/prompt/shot-planner.ts'
import { auditAndRepairContinuity } from '../app/lib/prompt/continuity-auditor.ts'
import { compilePromptSet } from '../app/lib/prompt/prompt-compiler.ts'
import { getStylePreset } from '../app/lib/prompt/style-presets.ts'
import { getDurationMode } from '../app/lib/prompt/duration-modes.ts'

const idea = '女主在豪门酒会被假千金故意泼红酒受辱，她隐忍后退入后台，戴上项链霸气推门重回现场'
const il = analyzePlotIntent(idea)
const scene = buildSceneCard(idea, il)
const lead = {
  label: scene.protagonist.label,
  pronoun: scene.protagonist.pronoun,
  possessive: scene.protagonist.gender === 'female' ? '她的' : '他的',
}

function run(modeId: string) {
  const mode = getDurationMode(modeId)
  const plans = planSceneToShots(scene, il.recommendedMovements, mode)
  const base = plans.map((p) => ({
    id: p.id, title: p.title, shotSize: p.shotSize, movement: p.movement,
    prompt: p.timeBlocks.join('；') + '。', transition: p.transition, audit: '',
  }))
  const continuity = auditAndRepairContinuity(base, lead, scene.continuity.forbiddenDefaults, plans.map((p) => p.id), mode)
  const compiled = compilePromptSet(scene, plans, continuity.repairedShots, continuity.after, getStylePreset('hongguo_short_drama'), mode)
  return { mode, plans, continuity, compiled }
}

const out: string[] = []
out.push('# 时长模式成品对照')
out.push('')
out.push('同一段剧情：' + idea)
out.push('')
out.push('主角：' + scene.protagonist.label + '（' + scene.protagonist.pronoun + '）')
out.push('')

for (const modeId of ['ten_second', 'six_second']) {
  const r = run(modeId)
  const totalSeconds = r.plans.length * r.mode.seconds
  out.push('---')
  out.push('')
  out.push('## ' + r.mode.name + '（' + r.plans.length + ' 镜 × ' + r.mode.seconds + ' 秒 = ' + totalSeconds + ' 秒）')
  out.push('')
  out.push('- 格式标识：`' + r.compiled.format + '`')
  out.push('- 承接尾帧：' + (r.mode.chained ? '是' : '否（后期硬切）'))
  out.push('- 审核结果：' + (r.continuity.after.passed ? '通过' : '未通过') + '，得分 ' + r.continuity.after.score + '，检查项 ' + r.continuity.after.checkedRules.length + ' 条')
  out.push('- 审核问题：' + (r.continuity.after.issues.length ? r.continuity.after.issues.map((i: any) => i.rule || i.message).join('、') : '无'))
  out.push('')
  out.push('### 镜头清单')
  out.push('')
  out.push('| 镜头 | 时长 | 景别 | 运动 | 时间块 |')
  out.push('| --- | --- | --- | --- | --- |')
  for (const p of r.plans) {
    out.push('| ' + p.id + ' | ' + p.durationSeconds + 's | ' + p.shotSize + ' | ' + p.movement + ' | ' + p.timeBlocks.join('<br>') + ' |')
  }
  out.push('')
  out.push('### 编译成品（首镜全文）')
  out.push('')
  out.push('```')
  out.push(r.compiled.shots[0].prompt)
  out.push('```')
  out.push('')
}

writeFileSync('.verify/_demo_duration.md', out.join('\n'), 'utf8')
console.log('written')
