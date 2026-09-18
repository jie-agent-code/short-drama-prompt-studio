/**
 * 镜头时长模式。
 *
 * 为什么需要单独一个模块：
 * 「每镜严格 10 秒」原先硬编码在审核器、规划器、编译器、API prompt、UI 和类型定义里，
 * 一共 8 个位置。要支持第二种时长，就必须先把「时长」这件事收敛成一份数据，
 * 否则每加一种模式都要再去改 8 个地方。
 *
 * 目前两种模式：
 * - 10 秒：原有协议，镜头之间承接尾帧，可无缝拼接；
 * - 6 秒：更碎的剪辑节奏。用户明确要求**不做承接**（后期硬切换），
 *   所以这种模式不生成承接时间块、也不做尾帧承接校验。
 */

export type DurationModeId = 'ten_second' | 'six_second'

/** 时间块的语义。lead 只在需要承接的模式里出现。 */
export type TimeSlotRole = 'lead' | 'body' | 'tail'

export type TimeSlot = {
  role: TimeSlotRole
  /** 起始秒 */
  from: number
  /** 结束秒 */
  to: number
}

export type DurationMode = {
  id: DurationModeId
  name: string
  description: string
  /** 每个镜头的秒数。 */
  seconds: number
  /**
   * 时间块模板。必须首尾衔接、覆盖 0..seconds。
   * lead 块只在 chained 为 true 时存在。
   */
  slots: TimeSlot[]
  /**
   * 是否要求镜头之间承接尾帧。
   * 6 秒模式下用户后期硬切，不需要承接，也不该为承接留时间。
   */
  chained: boolean
  /**
   * 镜头数相对剧情节拍的放大系数。
   * 10 秒模式为 1（几个节拍就几个镜头）；
   * 6 秒模式为 10/6，让同一段剧情的总时长与 10 秒模式接近，画面更碎更密。
   */
  shotRatio: number
}

export const DURATION_MODES: readonly DurationMode[] = [
  {
    id: 'ten_second',
    name: '10 秒镜头',
    description: '每个镜头严格 10 秒，镜头之间承接尾帧，可直接拼接成连续段落。',
    seconds: 10,
    slots: [
      { role: 'lead', from: 0, to: 1 },
      { role: 'body', from: 1, to: 6 },
      { role: 'tail', from: 6, to: 10 },
    ],
    chained: true,
    shotRatio: 1,
  },
  {
    id: 'six_second',
    name: '6 秒镜头',
    description: '每个镜头严格 6 秒，不做尾帧承接，靠后期硬切衔接，节奏更碎、画面密度更高。',
    seconds: 6,
    // 没有 lead 块：6 秒里不留承接时间，6 秒全部用来推进剧情。
    slots: [
      { role: 'body', from: 0, to: 4 },
      { role: 'tail', from: 4, to: 6 },
    ],
    chained: false,
    shotRatio: 10 / 6,
  },
]

export const DEFAULT_DURATION_MODE_ID: DurationModeId = 'ten_second'

export function getDurationMode(id?: string | null): DurationMode {
  return DURATION_MODES.find((mode) => mode.id === id) || DURATION_MODES[0]
}

/**
 * 把一段文本里的时间描述按比例换算到目标时长。
 *
 * 用途：本地兜底模板和意图模板都是按 10 秒写死的，里面既有「0:02-0:06」
 * 也有「0-1 秒」「9-10 秒」这种写法。切到 6 秒模式时如果原样保留，
 * 提示词里就会出现 10 秒的时间码，和「严格 6 秒」直接矛盾。
 *
 * 一律取整：6 秒镜头本来就不该出现 0.6 秒这种刻度，模型也拍不出来。
 */
export function rescaleTimelineText(text: string, fromSeconds: number, toSeconds: number): string {
  if (fromSeconds === toSeconds || fromSeconds <= 0) return text
  const factor = toSeconds / fromSeconds
  const scale = (value: number) => String(Math.round(value * factor))
  return text.replace(
    /(\d+(?:\.\d+)?)\s*[-—~到]\s*(\d+(?:\.\d+)?)\s*秒|(\d+(?:\.\d+)?)\s*秒/g,
    (match, from?: string, to?: string, single?: string) => {
      if (from !== undefined && to !== undefined) return `${scale(Number(from))}-${scale(Number(to))} 秒`
      if (single !== undefined) return `${scale(Number(single))} 秒`
      return match
    },
  )
}

/**
 * 把风格预设里「每 10 秒只推进一个事件」「适合连续 10 秒拼接」这类整镜时长表述换算到目标模式。
 *
 * 为什么不直接复用 rescaleTimelineText：那个函数按比例缩放所有秒数，
 * 会把「开头 0.5-1 秒出现明确人物或事件」也一起缩放成「开头 0-1 秒」——
 * 0.5 秒是钩子的出现时点，和镜头长度无关，缩到 0 会白白丢掉信息。
 * 这里只认「每（个/一）N 秒」「连续 N 秒」这种明确的整镜时长说法。
 */
export function retimeShotLengthText(text: string, fromSeconds: number, toSeconds: number): string {
  if (!text || fromSeconds === toSeconds || fromSeconds <= 0) return text
  // 保留前缀和空格的原始写法，只替换数字：这样「每 10 秒」→「每 6 秒」、
  // 「每个严格 10 秒」→「每个严格 6 秒」，不会多出或丢掉空格。
  // 中间的修饰词限制在 6 个非数字字符以内，避免跨句误匹配。
  return text.replace(
    new RegExp(`((?:每(?:个|一)?|连续)[^0-9]{0,6}?)${fromSeconds}(\\s*秒)`, 'g'),
    (_match, head: string, tail: string) => `${head}${toSeconds}${tail}`,
  )
}

/** 把秒数格式化成时间码，例如 6 → "0:06"。 */
export function formatTimeCode(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** 把时间块渲染成「0:01-0:06」这种可直接写进提示词的区间。 */
export function formatRange(from: number, to: number): string {
  return `${formatTimeCode(from)}-${formatTimeCode(to)}`
}

/**
 * 判断一段文本里是否已经写明了该模式的时长。
 * 审核器用它检查提示词有没有交代时长，所以必须按模式判定，
 * 否则 6 秒模式会被 10 秒的检查规则误判成缺时长。
 */
export function mentionsDuration(text: string, mode: DurationMode): boolean {
  return new RegExp(`(严格\\s*)?${mode.seconds}\\s*秒`).test(text)
}

/**
 * 判断一段文本里是否含有符合该模式的时间轴。
 *
 * 判定标准是「有时间码，且最大时间码不超过该模式的时长」——
 * 刻意放宽：只要求存在时间码，不要求覆盖满全程，避免把合法的
 * 「0:00-0:02 / 0:02-0:06」这类写法误判成缺时间轴。
 * 但最大时间码超限必须判为不合格，否则 6 秒镜头会照抄 10 秒的时间轴。
 */
export function mentionsTimeline(text: string, mode: DurationMode): boolean {
  if (!/0[:：]\d{2}|0[-—~到]\d\s*秒/.test(text)) return false
  const matches = text.match(/0[:：](\d{2})/g) || []
  const maxSecond = matches.reduce((max, token) => {
    const value = Number(token.replace(/[^\d]/g, ''))
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  return maxSecond <= mode.seconds
}
