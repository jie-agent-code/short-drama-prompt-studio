/**
 * 覆盖镜生成器。
 *
 * 为什么需要这个模块：
 * 6 秒模式的镜头数按 10/6 放大（3 个节拍 → 5 镜、5 个节拍 → 9 镜），
 * 于是镜头数会多于节拍数。多出来的镜头如果写成「在上一镜的结果上继续推进，完成一个新动作」，
 * 会同时踩两个坑：
 *   1) 两个延展镜拿到同一句话，等于把同一个画面拍两遍；
 *   2) 「继续推进、完成一个新动作」是元指令——它没有告诉视频模型任何具体信息。
 *
 * 红果短剧的真实做法是覆盖剪辑：主镜拍动作，再用插入镜（道具/符号特写）
 * 和反应镜（对手或旁观者的脸）把情绪放大。这两类镜头不新增剧情动作，
 * 只是换机位重拍已经发生的事，所以既不会违反「不添加用户未要求的动作」，
 * 又能真正提高画面密度——这正是 6 秒模式想要的「更碎」。
 */

export type CoverageKind = 'insert' | 'reaction' | 'emotion'

/** 与 narrative-planner 的 BeatRole 结构一致；此处独立声明以避免模块循环依赖。 */
export type CoverageRole = 'setup' | 'conflict' | 'turn' | 'climax'

export type CoverageContext = {
  /** 主角称呼，例如「女主」。 */
  lead: string
  /** 对手角色称呼（来自 scene.event.opponentAction），可能为空。 */
  opponent: string
  /** 视觉符号类道具，例如「项链」「化验单」。 */
  props: string[]
  /** 该覆盖镜服务的主镜情绪角色，用于挑选反应镜的表演。 */
  role: CoverageRole
}

export type CoverageSpec = {
  kind: CoverageKind
  /** 同一种覆盖镜的第二轮要换拍法（面部镜 → 手部镜），避免连续两镜雷同。 */
  variant: number
}

export type CoverageShot = {
  kind: CoverageKind
  /** 用于镜头标题的短标识，含具体对象（道具名/对手名），保证标题不重复。 */
  label: string
  /** 主体时间块文案，必须是视频模型可直接执行的描述。 */
  core: string
  /** 尾块文案。 */
  tail: string
  shotSize: string
  transition: string
  visualFocus: string
  /** 本镜的动作方向：覆盖镜一律原地完成，不做位移。 */
  actionDirection: string
}

/** 可用的覆盖镜类型池。有视觉符号先拍道具，其次拍对手反应，最后用主角情绪兜底。 */
function coverageKindPool(ctx: CoverageContext): CoverageKind[] {
  const pool: CoverageKind[] = []
  if (ctx.props.length) pool.push('insert')
  if (ctx.opponent) pool.push('reaction')
  pool.push('emotion')
  return pool
}

/**
 * 挑选覆盖镜类型。
 *
 * offset 是「整段里第几个覆盖镜」，必须由调用方跨节拍累加：
 * 每个节拍都从 0 重新开始的话，一段里会出现两个一模一样的道具特写，等于没有切镜。
 * 池子轮转而不是重复同一种，正是为了避免这件事。
 */
export function pickCoverageSpecs(count: number, ctx: CoverageContext, offset = 0): CoverageSpec[] {
  if (count <= 0) return []
  const pool = coverageKindPool(ctx)
  return Array.from({ length: count }, (_, index) => {
    const position = offset + index
    return {
      kind: pool[position % pool.length] as CoverageKind,
      variant: Math.floor(position / pool.length),
    }
  })
}

function insertShot(ctx: CoverageContext, variant: number): CoverageShot {
  const prop = ctx.props[variant % ctx.props.length] || '道具'
  // 同一个道具被拍第二次时必须换角度，否则两镜是同一个画面。
  if (variant % 2 === 1) {
    return {
      kind: 'insert',
      label: `${prop}第二角度`,
      core: `插入镜：镜头从侧面切到${prop}的特写，${prop}占画面右侧三分之二，${ctx.lead}的肩颈和手腕入画压住画面左侧，背景虚化，画面里不出现其他人物`,
      tail: `停在${prop}清楚入画的状态，${prop}的位置保持不变`,
      shotSize: '特写',
      transition: '硬切 → 道具第二角度插入',
      visualFocus: `${prop}的侧面轮廓、反光和${ctx.lead}的手腕位置`,
      actionDirection: `${ctx.lead}保持站位不移动，只有手腕轻微转动让${prop}转向镜头`,
    }
  }
  return {
    kind: 'insert',
    label: `${prop}插入镜`,
    core: `插入镜：镜头切到${prop}的特写，${prop}占画面中央，${ctx.lead}的手停在${prop}旁边、手指收紧，背景虚化，画面里不出现其他人物`,
    tail: `停在${prop}清楚入画的状态，${prop}的位置和反光保持不变`,
    shotSize: '特写',
    transition: '硬切 → 道具特写插入',
    visualFocus: `${prop}的材质和反光、${ctx.lead}的手部位置`,
    actionDirection: `${ctx.lead}保持站位不移动，只用一只手完成道具动作，手部朝向镜头`,
  }
}

function reactionShot(ctx: CoverageContext, variant: number): CoverageShot {
  const opponent = ctx.opponent || '旁观者'
  // 反应镜的表演必须跟着该节拍的情绪走：
  // 爽点段是对手被压住，冲突段是对手得意落空，铺垫段只是观察。
  // 每一条都写成单句、单动作，不用「或」给模型留二选一。
  const performance = ctx.role === 'climax'
    ? `${opponent}被${ctx.lead}的气场压住，身体下意识后退半步，视线从${ctx.lead}身上移开`
    : ctx.role === 'conflict'
      ? `${opponent}的表情从得意转为僵住，嘴角的弧度停住，视线停在${ctx.lead}脸上`
      : ctx.role === 'turn'
        ? `${opponent}的表情停在意外上，眉毛抬起，视线没有离开${ctx.lead}`
        : `${opponent}在画面一侧观察${ctx.lead}，表情和视线清楚可见`
  const tail = variant > 0
    ? `停在${opponent}视线移开的状态，肩膀不再抬起`
    : `停在${opponent}反应完成的表情上，视线方向保持不变`
  return {
    kind: 'reaction',
    label: `${opponent}反应镜`,
    core: `反应镜：镜头切到${opponent}的脸，只拍上半身，${performance}，身体不做位移`,
    tail,
    shotSize: '近景',
    transition: '硬切 → 反应镜插入',
    visualFocus: `${opponent}的表情变化、视线方向和上半身姿态`,
    actionDirection: `${opponent}保持站位不移动，只有面部和视线发生变化`,
  }
}

function emotionShot(ctx: CoverageContext, variant: number): CoverageShot {
  if (variant % 2 === 1) {
    return {
      kind: 'emotion',
      label: '手部细节镜',
      core: `细节镜：镜头切到${ctx.lead}的手部特写，${ctx.lead}的手指慢慢收紧再松开，手背和指节清楚可见，背景虚化，画面里不出现其他人物`,
      tail: `停在${ctx.lead}手部动作停住的状态，手的位置保持不变`,
      shotSize: '特写',
      transition: '硬切 → 手部细节插入',
      visualFocus: `${ctx.lead}的手部动作、指节和用力程度`,
      actionDirection: `${ctx.lead}保持站位不移动，只用手完成收紧与松开的动作`,
    }
  }
  return {
    kind: 'emotion',
    label: '面部情绪镜',
    core: `情绪镜：镜头切到${ctx.lead}的面部近景，${ctx.lead}不做新动作，情绪在脸上走完一遍，先收紧再松开，视线方向不变，呼吸起伏可听见`,
    tail: `停在${ctx.lead}情绪落定的表情上，眼睛保持睁开`,
    shotSize: '近景',
    transition: '硬切 → 情绪特写',
    visualFocus: `${ctx.lead}的面部表情、眼神和呼吸起伏`,
    actionDirection: `${ctx.lead}保持站位不移动，只有面部和呼吸发生变化`,
  }
}

export function buildCoverageShot(spec: CoverageSpec, ctx: CoverageContext): CoverageShot {
  if (spec.kind === 'insert') return insertShot(ctx, spec.variant)
  if (spec.kind === 'reaction') return reactionShot(ctx, spec.variant)
  return emotionShot(ctx, spec.variant)
}

/** 情绪权重，用于决定额外镜头分给哪些节拍。只在这里定义一次。 */
const ROLE_WEIGHT: Record<CoverageRole, number> = { setup: 0, turn: 1, conflict: 2, climax: 3 }

/**
 * 把 extra 个额外镜头分配到 count 个主镜上。
 *
 * 分配原则：情绪最重的节拍拿更多画面（爽点 > 冲突 > 转折 > 铺垫），
 * 因为爆款的高潮段需要更密的切点；权重相同时靠后的节拍优先，
 * 让覆盖镜落在更靠近高潮的位置。
 *
 * 之所以不是「平均摊」：平均摊会把额外镜头分给铺垫段，
 * 结果开场拍了两个无关紧要的画面，高潮仍然只有一个镜头。
 */
export function allocateExtraShots(count: number, extra: number, roles: CoverageRole[]): number[] {
  const result = Array.from({ length: Math.max(0, count) }, () => 0)
  if (count <= 0 || extra <= 0) return result
  const order = Array.from({ length: count }, (_, index) => index).sort((a, b) => {
    const weightA = ROLE_WEIGHT[roles[a] as CoverageRole] ?? 0
    const weightB = ROLE_WEIGHT[roles[b] as CoverageRole] ?? 0
    if (weightA !== weightB) return weightB - weightA
    return b - a
  })
  let remaining = extra
  let cursor = 0
  while (remaining > 0) {
    const target = order[cursor % order.length] as number
    result[target] = (result[target] || 0) + 1
    remaining -= 1
    cursor += 1
  }
  return result
}
