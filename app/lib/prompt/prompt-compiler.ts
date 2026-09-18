import type { SceneCard } from './scene-card'
import type { PlannedShot } from './shot-planner'
import type { ContinuityAuditReport, ContinuityShot } from './continuity-auditor'
import type { StylePreset } from './style-presets'
import { designHook, isOpeningShot, type HookDesign } from './hook-designer'
import { DEFAULT_DURATION_MODE_ID, getDurationMode, retimeShotLengthText, type DurationMode } from './duration-modes'

/**
 * 风格预设是按 10 秒协议撰写的（「每 10 秒只推进一个事件」「适合连续 10 秒拼接」）。
 * 切到别的时长模式时必须把这些整镜时长表述一起换算，
 * 否则 6 秒模式的成品里会同时出现「严格 6 秒」和「每 10 秒只推进一个事件」。
 */
const STYLE_AUTHORING_SECONDS = 10

export type CompiledShot = ContinuityShot & {
  shotSize: string
}

export type CompiledPromptSet = {
  /** 编译格式标识。含时长后缀，便于区分 10 秒与 6 秒产物。 */
  format: string
  compiledText: string
  shots: CompiledShot[]
  /** 被用户或规划器覆盖掉的执行内容，用于前端提示“你的编辑覆盖率”。 */
  overrideSummary: {
    byPlan: string[]
    byStyle: string[]
  }
}

export const EMPTY_OVERRIDE_SUMMARY: CompiledPromptSet['overrideSummary'] = { byPlan: [], byStyle: [] }

function line(label: string, value: string) {
  return `${label}：${value}`
}

function unique(list: string[]) {
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)))
}

/**
 * 情绪的外化指令。
 *
 * 只写「强忍屈辱」模型会拍成面无表情，必须翻译成表演动作：
 * 眼睛看哪、呼吸怎么走、手和身体怎么控制。
 */
const EMOTION_PERFORMANCE: Record<string, string> = {
  // 压制类：情绪被压在里面，靠微表情和呼吸体现。
  压: '情绪不外放，靠眼神和下颌的收紧体现；呼吸刻意放慢，肩膀保持不动，嘴角用力压平。',
  // 爆发类：情绪冲出来，靠动作幅度和速度体现。
  爆: '情绪外放，动作幅度加大、速度加快；眼神直视对方不闪避，说话时下颌抬起。',
  // 崩塌类：情绪失控，靠身体失衡体现。
  崩: '情绪失控的瞬间，身体重心轻微后仰或下沉，眼睛睁大但视线失去焦点，双手无意识收紧。',
  // 决绝类：情绪转为力量，靠姿态的重心前移体现。
  决: '情绪已转为决断，重心略微前移，下巴微收，眼神平稳地定在目标上，动作干净不拖沓。',
}

function matchPerformance(text: string) {
  // 决断类优先判定：「把屈辱压下去，转为蓄势待发的冷静」同时含「压」和「蓄势」，
  // 但语义落点是反击前的蓄力，不是继续忍耐，所以必须先命中决断类。
  if (/蓄势|决绝|决断|强者|定住|从容|平稳|反击|翻盘/.test(text)) return EMOTION_PERFORMANCE['决']
  if (/压|忍|克制|维持|收紧|收在|咽/.test(text)) return EMOTION_PERFORMANCE['压']
  if (/爆发|暴怒|怒火|冲顶|击穿|濒临/.test(text)) return EMOTION_PERFORMANCE['爆']
  if (/僵住|崩塌|失去焦点|失控|后仰|瘫/.test(text)) return EMOTION_PERFORMANCE['崩']
  return '情绪变化必须通过脸部和呼吸让观众看得见，不做无表情的过渡。'
}

/**
 * 按镜头在情绪曲线上的位置选择情绪锚点。
 *
 * 首镜对齐 start（情绪起点），冲突镜对齐 peak（情绪高点），
 * 爽点镜和末镜对齐 end（情绪落点）。
 *
 * 爽点镜必须取 end 而不是 peak：end 是「把屈辱压下去、转为蓄势待发的冷静」，
 * peak 是「屈辱到极点」。爽点是扬眉吐气的反打，套用 peak 会把情绪语义写反。
 */
function pickEmotionAnchor(scene: SceneCard, plan: PlannedShot, index: number, total: number): { label: string; text: string; performance: string } | null {
  const emotion = scene.emotion
  if (!emotion || (!emotion.start && !emotion.peak && !emotion.end)) return null

  const isPayoff = /承担「爽点」/.test(plan.objective)
  const isConflict = /承担「冲突」/.test(plan.objective)
  const isLast = index === total - 1 && index !== 0
  const stage: 'start' | 'peak' | 'end' = isPayoff ? 'end' : isConflict ? 'peak' : isLast ? 'end' : 'start'
  const stageLabel = isPayoff ? '情绪释放' : stage === 'peak' ? '情绪高点' : stage === 'end' ? '情绪落点' : '情绪起点'
  const text = emotion[stage] || emotion.peak || emotion.start || emotion.end
  if (!text) return null
  return { label: stageLabel, text, performance: matchPerformance(text) }
}

/**
 * 编译单个镜头。
 *
 * 关键修复（P0）：旧实现把 plan（镜头规划）和 shot.prompt（模型原文）同时塞进提示词，
 * 结果是计划器与编辑器的修改只以“约束”形式附在末尾，模型会优先执行末尾大段原文，
 * 导致用户在编辑面板里对景别/运镜/时间轴/尾帧承接的改动在生成时被静默丢弃。
 * 现在改为：用户编辑过的字段以规划器为准直接占据正式字段位，模型原文降级为补充参考。
 */
function compileShot(scene: SceneCard, plan: PlannedShot, shot: ContinuityShot, report: ContinuityAuditReport, style: StylePreset, hook: HookDesign | null, index: number, total: number, mode: DurationMode): CompiledShot {
  // 首镜景别以钩子为准：钩子描述的是前 3 秒实际拍到的画面。
  // 这里是最后一道，必须强制对齐——否则走意图模板兜底的剧情（beat 不足 2 个）
  // 会出现「景别写远景、钩子写中景」的自相矛盾。
  const shotSize = hook?.preferredShotSize || plan.shotSize?.trim() || shot.shotSize?.trim() || '中景'
  const movement = plan.movement?.trim() || shot.movement?.trim() || '稳定跟拍'
  const transition = plan.transition?.trim() || shot.transition?.trim() || '动作匹配切 → 声音桥接'
  const timeline = plan.timeBlocks.length ? plan.timeBlocks.join('；') : shot.prompt
  const incomingAnchor = plan.incomingAnchor?.trim() || '与上一镜保持角色、站位、朝向、服装、道具和光线一致'
  // 兜底也必须是模型可直接执行的描述，不能是“请写清方向”这类元指令。
  const actionDirection = plan.actionDirection?.trim() || `${scene.protagonist.label}面朝镜头正前方入画，原地完成主要动作，落地后不再继续位移`
  const dialogueCue = plan.dialogueCue?.trim() || (scene.dialogue.required ? `由${scene.protagonist.label}说话，口型和停顿清楚` : '本段不强行添加台词')
  const outgoingAnchor = plan.outgoingAnchor?.trim() || '停在可复现的尾帧姿态，保留环境声入口'

  const shotIssues = report.issues.filter((issue) => issue.shotId === shot.id)
  const continuityNote = shotIssues.length
    ? `本段经过连续性修正：${shotIssues.map((issue) => issue.repair).join('；')}`
    : '本段连续性检查通过；保持角色、站位、朝向、服装、道具和光线一致。'

  const effects = scene.visual.effects.length ? scene.visual.effects.join('、') : '无额外特效'
  const props = scene.visual.props.length ? scene.visual.props.join('、') : '无指定道具'
  // 情绪标注必须落到「可表演的指令」上。
  // scene.emotion 已经能按剧情推导（受辱 → 强忍屈辱，表面维持体面），
  // 但旧实现从不消费它，模型拿不到情绪基调，只能自己猜。
  // 这里按镜头在情绪曲线上的位置取对应的情绪锚点——
  // 首镜对应 start、冲突/爽点镜对应 peak、末镜对应 end，
  // 并补上可执行的外化指令（眼睛看哪、呼吸怎么走、身体怎么控制）。
  const emotionAnchor = pickEmotionAnchor(scene, plan, index, total)
  // 视觉符号是承担叙事重量的道具（项链、化验单、婚戒），必须在关键镜头重复出现。
  // scene-card 会把它写进 styleHints，但旧实现从未消费这个字段，导致符号叙事能力凭空丢失。
  const symbolHint = scene.visual.styleHints.find((hint) => hint.startsWith('视觉符号需在关键镜头重复出现'))
  const visualSymbols = symbolHint ? symbolHint.replace('视觉符号需在关键镜头重复出现：', '') : ''

  // 禁止项必须写成明确的“不要 XXX”。
  // 旧实现把 forbiddenDefaults 裸接入列表（只写“舞蹈、街舞”），视频模型会把它当成正面提示词，
  // 反而更容易生成跳舞画面。这里统一补上否定前缀。
  const negatives = unique([
    ...style.negativeRules,
    ...scene.continuity.forbiddenDefaults.map((item) => (/^(不要|禁止|无|不)/.test(item) ? item : `不要${item}`)),
    '无穿模',
    '无肢体变形',
    '无卡顿',
    '无倒放',
    '无反向行走',
    '不倒退',
  ])

  const compiledPrompt = [
    line('视频规格', `${style.format}，严格 ${mode.seconds} 秒，每段只推进一个主要事件`),
    line('风格预设', `${style.name}：${retimeShotLengthText(style.description, STYLE_AUTHORING_SECONDS, mode.seconds)}`),
    line('风格执行', unique([...style.visualRules, ...style.pacingRules, ...style.dialogueRules].map((rule) => retimeShotLengthText(rule, STYLE_AUTHORING_SECONDS, mode.seconds))).join('；')),
    line('剧情意图', scene.intent.label),
    line('人物锁定', `${scene.protagonist.label}${scene.protagonist.name ? `（${scene.protagonist.name}）` : ''}${scene.protagonist.role ? `，身份：${scene.protagonist.role}` : ''}，性别固定为${scene.protagonist.gender === 'female' ? '女' : scene.protagonist.gender === 'male' ? '男' : '未指定'}，代词固定为${scene.protagonist.pronoun}`),
    line('参与人物', scene.participants.join('、') || '仅主角'),
    line('场景锁定', `${scene.setting.location}，${scene.setting.time}，${scene.setting.weather}，${scene.setting.lighting}`),
    line('景别与运镜', `${shotSize}；${movement}`),
    // 黄金前 3 秒：只在首镜注入，且必须是可拍的具体画面 + 信息缺口说明。
    // 风格预设里的「开头 0.5-1 秒出现明确人物」只是方向，撑不住留存。
    ...(hook ? [line('前 3 秒钩子（最高优先级）', `${hook.label}——${hook.cue} 信息缺口：${hook.gap} 第 3 秒必须停在：${hook.tailState}`)] : []),
    line('本段目标', plan.objective),
    // 情绪必须落到表演指令：只写「强忍屈辱」模型会拍成面无表情。
    ...(emotionAnchor ? [line('情绪标注', `${emotionAnchor.label}：${emotionAnchor.text}。外化表演：${emotionAnchor.performance}`)] : []),
    line('时间轴', timeline),
    line('动作方向', actionDirection),
    line('台词提示', dialogueCue),
    line('特效与道具', `特效：${effects}；道具：${props}`),
    ...(visualSymbols ? [line('视觉符号', `${visualSymbols}；必须在冲突镜和爽点镜清楚入画，保持在镜头里的位置和状态可辨认`)] : []),
    line('视觉重点', plan.visualFocus),
    // 免承接模式（6 秒）不输出承接字段：用户后期硬切，
    // 写了承接反而会让模型把镜头结尾处理成等待下一镜的停滞姿态。
    ...(mode.chained
      ? [line('上一镜承接', incomingAnchor), line('尾帧承接', outgoingAnchor)]
      : [line('衔接方式', '本镜独立成立，不做尾帧承接，由后期硬切衔接；结尾停在动作的自然落点，不留等待姿态')]),
    line('转场', transition),
    line('原始执行内容（补充参考，不得覆盖以上字段）', shot.prompt),
    line('连续性审核', continuityNote),
    line('负面约束', negatives.join('、')),
  ].join('\n')

  return {
    ...shot,
    shotSize,
    movement,
    transition,
    prompt: compiledPrompt,
  }
}

export function compilePromptSet(scene: SceneCard, plans: PlannedShot[], shots: ContinuityShot[], report: ContinuityAuditReport, style: StylePreset, mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID)): CompiledPromptSet {
  // 黄金前 3 秒钩子只作用于首镜——第二镜以后观众的留存问题已由「已进入故事」解决，
  // 再注入钩子会破坏剧情的线性推进。
  const hook = plans.length ? designHook(scene) : null
  const compiledShots = plans.map((plan, index) => compileShot(scene, plan, shots[index] || {
    id: plan.id,
    title: plan.title,
    shotSize: plan.shotSize,
    movement: plan.movement,
    // 模型返回的镜头数少于规划时（例如 5 节拍却只给了 3 镜），
    // 这里必须用规划器的完整时间轴补位，而不是只留一句 objective——
    // 一句目标撑不起整段镜头，会让补位镜明显比其余镜头空。
    prompt: [plan.objective, ...plan.timeBlocks, plan.actionDirection].filter(Boolean).join('；'),
    transition: plan.transition,
    audit: '',
  }, report, style, isOpeningShot(index) ? hook : null, index, plans.length, mode))

  const compiledText = compiledShots.map((shot) => [
    `【${shot.id}】`,
    `${mode.seconds}.0 秒`,
    shot.title,
    shot.prompt,
    `转场：${shot.transition}`,
    `审核：${shot.audit}`,
  ].join('\n')).join('\n\n')

  const byPlan: string[] = []
  if (plans.some((plan) => plan.shotSize?.trim())) byPlan.push('景别')
  if (plans.some((plan) => plan.movement?.trim())) byPlan.push('运镜')
  if (plans.some((plan) => plan.timeBlocks.length)) byPlan.push('时间轴')
  if (plans.some((plan) => plan.outgoingAnchor?.trim())) byPlan.push('尾帧承接')
  if (plans.some((plan) => plan.objective?.trim())) byPlan.push('本段目标')

  const byStyle: string[] = []
  if (style.visualRules.length) byStyle.push('视觉规则')
  if (style.pacingRules.length) byStyle.push('节奏规则')
  if (style.dialogueRules.length) byStyle.push('台词规则')
  if (style.negativeRules.length) byStyle.push('负面约束')

  return { format: `short_drama_${mode.seconds}s_v1`, compiledText, shots: compiledShots, overrideSummary: { byPlan, byStyle } }
}
