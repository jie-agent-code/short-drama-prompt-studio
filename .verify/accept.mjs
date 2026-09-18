const cases = [
  { name: '神性降临（核心要求）', idea: '女主如神明般降临现场', style: 'ue5_xianxia', wantLead: '女主', wantIntent: 'epic_arrival', forbidBody: ['男主'] },
  { name: '用户明确不要跳舞', idea: '女主在废墟广场，不要跳舞，她如神明般降临现场', style: 'hongguo_short_drama', wantLead: '女主', wantIntent: 'epic_arrival', forbidBody: ['男主'] },
  { name: '明确舞蹈（应允许）', idea: '女主在舞台跳一段街舞', style: 'hongguo_short_drama', wantLead: '女主', wantIntent: 'dance', forbidBody: [] },
  { name: '男主角（不应变女主）', idea: '男主如神明般降临现场', style: 'ue5_xianxia', wantLead: '男主', wantIntent: 'epic_arrival', forbidBody: [] },
  { name: '都市情感', idea: '女主在雨夜发现男友背叛，克制情绪后转身离开', style: 'urban_romance', wantLead: '女主', wantIntent: null, forbidBody: [] },
  { name: '高燃打斗', idea: '男主在废墟广场与敌人开始交手，激烈打斗', style: 'high_energy_action', wantLead: '男主', wantIntent: 'action', forbidBody: [] },
  { name: '追逐', idea: '女主在雨夜街头被追赶，一路奔跑逃跑', style: 'hongguo_short_drama', wantLead: '女主', wantIntent: 'chase', forbidBody: [] },
]

let pass = 0
let fail = 0

for (const c of cases) {
  let d
  try {
    const r = await fetch('http://localhost:3999/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: c.idea, stylePresetId: c.style, movements: ['跟拍'] }),
    })
    d = await r.json()
  } catch (e) {
    console.log('FAIL | ' + c.name + ' | 请求异常 ' + e.message)
    fail += 1
    continue
  }

  const problems = []
  if (d.lead !== c.wantLead) problems.push('lead=' + d.lead + ' 期望 ' + c.wantLead)
  if (c.wantIntent && d.intent !== c.wantIntent) problems.push('intent=' + d.intent + ' 期望 ' + c.wantIntent)
  if (d.stylePresetId !== c.style) problems.push('stylePresetId=' + d.stylePresetId + ' 期望 ' + c.style)
  if (!d.continuity || d.continuity.passed !== true) {
    problems.push('审核未通过 issues=' + (d.continuity ? JSON.stringify(d.continuity.issues.map((i) => i.shotId + ':' + i.code)) : 'n/a'))
  }
  if (!Array.isArray(d.shots) || d.shots.length !== 3) problems.push('镜头数 ' + (d.shots ? d.shots.length : 'n/a'))

  if (Array.isArray(d.shots)) {
    d.shots.forEach((s) => {
      const body = String(s.prompt).split('负面约束')[0]
      c.forbidBody.forEach((f) => {
        if (body.includes(f)) problems.push(s.id + ' 正文出现「' + f + '」')
      })
      if (c.wantIntent !== 'dance' && /跳舞|街舞|舞步|起舞/.test(body)) {
        problems.push(s.id + ' 正文出现未要求的舞蹈')
      }
    })

    d.shots.forEach((s, i) => {
      if (!/严格 10 秒|10\.0 秒/.test(String(s.prompt))) problems.push(s.id + ' 缺少 10 秒')
      if (!s.shotSize) problems.push(s.id + ' 缺少景别')
      if (!s.transition) problems.push(s.id + ' 缺少转场')
      if (i > 0) {
        const anchor = new RegExp('承接\\s*S0' + i + '|S0' + i + '\\s*(最后)?(尾帧|一帧)|上一镜')
        if (!anchor.test(String(s.prompt))) problems.push(s.id + ' 缺少承接上一镜')
      }
    })
  }

  if (!problems.length) {
    pass += 1
    console.log('PASS | ' + c.name + ' | lead=' + d.lead + ' intent=' + d.intent + ' score=' + d.continuity.score + ' mode=' + d.mode)
  } else {
    fail += 1
    console.log('FAIL | ' + c.name)
    problems.slice(0, 6).forEach((p) => console.log('       - ' + p))
  }
}

console.log('')
console.log('端到端验收：' + pass + ' 通过 / ' + fail + ' 失败')
