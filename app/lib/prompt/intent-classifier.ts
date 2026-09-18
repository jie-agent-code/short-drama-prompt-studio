export type PlotIntent = 'epic_arrival' | 'action' | 'dance' | 'chase' | 'romance' | 'dramatic'

export type PlotIntentLabel = {
  intent: PlotIntent
  label: string
  confidence: number
  matchedKeywords: string[]
  reason: string
  recommendedMovements: string[]
  mustInclude: string[]
  forbiddenDefaults: string[]
}

type IntentRule = {
  intent: PlotIntent
  label: string
  keywords: string[]
  phrases?: string[]
  movements: string[]
  mustInclude: string[]
  forbiddenDefaults: string[]
}

const rules: IntentRule[] = [
  {
    intent: 'epic_arrival',
    label: '神性降临 / 大制作登场',
    keywords: ['神明', '神祇', '神祗', '神圣', '神力', '神灵', '降临', '天降', '光柱', '雷霆', '法阵', '觉醒', '仙气', '魔域', '神迹', '从天而降', '凌空', '悬浮', '威压', '神威', '大制作'],
    phrases: ['如神明般', '如神般', '似神明般', '神明般降临', '宛如神明', '破空而来', '从天而降', '降世', '现身现场', '神临'],
    movements: ['Crane Down', '低机位 Dolly In 前推', '环绕运镜', '后拉揭示 Dolly Out'],
    mustInclude: ['远景交代空间', '光线或能量来源', '落地或出现的明确动作', '威严台词', '特效声音'],
    forbiddenDefaults: ['跳舞', '街舞', '耍帅'],
  },
  {
    intent: 'action',
    label: '战斗 / 打斗冲突',
    keywords: ['战斗', '打斗', '攻击', '对决', '拔刀', '开枪', '爆炸', '冲锋', '追杀', '挥刀', '格挡', '击飞', '厮杀'],
    phrases: ['开始交手', '激烈打斗', '迎面冲来'],
    movements: ['手持感', '跟拍', '子弹时间运镜', '慢门镜头 Slow Shutter'],
    mustInclude: ['攻击起始位置', '攻击方向', '受击反馈', '动作节奏', '打击声音'],
    forbiddenDefaults: ['跳舞', '街舞', '没有因果的特效'],
  },
  {
    intent: 'chase',
    label: '追逐 / 逃跑',
    keywords: ['奔跑', '追逐', '逃跑', '冲向', '飞奔', '逃离', '追上', '拦截', '疾驰'],
    phrases: ['一路追赶', '转身就跑', '朝前方冲去'],
    movements: ['Steadicam Follow', '跟拍', 'FPV 穿越视角', '横移平移 Tracking / Truck'],
    mustInclude: ['明确前进方向', '哪只脚先迈', '追赶双方距离变化', '障碍物位置', '脚步声'],
    forbiddenDefaults: ['倒退行走', '倒放', '无方向来回移动'],
  },
  {
    intent: 'dance',
    label: '舞蹈 / 表演',
    keywords: ['跳舞', '舞蹈', '街舞', '起舞', '舞步', '跳一段', '表演舞蹈'],
    phrases: ['完成一段舞蹈', '伴随音乐起舞'],
    movements: ['跟拍', '环绕运镜', '手持感', '子弹时间运镜'],
    mustInclude: ['动作顺序', '手脚位置', '音乐节拍', '动作收尾姿态'],
    forbiddenDefaults: ['无理由战斗特效'],
  },
  {
    intent: 'romance',
    label: '情感关系 / 爱情冲突',
    keywords: ['告白', '表白', '拥抱', '亲吻', '重逢', '心动', '分手', '误会', '吃醋', '告别'],
    phrases: ['四目相对', '终于见面', '说出心里话'],
    movements: ['过肩反打镜头 Over-the-Shoulder / Reverse Shot', '焦点转移', '缓慢推进', '环绕运镜'],
    mustInclude: ['双方视线方向', '表情变化', '台词和停顿', '手部动作', '情绪结尾'],
    forbiddenDefaults: ['突然加入大规模战斗', '跳舞'],
  },
  {
    intent: 'dramatic',
    label: '戏剧推进 / 信息揭示',
    keywords: ['发现', '揭露', '秘密', '真相', '误会', '转身', '拒绝', '质问', '等待', '决定', '离开'],
    phrases: ['气氛突然改变', '发现关键线索', '做出决定'],
    movements: ['焦点转移', '手持感', '缓慢推进', '后拉揭示 Dolly Out'],
    mustInclude: ['事件前因', '关键动作', '视线或信息变化', '台词或声音线索', '可承接的尾帧'],
    forbiddenDefaults: ['跳舞', '超自然特效'],
  },
]

/**
 * 否定语境检测。
 *
 * 关键修复：旧实现只判断整个输入里是否出现过“不要跳舞”这类字样，
 * 且仅把 dance 分数 −4，其它意图的 forbid 一律无视。
 * 现在改为按意图逐个检测否定语境，命中后直接清零该意图得分，
 * 保证“女主在废墟广场不要跳舞，她如神明般降临现场”不会再落到 dance。
 */
const negationPatterns: Record<PlotIntent, RegExp> = {
  dance: /不(要|需|用|必)?\s*(跳舞|舞蹈|街舞|起舞|舞步)|禁止\s*(跳舞|舞蹈)|没有\s*(跳舞|舞蹈)|非\s*舞蹈|无\s*舞蹈/,
  action: /不(要|需|用|必)?\s*(打架|打斗|战斗|交手)|禁止\s*(打斗|战斗)|没有\s*(打斗|战斗)/,
  chase: /不(要|需|用|必)?\s*(追|奔跑|逃跑)|禁止\s*(追逐|逃跑)|没有\s*(追逐|追赶)/,
  romance: /不(要|需|用|必)?\s*(表白|告白|亲吻|拥抱)|禁止\s*(亲吻|表白)|没有\s*(感情线|爱情)/,
  epic_arrival: /不(要|需|用|必)?\s*(神性|降临|特效)|禁止\s*(降临|神性)|没有\s*(特效|超自然)/,
  dramatic: /不(要|需|用|必)?\s*(反转|揭秘|揭露)/,
}

export function analyzePlotIntent(text: string): PlotIntentLabel {
  const source = (text || '').trim()
  const scores = rules.map((rule) => {
    const matchedKeywords = rule.keywords.filter((keyword) => source.includes(keyword))
    const matchedPhrases = (rule.phrases || []).filter((phrase) => source.includes(phrase))
    const negated = negationPatterns[rule.intent]?.test(source) ?? false
    return {
      rule,
      matchedKeywords: negated ? [] : [...matchedKeywords, ...matchedPhrases],
      score: negated ? 0 : matchedKeywords.length + matchedPhrases.length * 2,
      negated,
    }
  })

  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]
  const second = scores[1]
  const fallback = rules[rules.length - 1]
  const hit = best.score > 0
  const intent = hit ? best.rule : fallback
  // 关键修复：未命中时置信度必须与“按戏剧推进兜底”这个事实一致，
  // 同时 reason 要说明是兜底结果，避免前端显示成 0.35 的高置信识别。
  const confidence = hit
    ? Math.min(0.98, 0.55 + best.score * 0.08 + (best.score - (second?.score || 0)) * 0.04)
    : 0.3

  return {
    intent: intent.intent,
    label: intent.label,
    confidence: Number(confidence.toFixed(2)),
    matchedKeywords: hit ? best.matchedKeywords : [],
    reason: hit
      ? `识别到关键词：${best.matchedKeywords.join('、')}${best.negated ? '（已排除被否定项）' : ''}`
      : '没有命中明确类型，按普通戏剧推进兜底处理；建议补充动作、场景或情绪关键词。',
    recommendedMovements: intent.movements,
    mustInclude: intent.mustInclude,
    forbiddenDefaults: intent.forbiddenDefaults,
  }
}
