// 专门验证 forbidden-default 硬校验链路
const cases = [
  { name: '神性降临', idea: '女主如神明般降临现场', style: 'hongguo_short_drama', forbidden: ['跳舞', '街舞', '耍帅'] },
  { name: '神性降临(UE5)', idea: '女主如神明般降临现场', style: 'ue5_xianxia', forbidden: ['跳舞', '街舞', '耍帅'] },
  { name: '高燃打斗', idea: '男主在废墟广场与敌人开始交手，激烈打斗', style: 'high_energy_action', forbidden: ['跳舞', '街舞'] },
  { name: '追逐', idea: '女主在雨夜街头被追赶，一路奔跑逃跑', style: 'hongguo_short_drama', forbidden: ['倒退行走', '倒放'] },
]

let pass = 0
let fail = 0

for (const c of cases) {
  const r = await fetch('http://localhost:3999/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea: c.idea, stylePresetId: c.style, movements: ['跟拍'] }),
  })
  const d = await r.json()

  const problems = []
  // 剥离「负面约束」整行 + 叙述句里的否定声明（如「不倒退、不倒放」），
  // 与产品层 assertsForbidden 的语境感知保持一致，否则会把合法防退化断言误判成违规。
  const isAsserted = (clause, keyword) => {
    if (!clause.includes(keyword)) return false
    if (/^(不|禁止|严禁|杜绝|避免|不可|不得|无|没有|防止|切勿|不要|别)/.test(clause)) return false
    const head = clause.split(keyword)[0]
    if (/(不|禁止|严禁|杜绝|避免|不可|不得|无|没有|防止|切勿|不要|别)\s*(要|再|能|可以|得|需|必)?\s*$/.test(head)) return false
    return true
  }
  const bodyAll = d.shots
    .map((s) =>
      String(s.prompt)
        .split('\n')
        .filter((l) => !/^\s*(负面约束|禁止项|禁忌)\s*[:：]/.test(l))
        .flatMap((l) => l.split(/[\n，。；;、！？!?]+/))
        .filter((clause) => clause.trim())
        .join('\n'),
    )
    .join('\n')

  // 1) 禁项不得被「正面描述」在正文里（否定句与负面约束行均视为合规）
  for (const f of c.forbidden) {
    const asserted = bodyAll
      .split('\n')
      .some((clause) => isAsserted(clause, f))
    if (asserted) problems.push('正文正面描述了禁项「' + f + '」')
  }

  // 2) 禁项必须出现在负面约束段里，且带「不要」前缀
  const negAll = d.shots.map((s) => {
    const m = String(s.prompt).match(/^\s*负面约束\s*[:：]\s*(.+)$/m)
    return m ? m[1] : ''
  }).join('；')
  for (const f of c.forbidden.slice(0, 2)) {
    if (!/(不要|禁止|无|不)\s*[，、,；;]?\s*/.test(negAll) && !negAll.includes(f)) problems.push('负面约束缺少「' + f + '」')
  }
  // 检查是否出现裸词（没有不要/禁止前缀直接列在负面约束里）
  for (const f of c.forbidden) {
    const bare = new RegExp('(?:^|[，、,；;])\\s*' + f + '\\s*(?:[，、,；;]|$)')
    if (bare.test(negAll)) problems.push('负面约束里出现裸词「' + f + '」（缺「不要」前缀，模型会当正向词）')
  }

  // 3) 审核报告不应出现 forbidden-default 误伤
  const fd = d.continuity.issues.filter((i) => i.code === 'forbidden-default')
  if (fd.length) problems.push('审核报出 forbidden-default 未清除：' + fd.map((i) => i.shotId + ':' + i.keyword || i.message).join(','))

  // 4) 修正前/后的对比
  const beforeFD = (d.continuityBefore?.issues || []).filter((i) => i.code === 'forbidden-default').length

  if (problems.length) {
    fail += 1
    console.log('FAIL | ' + c.name)
    problems.slice(0, 8).forEach((p) => console.log('       - ' + p))
  } else {
    pass += 1
    console.log('PASS | ' + c.name + ' | score=' + d.continuity.score + ' | 修正前禁项命中=' + beforeFD + ' | 修正后=' + fd.length)
    console.log('       负面约束节选: ' + negAll.slice(0, 110))
  }
}

console.log('')
console.log('forbidden-default 专项：' + pass + ' 通过 / ' + fail + ' 失败')
