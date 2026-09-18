import type { PlotIntent, PlotIntentLabel } from './intent-classifier'

export type SceneCard = {
  version: '1.0'
  sourceText: string
  intent: {
    type: PlotIntent
    label: string
    confidence: number
    evidence: string[]
  }
  protagonist: {
    label: string
    name?: string
    role?: string
    gender: 'female' | 'male' | 'unknown'
    pronoun: string
  }
  participants: string[]
  setting: {
    location: string
    time: string
    weather: string
    lighting: string
    foreground: string
    background: string
  }
  event: {
    summary: string
    primaryAction: string
    movementDirection: string
    startState: string
    endState: string
    /** 从自然叙事切出的事件序列，供规划器按事件数动态分镜。 */
    beats: string[]
    /** 对手施加的负面动作（如“假千金故意泼红酒”），供前 3 秒钩子设计使用。 */
    opponentAction: string
  }
  emotion: {
    start: string
    peak: string
    end: string
  }
  dialogue: {
    required: boolean
    tone: string
    speaker: string
    suggestedLines: string[]
  }
  visual: {
    effects: string[]
    props: string[]
    styleHints: string[]
  }
  camera: {
    recommendedShotSizes: string[]
    recommendedMovements: string[]
    firstShotGoal: string
    lastFrameGoal: string
  }
  continuity: {
    mustLock: string[]
    forbiddenDefaults: string[]
  }
  notes: string[]
}

function firstMatch(source: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

/**
 * 从原始剧情文本里解析主角身份。
 *
 * 这是全项目唯一的角色识别实现，Agent 节点也必须复用它。
 * 不要在别处再写一套「女主/男主」正则——那会出现两套不一致的识别结果。
 */
export function protagonistFrom(source: string) {
  const femalePattern = /女主|女生|女孩|女人|妻子|女友|姐姐|妹妹|母亲|妈妈|她/g
  const malePattern = /男主|男生|男孩|男人|丈夫|男友|哥哥|弟弟|父亲|爸爸|他/g

  // 用 exec 循环取位置，而不是 spread matchAll——后者的迭代器在 es5 target 下会报
  // "can only be iterated through when using the --downlevelIteration flag"。
  const collectIndexes = (pattern: RegExp) => {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    const indexes: number[] = []
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      indexes.push(match.index)
      // 防御空匹配导致的死循环。
      if (match.index === re.lastIndex) re.lastIndex += 1
    }
    return indexes
  }

  const femaleHit = collectIndexes(femalePattern)
  const maleHit = collectIndexes(malePattern)

  /**
   * 性别判定必须考虑「出现顺序」，不能只看有没有出现过。
   *
   * 剧情里同时写到男女角色很常见，例如「妻子发现丈夫背叛」。
   * 旧实现用 `female && male ⇒ unknown`，会把这种再正常不过的输入降级成「主角」，
   * 白白丢掉女主的身份和代词——这正违反了「输入女主绝不能生成男主」的硬性规则。
   *
   * 这里的约定：**最早出现的角色是主角**。若男女首次出现位置相同（极少），再退回数量比较。
   */
  let gender: 'female' | 'male' | 'unknown' = 'unknown'
  if (femaleHit.length && maleHit.length) {
    const firstFemale = Math.min(...femaleHit)
    const firstMale = Math.min(...maleHit)
    if (firstFemale < firstMale) gender = 'female'
    else if (firstMale < firstFemale) gender = 'male'
    else gender = femaleHit.length >= maleHit.length ? 'female' : 'male'
  } else if (femaleHit.length) {
    gender = 'female'
  } else if (maleHit.length) {
    gender = 'male'
  }

  const label = gender === 'female' ? '女主' : gender === 'male' ? '男主' : '主角'
  // 全角冒号（：）和半角冒号（:）都要支持，否则“名字：苏晚”会解析失败。
  const name = firstMatch(source, [/名[字称](?:叫|是)?\s*[:：]?\s*([^\s，。；;、,]+)/, /(?:他|她)叫\s*([^\s，。；;、,]+)/])
  const role = firstMatch(source, [/身份(?:是|为|叫)?\s*[:：]?\s*([^\s，。；;、,]+)/, /职业(?:是|为)?\s*[:：]?\s*([^\s，。；;、,]+)/, /(?:是(?:一名|一个|个)?)\s*([^\s，。；;、,]{1,6}(?:师|生|人|者|官|员|总|手|将|主|王|后|妃|太|兵|侠|医|警|导))/, /(?:身为|作为一名|作为一个)\s*([^\s，。；;、,]+)/])
  return {
    label,
    name,
    role,
    gender,
    // 代词必须由性别派生，保证「主角身份」被用户改成女主后，代词和物主代词同步跟随。
    pronoun: gender === 'female' ? '她' : gender === 'male' ? '他' : '主角',
  } as SceneCard['protagonist']
}

function settingFrom(source: string, intent: PlotIntent): SceneCard['setting'] {
  // 兜底必须是具体的实拍可用场地，不能写“待补充的主要场景”这类占位词。
  // 占位词会原样进到成片提示词里，模型无法据此建立空间，镜头之间也无法保持场景一致。
  const locationFallbacks: Record<PlotIntent, string> = {
    epic_arrival: '开阔废墟广场',
    action: '开阔废墟广场或废弃厂房空地',
    chase: '狭窄街道与巷口，可见门框和转角',
    dance: '室内舞台，地面平整，背景有灯光架',
    romance: '室内房间或夜间街道，空间安静少人',
    dramatic: '室内房间或临街窗口，可清楚看到人物表情',
  }
  const location = firstMatch(source, [
    /(城市广场|废墟广场|天台|屋顶|街道|雨夜街头|森林|宫殿|魔域|战场|教室|办公室|餐厅|医院|车站|房间|巷子|舞台|厂房|客厅|卧室|走廊|电梯|停车场)/,
    /在([^，。；;]*(?:广场|废墟|天台|屋顶|街道|森林|宫殿|魔域|战场|教室|办公室|餐厅|医院|车站|房间|巷子|舞台|厂房|客厅|卧室|走廊))/,
  ]) || locationFallbacks[intent]
  const time = /雨夜|深夜|午夜/.test(source) ? '夜晚' : /清晨|早晨|白天|黄昏|傍晚|夜晚/.exec(source)?.[0] || '与原剧情一致的时间'
  const weather = /暴雨|大雨|雨夜|下雨|雪天|下雪|大雾|雾气|晴天|雷雨|风暴/.exec(source)?.[0] || '无明显天气变化'
  const lighting = intent === 'epic_arrival' ? '从上方或能量源方向打下强光，人物轮廓清楚' : weather.includes('雨') ? '冷色环境光加地面反光，人物脸部保持可见' : '主光方向稳定，人物脸部和动作清楚'
  return {
    location,
    time,
    weather,
    lighting,
    foreground: '前景放置少量可定位空间的物体，不遮挡主角脸和手脚',
    background: intent === 'epic_arrival' ? '背景展示光柱、天空或大尺度环境变化' : '背景保持简洁，人物关系和动作不被抢走',
  }
}

/**
 * 动作动词表。用于从自然叙事里识别「这一句在讲一个动作」。
 * 覆盖短剧高频动作：位移、手部、情绪外化、对抗、交互。
 */
const ACTION_VERBS = '转身|转身离开|走向|走开|跑向|跑去|冲向|冲出去|跳|跃|挥|挥手|抬手|抬脚|抬下巴|低头|抬头|落地|站起|起身|坐下|推门|推开门|踹门|拔|开枪|攻击|出手|抱住|拥抱|亲吻|跪下|倒下|跌倒|瘫倒|奔|狂奔|逃离|逃开|追赶|追上|前行|向前|后退|后退半步|蹲|蹲下|伸手|抓|抓住|攥紧|握紧|捏|扔|砸|摔|踢|飞|降临|出现|现身|放下|举起|摘下|戴上|脱下|穿上|拿出|掏出|递|接过|打开|翻开|撕|扯|泼|洒|倒|倒酒|敬酒|扇|打|推|拉开|挡住|拦|背对|背身|扑|扑向|搂|扶|搀|躲|闪|避开|退让|起身离开|离开|走出|走进|进门|回头|回眸|瞥|瞪|盯|扫视|环顾|看|看向|望向|注视|凝视|哭|落泪|流泪|笑|冷笑|苦笑|微笑|嗤笑|咬牙|抿嘴|皱眉|叹气|深呼吸|颤抖|发抖|握拳|攥拳|拍|拍桌|敲|指|指着|点|点头|摇头|鞠躬|行礼|转身面对|发现|得知|听说|收到|查出|看见|撞见|偷听|收集|搜|翻出|找出|查到|揭穿|拆穿|戳穿|质问|反驳|解释|承认|供认|坦白|交代|拒绝|答应|同意|否认|决定|下定决心|选择|放弃|坚持|忍|隐忍|克制|按捺|退入|退回|走进后台|重回|返回|重新出现|拨通|挂断|拨号|接听|喊|大喊|吼|叫住|开口|沉默|闭眼|睁眼|抬头看|缓缓|慢慢|猛地|突然|立刻|随即|随后|接着|然后|终于';

/** 短剧高频情绪词 → 情绪状态描述，用于推导 emotion 字段。 */
const EMOTION_MAP: Array<{ pattern: RegExp; start: string; peak: string; end: string }> = [
  { pattern: /受辱|羞辱|欺负|看不起|轻视|嘲讽|讥讽|嘲笑|奚落|侮辱|难堪|难看|狼狈|出丑|丢脸/, start: '强忍屈辱，表面维持体面', peak: '屈辱到极点，眼神从隐忍转为锐利', end: '把屈辱压下去，转为蓄势待发的冷静' },
  { pattern: /背叛|出轨|欺骗|辜负|谎言|骗|隐瞒/, start: '还抱着最后一丝信任', peak: '真相砸下来，信任彻底崩塌', end: '情绪收紧，做决定前的最后沉默' },
  { pattern: /病危|病重|去世|死亡|抢救|噩耗|癌症|奄奄一息/, start: '不安，隐约预感到坏消息', peak: '得知结果的瞬间，整个人僵住', end: '强撑着行动，情绪压在未来得及落下的眼泪里' },
  { pattern: /委屈|冤枉|被误解|背锅|栽赃|陷害/, start: '想解释却说不出口', peak: '被逼到角落，情绪濒临爆发', end: '把所有解释咽回去，只留一个决绝的眼神' },
  { pattern: /惊喜|意外|没想到|突然发现/, start: '毫无准备，状态松弛', peak: '在关键信息前愣住', end: '情绪转向新方向' },
  { pattern: /愤怒|生气|暴怒|震怒|怒/, start: '克制着情绪', peak: '怒火冲顶，动作带上力量', end: '怒意收进眼神和呼吸里' },
  { pattern: /害怕|恐惧|惊恐|吓|胆怯|不安/, start: '神经紧绷，观察四周', peak: '恐惧达到顶点，身体本能后缩', end: '压下恐惧，决定应对' },
  { pattern: /温柔|甜蜜|心动|脸红|羞涩|娇羞/, start: '放松、带着自然笑意', peak: '心跳加速，视线忍不住追着对方', end: '笑意收在嘴角，气氛留在半空' },
  { pattern: /决绝|反转|觉醒|爆发|忍无可忍|彻底翻脸|不再忍/, start: '隐忍、压低姿态', peak: '临界点被击穿，气场彻底转换', end: '以全新的强者姿态定住' },
  { pattern: /偷窃|偷走|抄袭|剽窃|冒领|抢功|窃取|盗用|伪造|造假|作弊/, start: '察觉到不对劲，先不动声色', peak: '确认被窃取的瞬间，冷下来', end: '收起情绪，转入冷静的收集与布局' },
  { pattern: /揭穿|拆穿|戳穿|当面对质|对峙|拆台|反击|翻盘|逆袭/, start: '稳住情绪，按自己的节奏推进', peak: '证据落地的瞬间，对方哑口无言', end: '以胜利者的从容姿态收尾，留一个眼神' },
  { pattern: /冷落|忽视|边缘化|排挤|孤立|抢走|夺走|失去|被夺/, start: '努力维持现状，试图挽回', peak: '意识到已经彻底失去', end: '把失落压下去，转向新的方向' },
]

/**
 * 判断一个分句是否是「否定声明」而非剧情动作。
 *
 * 关键：用户写「不要跳舞」「禁止倒退」是在表达约束，不是描述剧情。
 * 如果不排除，这些句子会因为含有动作动词（跳舞/倒退）被误当成事件节拍，
 * 进而变成某个镜头的拍摄内容——比不识别更糟糕。
 */
function isNegatedClause(clause: string) {
  return /^(不|不要|别|禁止|严禁|杜绝|避免|不可|不得|无|没有|防止|切勿|莫|勿)/.test(clause.trim())
}

/**
 * 从自然叙事里切出「事件序列」。
 *
 * 这是本模块最关键的一步。旧实现只用一个正则抓单个动作，
 * 且要求出现「剧情是：」这种显式引导词，用户写自然叙事时完全命不中，
 * 于是整条链路退回意图模板——剧情细节在这里被彻底丢掉。
 *
 * 新策略：按标点切分句，逐句判断「是否在讲一个动作」，
 * 保留原句描述，供后续按事件数动态分镜使用。
 */
export function extractNarrativeEvents(source: string) {
  // 先按句末标点+逗号切成小句，同时保留一些常见的并列连接。
  const clauses = source
    .split(/[。；;！？!?\n]+/)
    .flatMap((sentence) => sentence.split(/[，,]/))
    .map((clause) => clause.trim())
    .filter(Boolean)

  const events: string[] = []
  clauses.forEach((clause) => {
    // 否定声明不是剧情动作，必须排除，否则「不要跳舞」会被拍进镜头。
    if (isNegatedClause(clause)) return
    // 命中的动作动词越多，越可能是真正的事件句。
    const verbPattern = new RegExp(ACTION_VERBS, 'g')
    const verbs = clause.match(verbPattern)
    if (!verbs || !verbs.length) return
    // 过滤掉纯状态描述（只有「在/是/有」没有动作）。
    if (clause.length < 3) return
    // 去重：同一个动作短语重复出现只保留一次。
    if (events.some((item) => item === clause)) return
    events.push(clause)
  })

  return events
}

/** 从自然叙事推导情绪曲线；命中不了任何情绪词时返回 undefined，交由意图兜底。 */
export function inferEmotion(source: string): SceneCard['emotion'] | undefined {
  for (const entry of EMOTION_MAP) {
    if (entry.pattern.test(source)) {
      return { start: entry.start, peak: entry.peak, end: entry.end }
    }
  }
  return undefined
}

/** 从自然叙事里提取「视觉符号」：承担叙事重量的道具，需要在关键镜头重复出现。 */
export function extractVisualSymbols(source: string) {
  // 能承载身份反转 / 情绪重量的物件，和普通道具区分开。
  const symbolPattern = /项链|戒指|婚戒|胸针|耳环|手镯|手表|眼镜|黑框眼镜|口红|高跟鞋|礼服|披肩|围巾|领带|徽章|工牌|病历|化验单|检查报告|离婚协议|合同|欠条|借条|照片|合照|情书|日记|钥匙|车钥匙|房卡|请柬|录取通知书|奖状|奖杯|银行卡|手机|录音笔|摄像头|监控|信封|档案袋|U盘|药瓶|拐杖|轮椅/g
  const found = source.match(symbolPattern) || []
  return Array.from(new Set(found))
}

/** 判断剧情里是否存在「主角被他人施加动作」的施受关系。 */
export function extractOpponentAction(source: string) {
  // 「被 X 泼」「遭到 X 侮辱」「X 故意 X 她」这类结构说明有明确的对手角色。
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /假千金/, label: '假千金' },
    { re: /真千金/, label: '真千金' },
    { re: /继母|后妈/, label: '继母' },
    { re: /婆婆/, label: '婆婆' },
    { re: /闺蜜/, label: '闺蜜' },
    { re: /小三|情敌/, label: '情敌' },
    { re: /同事/, label: '同事' },
    { re: /上司|老板|总裁/, label: '上司' },
    { re: /同学/, label: '同学' },
    { re: /男友|女朋友|前男友|前女友/, label: '对方' },
    { re: /丈夫|老公|妻子|老婆/, label: '配偶' },
    { re: /敌人|杀手|追兵/, label: '敌人' },
    { re: /群众|众人|围观/, label: '围观群众' },
  ]
  const hits = patterns.filter((p) => p.re.test(source)).map((p) => p.label)
  return Array.from(new Set(hits))
}

function actionFrom(source: string, intent: PlotIntent, protagonist: SceneCard['protagonist']) {
  // 优先：显式引导词（用户明确写了「剧情是：xxx」）。
  const explicit = firstMatch(source, [/(?:剧情|动作|事件)是\s*[:：]?\s*([^。]+)/])
  if (explicit) return explicit

  // 次优：从自然叙事抽出事件序列，拼成有先后顺序的动作链。
  // 这才是短剧输入的常态——用户会写「她隐忍后退入后台，戴上项链霸气推门」，
  // 不会写「剧情是：转身」。旧实现只认后者，导致剧情细节全部丢失。
  const events = extractNarrativeEvents(source)
  if (events.length) {
    // 最多取前 4 个事件，避免动作链过长导致单镜承载过多。
    const chain = events.slice(0, 4)
    const opponent = extractOpponentAction(source)
    const prefix = opponent.length && /被|遭|让|给/.test(source) ? `${protagonist.label}面对${opponent[0]}：` : ''
    return `${prefix}${chain.join(' → ')}`
  }

  // 最后：意图默认值。
  const defaults: Record<PlotIntent, string> = {
    epic_arrival: `${protagonist.label}从高处或能量光源中出现，双脚落地并抬眼看向现场`,
    action: `${protagonist.label}完成一次有起点、方向和受击反馈的攻击或防守动作`,
    chase: `${protagonist.label}面朝前方正常向前奔跑，不倒退、不倒放`,
    dance: `${protagonist.label}按照明确的手脚顺序完成一段连续舞步`,
    romance: `${protagonist.label}与对方保持视线关系，通过靠近、停顿或手部动作推进情绪`,
    dramatic: `${protagonist.label}发现信息或做出决定，并以明确动作结束本段`,
  }
  return defaults[intent]
}

function directionFrom(source: string, intent: PlotIntent) {
  if (/向画面右|向右|右侧|右边/.test(source)) return '人物面朝画面右侧，从左向右正常移动，右脚先迈'
  if (/向画面左|向左|左侧|左边/.test(source)) return '人物面朝画面左侧，从右向左正常移动，左脚先迈'
  if (/前行|向前|前进|奔跑|冲向/.test(source) || intent === 'chase') return '人物面朝前方，沿镜头前方正常向前移动，不倒退、不倒放'
  // 兜底必须是视频模型可直接执行的描述，不能写成“请写清方向”这种元指令。
  // 元指令只对创作者有意义，模型拿不到任何具体信息，等于这一镜的动作方向是空的。
  const fallbacks: Record<PlotIntent, string> = {
    epic_arrival: '人物原地竖直移动为主，自上方垂直下降到地面，面朝镜头正前方，落地后不再继续位移',
    action: '人物面朝对手方向，向前一步进入攻击距离，攻击结束后停在原位不回退',
    dance: '人物原地完成动作，面朝镜头正前方，只在落点上做左右小幅位移',
    romance: '人物面朝对方方向，向前半步靠近后停住，保持视线接触不回退',
    dramatic: '人物面朝关键对象方向，转身后停在原地面向其，不做多余位移',
    chase: '人物面朝前方，沿镜头前方正常向前移动，不倒退、不倒放',
  }
  return fallbacks[intent]
}

function dialogueFrom(source: string, intent: PlotIntent, protagonist: SceneCard['protagonist']): SceneCard['dialogue'] {
  // 关键修复：旧实现 required = explicit || intent !== 'dance'，
  // 而 dance 的台词表是空数组，结果 dance 分支下 required 为 true、台词却为空，
  // 规划器会输出“由女主说话”但没有任何可执行内容。现在改为按台词表是否为空判定。
  const explicit = /台词|说|喊|质问|回答|宣告|低声|大喊|对白|道\s*[:：]/.test(source)
  const lines: Record<PlotIntent, string[]> = {
    epic_arrival: ['蝼蚁，谁准许你们仰望神明？', '记住我的名字，凡人。'],
    action: ['退后。', '这一击，结束。'],
    chase: ['站住！', '别让他跑了！'],
    dance: [],
    romance: ['你终于来了。', '这一次，我不会再离开。'],
    dramatic: ['原来真相是这样。', '从现在开始，我自己做决定。'],
  }
  const suggestedLines = explicit
    ? firstMatch(source, [/(?:台词|对白)\s*[:：]?\s*[“"]([^”"]+)[”"]/, /(?:说|喊|道)\s*[:：]?\s*[“"]([^”"]+)[”"]/])?.split(/[，。；;]/).filter(Boolean) || lines[intent]
    : lines[intent]
  return {
    required: suggestedLines.length > 0,
    tone: intent === 'dance'
      ? '以音乐节拍和动作声音为主，不强行添加剧情台词'
      : intent === 'epic_arrival'
        ? '低沉、缓慢、带压迫感'
        : intent === 'action'
          ? '短促、清楚、带呼吸停顿'
          : '自然口语，情绪变化要听得出来',
    speaker: protagonist.label,
    suggestedLines,
  }
}

/**
 * 用户可覆盖字段的白名单（对应场景卡编辑面板真实暴露的输入项）。
 *
 * 为什么必须用白名单，而不是把客户端传来的场景卡直接浅合并：
 * 客户端下发的是**整份**场景卡（`clone(sceneCardRef.current)`），
 * 其中 `event.beats` / `event.opponentAction` / `emotion` / `visual` / `intent` / `sourceText`
 * 都是从剧情文本推导出来的字段，用户无法在面板里编辑。
 * 如果原样合并，就会出现这条隐蔽的失效链路：
 *   用户改了剧情文本 → 服务端按新剧情重算 beats → 又被旧场景卡里的 beats 盖回去
 *   → 动态镜头数、前 3 秒钩子、情绪标注全部按**旧剧情**输出，
 *   而用户在界面上看到的却是新剧情。
 *
 * 所以：只有白名单里的字段允许被覆盖，其余一律以服务端重算结果为准。
 */
const SCENE_OVERRIDE_WHITELIST: Record<string, readonly string[]> = {
  protagonist: ['label', 'gender', 'pronoun', 'name', 'role'],
  event: ['primaryAction', 'movementDirection'],
  setting: ['location', 'time', 'weather'],
  dialogue: ['tone', 'suggestedLines', 'required'],
}

/**
 * 把用户编辑过的场景卡字段合并到服务端重算结果上。
 * 只接受白名单内的字段，推导字段（beats / emotion / visual / intent 等）永不被覆盖。
 */
export function mergeSceneCardOverrides(base: SceneCard, overrides?: Partial<SceneCard> | null): SceneCard {
  if (!overrides || typeof overrides !== 'object') return base
  const merged = { ...base } as Record<string, unknown>
  Object.entries(SCENE_OVERRIDE_WHITELIST).forEach(([section, fields]) => {
    const incoming = (overrides as Record<string, unknown>)[section]
    if (!incoming || typeof incoming !== 'object') return
    const current = { ...(base as unknown as Record<string, Record<string, unknown>>)[section] }
    let changed = false
    fields.forEach((field) => {
      const value = (incoming as Record<string, unknown>)[field]
      if (value === undefined) return
      // 建议台词等数组字段要过滤空值，避免把空行写进提示词。
      if (Array.isArray(value)) {
        const cleaned = value.map((item) => String(item).trim()).filter(Boolean)
        current[field] = cleaned
        changed = true
        return
      }
      current[field] = value
      changed = true
    })
    if (changed) merged[section] = current
  })
  // 代词由性别派生：用户只改了性别时，代词必须跟着变，
  // 否则提示词里会出现「男主……她」这种自相矛盾。
  const protagonist = merged.protagonist as SceneCard['protagonist']
  if (protagonist.gender === 'male') protagonist.pronoun = '他'
  else if (protagonist.gender === 'female') protagonist.pronoun = '她'
  return merged as unknown as SceneCard
}

export function buildSceneCard(sourceText: string, intent: PlotIntentLabel): SceneCard {
  const source = (sourceText || '').trim()
  const protagonist = protagonistFrom(source)
  const setting = settingFrom(source, intent.intent)
  const primaryAction = actionFrom(source, intent.intent, protagonist)
  const event = {
    summary: source || '主角在关键地点完成一个明确的戏剧动作',
    primaryAction,
    movementDirection: directionFrom(source, intent.intent),
    startState: `${protagonist.label}身份、服装、道具和站位在第一帧就明确`,
    endState: intent.intent === 'epic_arrival' ? `${protagonist.label}落地或站稳，面朝现场，保留能量光和风声` : `${protagonist.label}停在一个下一镜可以复现的姿态，保留视线和声音入口`,
    // 事件序列是动态分镜的依据：剧情里有几个动作节拍，就决定需要几个镜头块。
    beats: extractNarrativeEvents(source),
    // 对手的负面动作要在前 3 秒钩子里直接拍出来（冲突冲击型钩子的核心画面）。
    opponentAction: extractOpponentAction(source)[0] || '',
  }
  const effects = [
    /光柱|法阵|雷霆|神力|魔法|能量/.test(source) ? '光柱、符文或能量粒子' : '',
    /雨|水|雾|烟|尘|火|爆炸/.test(source) ? '与环境匹配的雨、水雾、烟尘或火花' : '',
    intent.intent === 'action' ? '动作产生可见的受击反馈和短暂运动拖影' : '',
  ].filter(Boolean)
  // 道具分两类：
  // - symbols 是承担叙事重量的视觉符号（项链、婚戒、化验单），需要在关键镜头重复出现；
  // - props 是普通场景道具。
  // 旧实现把两者混成一个平铺列表，符号叙事的能力完全丢失。
  const visualSymbols = extractVisualSymbols(source)
  const plainProps = (source.match(/刀|剑|枪|扇|伞|酒杯|红酒杯|香槟|酒瓶|花束|杯子|文件|文件夹|书|笔|茶杯|咖啡杯|公文包|行李箱/g) || [])
    .filter((item) => !visualSymbols.includes(item))
  const props = Array.from(new Set([...visualSymbols, ...plainProps]))
  const opponents = extractOpponentAction(source)
  // 参与人物：优先用解析出的对手角色，比旧的单一正则（只认男友/女友/丈夫…）覆盖面更广。
  const participants = [
    ...opponents,
    ...(intent.intent === 'epic_arrival' ? ['远处群众或见证者'] : []),
  ]
  const shotSizes = intent.intent === 'epic_arrival' ? ['远景', '中景', '近景 / 特写'] : intent.intent === 'dance' ? ['中远景', '中景', '中近景'] : ['远景', '中景', '近景']
  // 情绪曲线：优先从剧情推导（这是红果爆款的核心——情绪节拍），推不出来才退回意图模板。
  const inferredEmotion = inferEmotion(source)
  return {
    version: '1.0',
    sourceText: source,
    intent: { type: intent.intent, label: intent.label, confidence: intent.confidence, evidence: intent.matchedKeywords },
    protagonist,
    participants: participants.length ? Array.from(new Set(participants)) : ['未指定配角'],
    setting,
    event,
    emotion: inferredEmotion || {
      start: intent.intent === 'epic_arrival' ? '现场原本平静或混乱，众人没有准备' : '从输入剧情的初始情绪开始',
      peak: intent.intent === 'epic_arrival' ? '降临、对视或台词造成威严爆点' : intent.intent === 'action' ? '攻击命中、躲闪或局势反转' : '关键动作或信息揭示达到情绪最高点',
      end: '停在明确姿态、视线方向和声音出口上，供下一段承接',
    },
    dialogue: dialogueFrom(source, intent.intent, protagonist),
    visual: {
      effects,
      props,
      // 视觉符号单独记录，供规划器在关键镜头重复调用。
      styleHints: [
        '9:16 竖屏',
        '红果短剧节奏',
        '动作使用大白话空间指令',
        '人物脸部、手部和脚部保持清楚',
        ...(visualSymbols.length ? [`视觉符号需在关键镜头重复出现：${visualSymbols.join('、')}`] : []),
      ],
    },
    camera: {
      recommendedShotSizes: shotSizes,
      recommendedMovements: intent.recommendedMovements,
      firstShotGoal: intent.intent === 'epic_arrival' ? '先用远景让观众看清大场面和人物出现位置' : '在前 0.5-1 秒交代人物、地点和正在发生的事件',
      lastFrameGoal: event.endState,
    },
    continuity: {
      mustLock: ['主角姓名、性别、身份和代词', '发型、服装、配饰和道具', '站位、朝向、手脚位置', '光线方向、环境声和尾帧姿态'],
      forbiddenDefaults: intent.forbiddenDefaults,
    },
    notes: ['每个镜头严格 10 秒', '一段只推进一个主要事件', '所有前行动作明确写成正常向前，不倒退、不倒放', '高级形容词后面必须跟可拍摄的具体画面'],
  }
}
