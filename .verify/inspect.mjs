const r = await fetch('http://localhost:3999/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idea: '女主如神明般降临现场', stylePresetId: 'hongguo_short_drama', movements: ['跟拍'] }),
})
const d = await r.json()
console.log('mode:', d.mode, '| lead:', d.lead, '| intent:', d.intentLabel, '| style:', d.stylePreset.name)
console.log('score:', d.continuity.score, '| passed:', d.continuity.passed, '| issues:', d.continuity.issues.length)
console.log('修正前问题数:', d.continuityBefore.issues.length)
console.log('')
console.log('================ S01 完整提示词 ================')
console.log(d.shots[0].prompt)
console.log('')
console.log('================ S02 前 25 行 ================')
console.log(d.shots[1].prompt.split('\n').slice(0, 25).join('\n'))
