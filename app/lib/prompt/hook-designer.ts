/**
 * 黄金前 3 秒钩子设计。
 *
 * 为什么需要这个模块：
 * 风格预设里只写了「开头 0.5-1 秒出现明确人物或事件」——这是**方向**，不是**设计**。
 * 落到成品提示词里就是一句空话，模型会拍一个平淡的建立镜头，前 3 秒留不住人。
 *
 * 红果的留存生死线在开头 3 秒：观众划走只需要 1 秒。
 * 真正决定留存的不是「有没有人物」，而是**前三秒制造了什么信息缺口**——
 * 观众看到一个无法立刻解释的画面（被泼了一脸酒 / 手里攥着一张病危通知单 /
 * 一个陌生人准确叫出她的真名），才会留下来等答案。
 *
 * 所以这里把「钩子」拆成可执行的类型 + 具体的画面指令 + 信息缺口说明，
 * 而不是让模型自由发挥一句「开场要有钩子」。
 */
import type { SceneCard } from './scene-card'

/** 前 3 秒的钩子类型。不同类型的留存原理不同。 */
export type HookType =
  | 'conflict_shock' // 冲突冲击：开局即受辱/被打/被泼，制造强烈不公平感
  | 'identity_reveal' // 身份悬念：主角拿着能颠覆局面的东西或身份
  | 'suspense_object' // 悬念物件：一个无法解释的道具抢走注意力
  | 'impossible_action' // 反常动作：主角在做一件不该出现在这个场合的事
  | 'emotional_cliff' // 情绪断崖：主角正处在崩溃/震惊的临界点
  | 'arrival_shock' // 降临冲击：大场面里主角以压倒性方式出现

export type HookDesign = {
  type: HookType
  /** 钩子类型的中文名，用于提示词字段。 */
  label: string
  /**
   * 首镜必须使用的景别。
   *
   * 钩子不能只写画面内容——如果它要求「中近景切在冲突那一刻」而首镜景别字段写着「远景」，
   * 同一份提示词里就出现两个互相矛盾的景别，模型会随机选一个。
   * 所以由钩子直接决定首镜景别，规划器据此覆盖景别序列的第 0 项。
   */
  preferredShotSize: string
  /** 0-3 秒必须完成的画面指令，写成模型可直接拍的大白话。 */
  cue: string
  /** 前 3 秒要制造的信息缺口——观众为什么不划走。 */
  gap: string
  /** 该钩子对应的尾帧状态，供第 2 镜承接。 */
  tailState: string
}

const HOOK_LABELS: Record<HookType, string> = {
  conflict_shock: '冲突冲击',
  identity_reveal: '身份悬念',
  suspense_object: '悬念物件',
  impossible_action: '反常动作',
  emotional_cliff: '情绪断崖',
  arrival_shock: '降临冲击',
}

/**
 * 判定钩子类型。
 *
 * 优先级刻意设计为「冲突 > 身份 > 物件 > 情绪 > 反常 > 降临」：
 * 红果观众对「不公平」的反应最快，所以受辱类开局留存最高；
 * 身份揭晓次之；纯情绪和纯氛围最低——那是最容易划走的开局。
 */
export function decideHookType(scene: SceneCard): HookType {
  const source = [
    scene.intent.type,
    scene.event.summary,
    ...scene.event.beats,
    scene.emotion.start,
    scene.emotion.peak,
  ].join(' ')

  // 1. 降临类必须最先判定，否则会被下面的「霸气」等词误判成冲突。
  if (scene.intent.type === 'epic_arrival' || /光柱|降临|神迹|天降|凭空出现|从天而降/.test(source)) {
    return 'arrival_shock'
  }
  // 2. 冲突冲击：开局就有明确的加害动作。
  if (/被.{0,4}(泼|打|推|骂|扇|撞|羞辱|侮辱|欺负|陷害|栽赃|赶出|撵|扫地出门)|受辱|羞辱|欺负|嘲讽|讥讽|嘲笑|奚落|翻脸|逼婚|退婚|悔婚|离婚|背叛|出轨/.test(source)) {
    return 'conflict_shock'
  }
  // 3. 身份悬念：主角手上有能改变局面的东西，或真实身份即将揭晓。
  if (/项链|婚戒|戒指|遗嘱|亲子鉴定|DNA|身份证|合同|股权|继承|真千金|假千金|冒充|顶替|真实身份|我妈是|原来是.{0,6}(总裁|大小姐|继承人)/.test(source)) {
    return 'identity_reveal'
  }
  // 4. 悬念物件：化验单、照片、录音笔、账本这类需要被解释的道具。
  if (/化验单|诊断书|病历|照片|录音|录像|账本|信件|日记|监控|视频|证据|U 盘|U盘/.test(source)) {
    return 'suspense_object'
  }
  // 5. 情绪断崖：主角正处在情绪临界点。
  if (/哭|泪|崩溃|绝望|跪|颤抖|发抖|强忍|隐忍|捂脸|瘫坐|瘫倒/.test(source)) {
    return 'emotional_cliff'
  }
  // 6. 反常动作：主角在做与场合不符的事。
  if (/闯|冲进|破门|踹门|推开.{0,4}门|闯入|打断|抢|夺|摔|砸/.test(source)) {
    return 'impossible_action'
  }
  // 兜底：用情绪断崖——至少保证前 3 秒有明确的表情可拍。
  return 'emotional_cliff'
}

/**
 * 生成钩子设计。
 *
 * cue 一律写成「景别 + 机位 + 主角具体动作 + 对手反应 + 画面结果」，
 * 因为只写「开场要有冲击力」模型会拍出一个漂亮的空镜。
 */
export function designHook(scene: SceneCard): HookDesign {
  const type = decideHookType(scene)
  const lead = scene.protagonist.label
  const symbol = scene.visual.props[0] || ''
  const opponentAction = scene.event.opponentAction || ''

  const designs: Record<HookType, HookDesign> = {
    conflict_shock: {
      type,
      label: HOOK_LABELS.conflict_shock,
      preferredShotSize: '中近景',
      cue: `0:00-0:01：中近景直接切在冲突已经发生的那一刻，不做任何铺垫——${opponentAction ? `让「${opponentAction}」这个动作拍在画面前景` : `让对手的负面动作拍在画面前景`}，${lead}的脸在动作后方清楚可见。0:01-0:03：镜头不切走，${lead}保持不动，让动作结果在脸上停留满 2 秒，头发、衣物或脸上的痕迹清楚地附着在${lead}身上。禁止用空镜或环境镜头开场。`,
      gap: `观众在 1 秒内看到${lead}被当众施加不公，但不知道她是谁、为什么被这样对待，必须留下等答案。`,
      tailState: `第 3 秒${lead}停在受冲击后的第一个表情，身体姿态没有恢复，画面上还留着冲突的痕迹。`,
    },
    identity_reveal: {
      type,
      label: HOOK_LABELS.identity_reveal,
      preferredShotSize: '特写',
      cue: `0:00-0:01：特写（极特写）${symbol || '关键物件'}在${lead}手中被握紧或打开，占满画面，观众第一眼只看到物件本身。0:01-0:03：镜头从物件快速上摇到${lead}的正面近景，${lead}的表情从平静转为做出决定，眼神看向画面外一个明确方向。全过程不出现第三方解释性台词。`,
      gap: `观众看到${lead}拿着${symbol || '一个关键物件'}并做出了某种决定，但不知道这个物件意味着什么、她要去做什么。`,
      tailState: `第 3 秒${lead}保持握紧${symbol || '物件'}的手部姿态与看向画外的视线，物件位置清楚可复现。`,
    },
    suspense_object: {
      type,
      label: HOOK_LABELS.suspense_object,
      preferredShotSize: '近景',
      cue: `0:00-0:01：近景让${symbol || '关键道具'}被推到画面前景占满画面，${lead}只是画面后方的虚焦人影，观众的注意力被物件抢走。0:01-0:03：焦点从物件缓慢转移到${lead}的正面近景，${lead}的反应清楚——皱眉、睁大眼睛或呼吸停滞中的一个，物件仍在画面边缘可见。`,
      gap: `观众先看到${symbol || '这个道具'}再看到${lead}的反应，但不知道道具上写了什么、为什么让她变了脸色。`,
      tailState: `第 3 秒${lead}停在看完${symbol || '道具'}后的反应表情，道具保持在同一位置同一朝向。`,
    },
    impossible_action: {
      type,
      label: HOOK_LABELS.impossible_action,
      preferredShotSize: '中景',
      cue: `0:00-0:01：中景里${lead}以明确的方向闯入画面，从画面一侧进入并占据前景，动作方向写清楚（从左入画向右、或从右入画向左），背景里的人转头看她。0:01-0:03：${lead}在动作中途停住，切到正面中近景站定并抬眼，身体朝向不变，背景人群的反应保持不动。不倒退、不倒放。`,
      gap: `观众看到${lead}闯进了一个她明显不该出现或被拒绝进入的场合并站定，但不知道她接下来要做什么。`,
      tailState: `第 3 秒${lead}停住动作、站稳、抬眼看向画面内一个明确方向，双手位置清楚。`,
    },
    emotional_cliff: {
      type,
      label: HOOK_LABELS.emotional_cliff,
      preferredShotSize: '近景',
      cue: `0:00-0:01：近景或特写直接切在${lead}的脸上，情绪已经处在临界点——眼眶泛红、嘴唇发抖或眼泪已经挂在脸上，不做情绪铺垫。0:01-0:03：${lead}做一个克制的反应动作（偏头、闭眼、深吸气或用手背擦脸），但在最后 1 秒停住，重新睁开眼。不嚎啕大哭，情绪保持内收。`,
      gap: `观众一上来就看到${lead}快要撑不住，但不知道她刚经历了什么，情绪已经先于信息到达。`,
      tailState: `第 3 秒${lead}停在重新睁眼、情绪被强压回去的状态，视线和手部位置明确。`,
    },
    arrival_shock: {
      type,
      label: HOOK_LABELS.arrival_shock,
      preferredShotSize: '远景',
      cue: `0:00-0:01：先用一个明确的视觉异常抢住注意力——远景里出现光柱、能量裂纹、天空裂开或地面震动中的一种，画面中必须有可以对比尺度的人物剪影。0:01-0:03：中景里${lead}从异常中心出现，身体轮廓完整、衣摆和头发被气流托起，周围人物做出后退、跪倒或抬手遮挡的反应。前 3 秒不出现台词。`,
      gap: `观众看到一个违反常识的降临场面，但不知道${lead}是谁、为什么以这种方式出现、接下来会做什么。`,
      tailState: `第 3 秒${lead}轮廓完整地停在异常中心，衣摆和粒子仍在运动，周围人物保持反应姿态。`,
    },
  }

  return designs[type]
}

/**
 * 判断某个镜头是否是「黄金前 3 秒」的承载镜——只有第一镜需要钩子。
 */
export function isOpeningShot(index: number): boolean {
  return index === 0
}
