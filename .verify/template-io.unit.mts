// 验证模板库的导出 / 导入。
//
// 为什么值得专门测：模板只存在浏览器 localStorage，既不进仓库也不进 .env.local。
// 换电脑、换浏览器、换端口都会静默清空，导出/导入是用户唯一的补救通道。
// 这条通道一旦坏了，用户是「导出成功但导入不进」——比没有功能更糟，因为会误以为已经备份。
//
// 重点盯三件事：
//   1. localStorage 的两个 key 不能被改动，改了会直接切断用户既有模板；
//   2. 校验必须严格——宁可整条剔除，也不塞一个半对的模板进去；
//   3. 重复导入不能产生副本（用户会反复点，这是必然发生的操作）。
import {
  IMAGE_TEMPLATE_KEY,
  TEMPLATE_FILE_VERSION,
  VIDEO_TEMPLATE_KEY,
  buildTemplateFile,
  mergeTemplates,
  parseTemplateFile,
  parseTemplateList,
  serializeTemplateFile,
  templateFileName,
} from '../app/lib/template-io.ts'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('PASS | ' + name) }
  else { fail += 1; console.log('FAIL | ' + name + (detail ? '\n       ' + detail : '')) }
}

const item = (id, name, content) => ({ id, name, content })

console.log('=== 0. localStorage 的 key 与文件版本号必须稳定 ===')
// 这两个字符串是用户既有数据的地址。改动它们等于把已有模板全部孤立，
// 而且不会有任何报错——用户只会看到模板「莫名其妙没了」。
check('图片模板 key 未被改动', IMAGE_TEMPLATE_KEY === 'short-drama-image-prompt-templates',
  '实际=' + IMAGE_TEMPLATE_KEY)
check('视频模板 key 未被改动', VIDEO_TEMPLATE_KEY === 'short-drama-video-templates',
  '实际=' + VIDEO_TEMPLATE_KEY)
check('导出文件版本号为 1', TEMPLATE_FILE_VERSION === 1, '实际=' + TEMPLATE_FILE_VERSION)

console.log('')
console.log('=== 1. parseTemplateList：校验必须严格，不猜测性修补 ===')
check('undefined -> 空数组', parseTemplateList(undefined).length === 0)
check('null -> 空数组', parseTemplateList(null).length === 0)
check('字符串 -> 空数组', parseTemplateList('x').length === 0)
check('数字 -> 空数组', parseTemplateList(5).length === 0)
check('对象（非数组）-> 空数组', parseTemplateList({ id: 'a' }).length === 0)
check('空数组 -> 空数组', parseTemplateList([]).length === 0)
check('合法条目 -> 保留', parseTemplateList([item('a', '雨夜', '电影感')]).length === 1)
check('缺 content -> 剔除', parseTemplateList([{ id: 'a', name: 'n' }]).length === 0)
check('缺 id -> 剔除', parseTemplateList([{ name: 'n', content: 'c' }]).length === 0)
check('缺 name -> 剔除', parseTemplateList([{ id: 'a', content: 'c' }]).length === 0)
check('null 条目 -> 剔除', parseTemplateList([null, item('a', 'n', 'c')]).length === 1)
check('数字条目 -> 剔除', parseTemplateList([123, item('a', 'n', 'c')]).length === 1)
check('字符串条目 -> 剔除', parseTemplateList(['str', item('a', 'n', 'c')]).length === 1)
check('字段类型非 string -> 整条剔除（不做隐式转换）',
  parseTemplateList([{ id: 1, name: 2, content: 3 }]).length === 0)
check('混杂输入只留合法条目',
  parseTemplateList([item('a', 'n', 'c'), {}, null, 5, 'x']).length === 1)
check('合法条目字段保持原样', parseTemplateList([item('a', 'n', 'c')])[0].id === 'a')
check('content 为空字符串的条目仍算合法（内容允许留空但字段类型要对）',
  parseTemplateList([item('a', 'n', '')]).length === 1)

console.log('')
console.log('=== 2. mergeTemplates：同 id 覆盖，重复导入不产生副本 ===')
const A = item('a', '旧名', 'old')
const B = item('b', 'B', 'b')
const A2 = item('a', '新名', 'new')
check('空 + 导入 -> 导入', mergeTemplates([], [B]).length === 1)
check('已有 + 导入新 id -> 2 条', mergeTemplates([A], [B]).length === 2)
check('同 id 覆盖而不是并存', mergeTemplates([A], [A2]).length === 1)
check('同 id 以导入文件为准', mergeTemplates([A], [A2])[0].name === '新名')
check('重复导入同一份文件不膨胀', mergeTemplates(mergeTemplates([A], [B]), [A, B]).length === 2)
check('连续导入三次仍不膨胀',
  mergeTemplates(mergeTemplates(mergeTemplates([], [A, B]), [A, B]), [A, B]).length === 2)
check('合并结果无重复 id',
  (() => { const m = mergeTemplates([A, B], [A2]); return new Set(m.map((x) => x.id)).size === m.length })())
check('空 + 空 -> 空', mergeTemplates([], []).length === 0)
check('不修改传入的原数组', (() => { const cur = [A]; mergeTemplates(cur, [B]); return cur.length === 1 })())
check('导入空数组不改变现状', mergeTemplates([A, B], []).length === 2)

console.log('')
console.log('=== 3. parseTemplateFile：两种失败要能区分 ===')
const bad = parseTemplateFile('这不是 JSON')
check('非法 JSON -> invalid-json', bad.ok === false && bad.reason === 'invalid-json')
check('空字符串 -> invalid-json', parseTemplateFile('').ok === false)
check('截断的 JSON -> invalid-json', parseTemplateFile('{"image":[{"id":"a"').ok === false)
const noTpl = parseTemplateFile('{"foo":1}')
check('无关 JSON -> no-templates', noTpl.ok === false && noTpl.reason === 'no-templates')
check('空对象 -> no-templates', parseTemplateFile('{}').ok === false)
check('null -> no-templates', parseTemplateFile('null').ok === false)
check('顶层数组 -> no-templates', parseTemplateFile('[1,2,3]').ok === false)
check('模板数组为空 -> no-templates', parseTemplateFile('{"image":[],"video":[]}').ok === false)
check('条目全不合法 -> no-templates',
  parseTemplateFile('{"image":[{"id":1}],"video":[]}').ok === false)

const onlyImg = parseTemplateFile(JSON.stringify({ image: [item('a', 'n', 'c')] }))
check('只有图片模板也算成功', onlyImg.ok === true && onlyImg.image.length === 1 && onlyImg.video.length === 0)
const both = parseTemplateFile(JSON.stringify({ image: [A], video: [item('v', '雨夜背叛', '全文')] }))
check('两类模板都解析', both.ok === true && both.image.length === 1 && both.video.length === 1)
const partial = parseTemplateFile(JSON.stringify({ image: [A, { id: 1 }, null], video: [] }))
check('部分条目非法时只留合法的', partial.ok === true && partial.image.length === 1)
check('缺 image 字段不报错', parseTemplateFile('{"video":[]}').ok === false)

console.log('')
console.log('=== 4. 导出 -> 导入 完整往返 ===')
const imageTemplates = [item('a', '电影感女主肖像', '电影感半身肖像，女主，黑色风衣，雨夜霓虹'), item('b', '雨夜背影', '背影，雨中，远景')]
const videoTemplates = [item('v1', '雨夜背叛', '完整视频提示词正文')]
const text = serializeTemplateFile(imageTemplates, videoTemplates)

check('序列化结果是可读 JSON（含换行）', text.includes('\n'))
check('序列化带 version', JSON.parse(text).version === TEMPLATE_FILE_VERSION)
check('序列化带 exportedAt', typeof JSON.parse(text).exportedAt === 'string')

const round = parseTemplateFile(text)
check('往返后图片模板条数一致', round.ok === true && round.image.length === 2)
check('往返后视频模板条数一致', round.ok === true && round.video.length === 1)
check('往返后内容一字不差', round.ok === true && round.image[0].content === imageTemplates[0].content)
check('往返后名称一字不差', round.ok === true && round.video[0].name === '雨夜背叛')
check('往返后 id 保持不变', round.ok === true && round.image[0].id === 'a')

check('空机器导入 = 全量恢复',
  round.ok === true && mergeTemplates([], round.image).length === 2 && mergeTemplates([], round.video).length === 1)
check('导出空模板库再导入 -> no-templates（不会误报成功）',
  parseTemplateFile(serializeTemplateFile([], [])).ok === false)
check('导出后立刻再导出，内容可再被解析',
  parseTemplateFile(serializeTemplateFile(imageTemplates, videoTemplates)).ok === true)

console.log('')
console.log('=== 5. buildTemplateFile / 导出文件名 ===')
const file = buildTemplateFile(imageTemplates, videoTemplates)
check('buildTemplateFile 字段齐全',
  typeof file.version === 'number' && typeof file.exportedAt === 'string' && Array.isArray(file.image) && Array.isArray(file.video))
check('exportedAt 是合法 ISO 时间', !Number.isNaN(Date.parse(file.exportedAt)))
check('文件名格式正确',
  templateFileName(new Date('2026-09-18T12:00:00Z')) === '短剧模板库-2026-09-18.json',
  '实际=' + templateFileName(new Date('2026-09-18T12:00:00Z')))
check('文件名以 .json 结尾', templateFileName().endsWith('.json'))
check('文件名不含路径分隔符（浏览器不会把它当路径）',
  !templateFileName().includes('/') && !templateFileName().includes('\\'))

console.log('')
console.log('模板导出导入专项：' + pass + ' 通过 / ' + fail + ' 失败')
