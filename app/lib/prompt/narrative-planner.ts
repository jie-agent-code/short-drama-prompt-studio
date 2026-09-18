/**
 * 基于剧情节拍的动态分镜。
 *
 * 为什么需要这个模块：
 * 原先的 shot-planner 是「按意图查模板」——把剧情压缩成一个意图标签，再返回写死的
 * S01/S02/S03 文案。结果是任何输入只要意图相同（例如都是 dramatic），
 * 三镜时间轴逐字相同，剧情关键词一个都进不去，用户写的「泼红酒受辱」在成品里完全消失。
 *
 * 这里改为：把 scene.event.beats（从自然叙事切出的动作序列）按原始叙述顺序分配进镜头块，
 * 让每镜的目标、时间轴、视觉重点都承载真实剧情内容；节拍不够分时用覆盖镜补足画面密度。
 * 意图模板只作为兜底。
 */
import type { SceneCard } from './scene-card'
import type { PlannedShot } from './shot-planner'
import { buildShotIds, MAX_SHOT_COUNT } from './continuity-auditor'
import { designHook } from './hook-designer'
import { formatRange, getDurationMode, DEFAULT_DURATION_MODE_ID, type DurationMode } from './duration-modes'
import {
  allocateExtraShots,
  buildCoverageShot,
  pickCoverageSpecs,
  type CoverageContext,
  type CoverageRole,
  type CoverageShot,
  type CoverageSpec,
} from './beat-coverage'

/**
 * 按镜头数生成景别序列。
 *
 * 红果的景别节奏是「远 → 中 → 近 → 特写」逐步收紧，
 * 到冲突/爽点用近景或特写放大情绪，最后回到中景收尾留悬念。
 * 固定取 3 个景别套到 5-8 镜上会出现景别重复且节奏混乱。
 *
 * 多镜时以「情绪高点的镜头必须收得最紧」为准——
 * 单纯按下标递增会让爽点镜停在近景，情绪放大不到位。
 */
function buildShotSizeSequence(recommended: string[], count: number, roles: BeatRole[], openingSize = ''): string[] {
  const base = ['远景', '中景', '中近景', '近景', '近景 / 特写', '特写', '中景', '远景']
  const source = recommended.length >= 3 ? recommended : ['远景', '中景', '近景']
  if (count <= 3) {
    // 3 镜以内沿用风格预设推荐，保持与旧行为一致。
    const seq = Array.from({ length: count }, (_, i) => source[Math.min(i, source.length - 1)])
    // 但爽点镜例外：它需要景别收得最紧来放大情绪，风格预设的三档推荐不够。
    roles.forEach((role, index) => {
      if (index < count && role === 'climax') seq[index] = '特写'
    })
    // 黄金前 3 秒钩子对首镜景别有决定权：钩子要求中近景时不能还写着远景，
    // 否则同一份提示词里出现两个矛盾景别，模型会随机挑一个。
    if (openingSize) seq[0] = openingSize
    return seq
  }
  const sequence = Array.from({ length: count }, (_, i) => base[Math.min(i, base.length - 1)])
  // 爽点镜强制收到特写：这是情绪的物理放大器，不能被下标顺序稀释。
  roles.forEach((role, index) => {
    if (index >= count) return
    if (role === 'climax') sequence[index] = '特写'
    else if (role === 'conflict' && sequence[index] === '远景') sequence[index] = '近景'
  })
  if (openingSize) sequence[0] = openingSize
  return sequence
}

/** 情绪节拍的位置语义——红果爆款的骨架：铺垫 → 冲突 → 转折 → 爽点。 */
export type BeatRole = 'setup' | 'conflict' | 'turn' | 'climax'

export type NarrativeBeat = {
  text: string
  role: BeatRole
  /** 该 beat 落在哪一镜（0-based），即它占用的第一镜。 */
  shotIndex: number
  /** 该 beat 占用几个镜头。6 秒模式下会大于 1，多出来的镜头由覆盖镜填充。 */
  shotCount: number
}

export const ROLE_LABELS: Record<BeatRole, string> = {
  setup: '铺垫',
  conflict: '冲突',
  turn: '转折',
  climax: '爽点',
}

/**
 * 给 beat 分配情绪角色。
 *
 * 判定依据是 beat 文本自身的关键词，而不是它在序列中的位置——
 * 因为「受辱」可能出现在第一句，「推门重回」可能出现在最后一句，
 * 但两者的情绪功能完全不同。位置只作为无法判定时的兜底。
 */
function classifyBeat(text: string, index: number, total: number): BeatRole {
  // 冲突：被施加负面动作、受辱、争执。
  if (/被.{0,4}(泼|打|推|骂|扇|撞|撞倒|羞辱|侮辱|欺负|陷害|栽赃|误解)|受辱|羞辱|欺负|嘲讽|讥讽|嘲笑|奚落|争吵|争执|翻脸|质问|反驳|拒绝|背叛|欺骗|出轨|发现.{0,6}(背叛|偷窃|秘密|真相)|偷窃|偷走/.test(text)) {
    return 'conflict'
  }
  // 爽点：气场反转、身份揭晓、决定性动作。
  if (/霸气|推门|重回|返回|重新出现|揭穿|拆穿|戳穿|反转|觉醒|戴上.{0,6}(项链|戒指|胸针)|亮出|公布|宣布|身份|回归|惊艳|爆发|反击|打脸|跪下|求饶|认错/.test(text)) {
    return 'climax'
  }
  // 转折：情绪或决定的转换点。
  if (/隐忍|克制|按捺|退入|退回|走进后台|离开|起身离开|深吸|深呼吸|闭眼|沉默|决定|下定决心|选择|放弃|转身|握紧|攥紧|咬牙|眼泪|落泪/.test(text)) {
    return 'turn'
  }
  // 兜底按位置分配。
  if (index === 0) return 'setup'
  if (index === total - 1) return 'climax'
  return 'turn'
}

/**
 * 把 beat 序列分配进镜头块。
 *
 * 分配原则（红果爆款的情绪骨架）：
 * - **镜头顺序必须等于剧情顺序**。早先的实现按情绪强度排序后分配，
 *   结果「女主被泼红酒受辱，她隐忍后退入后台」被排成 S01 退入后台、S02 被泼红酒——
 *   观众看到的是先退场再被泼酒，因果完全颠倒。
 *   情绪强度只用来决定「哪一镜收得更紧」「哪一镜多给画面」，不能用来决定谁先谁后。
 * - 每个 beat 至少占一镜；多出来的镜头按情绪权重分配（爽点 > 冲突 > 转折 > 铺垫），
 *   6 秒模式的镜头数按 10/6 放大，所以必然有多出来的镜头。
 * - beat 数少于 2 时返回空数组，调用方退回意图模板。
 */
export function buildNarrativeBeats(beats: string[], mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID)): NarrativeBeat[] {
  if (!beats || beats.length < 2) return []

  // 保持原始叙述顺序：镜头的先后必须和剧情一致，否则会出现因果颠倒的画面。
  const classified = beats.map((text, index) => ({
    text,
    role: classifyBeat(text, index, beats.length),
  }))

  // 镜头数由节拍数决定（与 decideShotCount 一致），不再写死 3 个。
  const shotCount = decideShotCount(classified.length, mode)
  const extras = allocateExtraShots(
    classified.length,
    shotCount - classified.length,
    classified.map((item) => item.role),
  )

  let cursor = 0
  return classified.map((item, index) => {
    const shotIndex = cursor
    const quota = 1 + (extras[index] || 0)
    cursor += quota
    return { text: item.text, role: item.role, shotIndex, shotCount: quota }
  })
}

/**
 * 根据剧情节拍数量决定镜头块数量。
 *
 * 红果爆款一段冲突通常用 5-8 个画面承载，而不是固定 3 个。
 * 固定 3 镜会把 5-6 个节拍硬挤进 3 个镜头，每镜平均承载 2 个事件，
 * 节奏被压扁、爽点密度不足——这正是「不像爆款」的核心原因之一。
 *
 * 策略：
 * - 镜头数 = ceil(beatCount × mode.shotRatio)。
 *   10 秒模式的 shotRatio 是 1（几个节拍几个镜头）；
 *   6 秒模式的 shotRatio 是 10/6，让同一段剧情的总时长与 10 秒模式接近、画面更碎更密；
 * - 下限 2 镜：1 个 beat 无法构成「可拼接的段落」，至少要有承接关系；
 * - 上限 MAX_SHOT_COUNT：再多单镜信息量会不足。
 *
 * 注意下限是 2 而不是 3——写死 3 会让 2 个 beat 的剧情被迫多出一个
 * 没有内容可拍的延展镜，那正是「切几块被写死」的翻版。
 */
export function decideShotCount(beatCount: number, mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID)): number {
  if (beatCount <= 0) return 3
  const scaled = Math.ceil(beatCount * mode.shotRatio)
  return Math.max(2, Math.min(MAX_SHOT_COUNT, scaled))
}

/**
 * 按模式的槽位模板生成带语义的时间块。
 *
 * 10 秒模式是「1 秒承接 + 5 秒主体 + 4 秒尾帧」；
 * 6 秒模式没有承接槽位，6 秒全部用来推进剧情（用户后期硬切衔接）。
 * 时间块完全由 mode.slots 驱动，所以新增时长模式不需要再改这里。
 */
function timeBlocksFrom(mode: DurationMode, content: { core: string; tail: string }, previousShotId: string | null): string[] {
  return mode.slots.map((slot) => {
    const range = `${formatRange(slot.from, slot.to)}：`
    if (slot.role === 'lead') {
      return range + (previousShotId ? `承接 ${previousShotId} 最后一帧，姿态与站位不变` : '用第一帧直接建立空间和人物身份')
    }
    if (slot.role === 'body') return range + content.core
    return range + content.tail
  })
}

/** 主镜的尾块文案：按情绪角色决定这一镜停在什么地方。 */
function tailTextFor(role: BeatRole, mode: DurationMode): string {
  if (role === 'climax') {
    return mode.chained
      ? '动作完成后定住，保留表情和视线，作为本段爽点尾帧'
      : '动作完成后停在情绪释放的瞬间，保留表情和视线'
  }
  if (role === 'conflict') return '情绪反应完整呈现，停在冲突最高点的表情和姿态'
  if (role === 'turn') return '停在做出决定后的第一个动作和眼神'
  return '停在可复现的尾帧姿态，保留环境声入口'
}

/** 覆盖镜的上下文：主角、对手角色、视觉符号道具。 */
function coverageContext(scene: SceneCard, role: CoverageRole): CoverageContext {
  return {
    lead: scene.protagonist.label,
    opponent: scene.event.opponentAction || '',
    props: scene.visual.props,
    role,
  }
}

/**
 * 基于 beats 生成镜头规划。
 * 返回空数组表示「剧情信息不足以拆镜」，调用方退回意图模板。
 */
export function planFromNarrativeBeats(scene: SceneCard, selectedMovement: (index: number) => string, mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID)): PlannedShot[] {
  const beats = buildNarrativeBeats(scene.event.beats, mode)
  if (!beats.length) return []

  const protagonist = scene.protagonist.label
  const symbols = scene.visual.props.filter((prop) => scene.visual.styleHints.some((hint) => hint.includes(prop)))

  // 逐镜展开：每个节拍的第一镜是主镜（拍节拍本身），
  // 剩余额度用覆盖镜（道具插入镜 / 对手反应镜 / 情绪特写镜）填充。
  // 覆盖镜只换机位重拍已经发生的事，不新增剧情动作，
  // 这样 6 秒模式「镜头更多」才不会退化成两镜拍同一个画面。
  type Slot = { beat: NarrativeBeat; ctx: CoverageContext; spec: CoverageSpec | null }
  const slots: Slot[] = []
  // 覆盖镜类型在整段里轮转（offset 跨节拍累加），
  // 否则每个节拍都从「道具插入镜」重新开始，一段里会出现两个一模一样的特写。
  let coverageCursor = 0
  beats.forEach((beat) => {
    const ctx = coverageContext(scene, beat.role)
    slots.push({ beat, ctx, spec: null })
    const specs = pickCoverageSpecs(beat.shotCount - 1, ctx, coverageCursor)
    coverageCursor += specs.length
    specs.forEach((spec) => slots.push({ beat, ctx, spec }))
  })

  const shotCount = slots.length
  const shotIds = buildShotIds(shotCount)
  // 每镜的情绪角色取自它服务的那个 beat，用于决定景别收紧程度。
  const shotRoles: BeatRole[] = slots.map((slot) => slot.beat.role)
  // 首镜景别交给钩子决定：钩子描述的是前 3 秒实际拍到的画面，
  // 它的景别比「景别序列第 0 项」更权威。
  const openingSize = designHook(scene).preferredShotSize
  const shotSizes = buildShotSizeSequence(scene.camera.recommendedShotSizes, shotCount, shotRoles, openingSize)

  const planned: PlannedShot[] = slots.map((slot, index) => {
    const id = shotIds[index] as string
    const previousId = index > 0 ? shotIds[index - 1] as string : null
    const roleLabel = ROLE_LABELS[slot.beat.role]
    const coverage: CoverageShot | null = slot.spec ? buildCoverageShot(slot.spec, slot.ctx) : null

    // 覆盖镜的景别由覆盖类型决定（插入镜必须特写、反应镜必须近景），
    // 不能被「远 → 中 → 近」的景别序列冲掉，否则道具特写会被写成远景。
    if (coverage) shotSizes[index] = coverage.shotSize

    const core = coverage ? coverage.core : slot.beat.text
    const tail = coverage ? coverage.tail : tailTextFor(slot.beat.role, mode)
    // 标题必须逐镜可区分：覆盖镜用「角色·具体对象」（例如「爽点·项链插入镜」），
    // 否则 UI 上会出现两个一字不差的镜头卡。
    const title = coverage ? `${roleLabel}·${coverage.label}` : `${roleLabel}：${slot.beat.text.slice(0, 18)}`
    // 视觉符号：在冲突镜和爽点镜必须出现，这是红果的符号叙事手法。
    // 覆盖镜本身已经写明具体对象，不重复拼接符号提示。
    const symbolCue = !coverage && symbols.length && (slot.beat.role === 'climax' || slot.beat.role === 'conflict')
      ? `；必须清楚地拍到${symbols.join('、')}`
      : ''

    return {
      id,
      durationSeconds: mode.seconds,
      title,
      shotSize: shotSizes[index] || shotSizes[shotSizes.length - 1] || '中景',
      objective: `本镜承担「${roleLabel}」功能：${core}`,
      timeBlocks: timeBlocksFrom(mode, { core, tail }, previousId),
      movement: selectedMovement(index),
      transition: coverage
        ? coverage.transition
        : slot.beat.role === 'climax'
          ? '动作定格 → 情绪重音切'
          : index === 0
            ? mode.chained ? '淡入或硬切 → 建立镜头' : '硬切入场 → 直接进入动作'
            : mode.chained ? '动作匹配切 → 声音桥接' : '硬切 → 直接进入下一个动作',
      // 免承接模式（6 秒）不留尾帧锚点：用户后期硬切衔接，
      // 写承接锚点反而会让模型把镜头结尾处理成「等待下一镜」的停滞姿态。
      incomingAnchor: mode.chained
        ? index === 0
          ? `${protagonist}的身份、服装、道具、光线和空间位置在第一帧就明确`
          : `${protagonist}的身份、服装、道具、光线和空间位置与 ${previousId} 最后一帧完全一致`
        : `${protagonist}的身份、服装、道具和空间位置在本镜第一帧就明确`,
      outgoingAnchor: mode.chained
        ? slot.beat.role === 'climax'
          ? `${protagonist}停在情绪释放后的定住姿态，${symbols.length ? `${symbols.join('、')}清楚入画，` : ''}保留视线和声音入口`
          : `${protagonist}停在可复现的姿态，保留视线、道具位置和环境声`
        : slot.beat.role === 'climax'
          ? `${protagonist}停在情绪释放的瞬间，${symbols.length ? `${symbols.join('、')}清楚入画，` : ''}动作不停顿、不做等待姿态`
          : `${protagonist}停在动作的自然落点，不做等待或回望姿态`,
      actionDirection: coverage ? coverage.actionDirection : scene.event.movementDirection,
      // 覆盖镜只拍表情、道具和反应，硬加台词会抢掉主镜的信息。
      dialogueCue: coverage
        ? '本段不强行添加台词，以动作和环境声为主'
        : slot.beat.role === 'conflict' || slot.beat.role === 'climax'
          ? scene.dialogue.suggestedLines[0]
            ? `由${protagonist}说：“${scene.dialogue.suggestedLines[0]}”，口型清楚、说完留出反应时间`
            : '以呼吸、抽气或环境声承载情绪，不强行加台词'
          : scene.dialogue.required
            ? '台词短、口语化，说完留出反应时间'
            : '本段不强行添加台词，以动作和环境声为主',
      visualFocus: [
        coverage
          ? coverage.visualFocus
          : slot.beat.role === 'climax'
            ? '气场反转的瞬间、表情变化和符号道具'
            : '面部表情、手部动作和身体朝向',
        coverage ? '' : symbolCue.replace(/^；/, ''),
      ].filter(Boolean).join('；'),
    } as PlannedShot
  })

  return planned
}
