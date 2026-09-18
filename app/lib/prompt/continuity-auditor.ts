import { DEFAULT_DURATION_MODE_ID, formatRange, formatTimeCode, getDurationMode, mentionsDuration, mentionsTimeline, type DurationMode } from './duration-modes'

export type ContinuityShot = {
  id: string
  title: string
  shotSize?: string
  movement: string
  prompt: string
  transition: string
  audit: string
}

export type ContinuityLead = {
  label: string
  pronoun: string
  possessive: string
}

export type ContinuityIssue = {
  code: string
  severity: 'error' | 'warning'
  shotId: string
  message: string
  repair: string
}

export type ContinuityAuditReport = {
  passed: boolean
  score: number
  issues: ContinuityIssue[]
  checkedRules: string[]
}

/**
 * 默认镜头数：3 个 10 秒镜头（30 秒）。
 * 红果爆款常用 5-8 个画面承载一段冲突，所以镜头数改为可配置，
 * 由剧情节拍数量决定。这里保留 3 作为默认值以维持向后兼容。
 */
export const DEFAULT_SHOT_COUNT = 3
/**
 * 单段剧情的镜头数上限，避免剧情过碎导致每镜信息量不足。
 * 6 秒模式的镜头数按 10/6 放大，所以上限要能容纳更碎的分镜。
 */
export const MAX_SHOT_COUNT = 12

/**
 * 按数量生成镜头编号：S01、S02、……、S08。
 * 编号必须补零对齐，否则字符串排序会出现 S10 排在 S2 前面的问题。
 */
export function buildShotIds(count: number = DEFAULT_SHOT_COUNT): string[] {
  const safeCount = Math.max(1, Math.min(MAX_SHOT_COUNT, Math.floor(count) || DEFAULT_SHOT_COUNT))
  return Array.from({ length: safeCount }, (_, index) => `S${String(index + 1).padStart(2, '0')}`)
}

/** 默认的 3 镜编号，保留给仍按固定 3 镜工作的调用方。 */
export const EXPECTED_SHOT_IDS: readonly string[] = buildShotIds(DEFAULT_SHOT_COUNT)
export type ExpectedShotId = string

/**
 * 审核规则清单按模式生成：免承接模式（6 秒）不该再检查「上一镜尾帧承接」，
 * 否则每一镜都会被判成缺承接，审核分永远上不去。
 */
function requiredRulesFor(mode: DurationMode): string[] {
  return [
    '镜头编号连续',
    `每段严格 ${mode.seconds} 秒`,
    '主角身份和代词一致',
    '景别明确',
    '转场明确',
    ...(mode.chained ? ['上一镜尾帧承接'] : []),
    '动作方向可执行',
    '时间轴可执行',
    '未添加用户未要求的动作',
  ]
}

const NEGATION_WORDS = '不|禁止|严禁|杜绝|避免|不可|不得|无|没有|防止|切勿|不要|别'
/**
 * 正向动作声明：说明这一镜已经明确写成“正常向前”。
 */
const FORWARD_MOTION_ASSERTION = /正常向前|向前走|向前跑|向前移动|面朝前方/
const REVERSE_MOTION_WORDS = /倒退|倒放|反向行走|反向滑行|倒退行走|倒退移动/

/**
 * 判断一个分句是否处于否定语境（例如「不倒退」「禁止穿模、倒放」）。
 *
 * 中文列举习惯用顿号：「禁止穿模、倒放、肢体扭曲」里否定词只在串首。
 * 所以必须按分句（逗号/句号/换行切分）整体判断，而不是要求否定词紧邻目标词，
 * 否则会把合法的并列禁止项误判成本镜真的要执行该动作。
 */
function clauseIsNegated(clause: string) {
  const trimmed = clause.trim()
  if (!trimmed) return false
  // 分句以否定词开头 ⇒ 整句都是禁止语境，管辖顿号并列的全部项目。
  return new RegExp(`^(?:${NEGATION_WORDS})`).test(trimmed)
}

/**
 * 判断片段是否真的存在倒退/倒放风险。
 *
 * 关键点：把「禁止倒退」「不倒退」「无倒放」「禁止穿模、倒放、肢体扭曲」这类
 * 禁止声明视为合规，而不是命中违规。整个分句（逗号/句号/换行切分）以否定词开头时，
 * 该分句内出现的倒退类词都属于被禁止项，不是动作本身。
 */
export function hasReverseMotionRisk(text: string) {
  if (!text) return false

  const clauses = text
    .split(/[\n，。；;]+/)
    .map((clause) => clause.trim())
    .filter(Boolean)

  // 只看那些“真的提到倒退类词”的分句。
  const risky = clauses.filter((clause) => REVERSE_MOTION_WORDS.test(clause))
  if (!risky.length) return false

  // 全部处于否定语境 ⇒ 无风险（这一镜在明确禁止该动作）。
  if (risky.every((clause) => clauseIsNegated(clause))) return false

  // 存在肯定性描述的分句时，若同段落声明了“正常向前”，视为已对冲，放行。
  if (FORWARD_MOTION_ASSERTION.test(text)) return false

  return true
}

const femaleWords = /女主|女生|女孩|女人|妻子/
const maleWords = /男主|男生|男孩|男人|丈夫/

/**
 * 判断文本里是否出现了“主角本人”的指称。
 * 必须把代词算进来：镜头里常常只写“她向男主走近”，并不会重复写“女主”这个词。
 * 只看角色名词表会把这种正常句子误判成主角缺失。
 */
function mentionsLead(text: string, label: string) {
  if (label === '女主') return /女主|女生|女孩|女人|妻子|她/.test(text)
  if (label === '男主') return /男主|男生|男孩|男人|丈夫|他/.test(text)
  return true
}

/**
 * 角色漂移检测。
 *
 * 关键：必须区分“主角性别写错”和“剧情里本来就有对手配角”。
 * 例如主角是女主、文本写“她向男主走近”，这是正常的对手角色，不是漂移；
 * 只有当镜头里出现了异性称呼，却完全没有出现主角自己的指称时，才判定为主角被写错。
 */
function identityIssues(shot: ContinuityShot, lead: ContinuityLead) {
  const issues: ContinuityIssue[] = []
  const text = [shot.title, shot.prompt, shot.audit].filter(Boolean).join('\n')
  if (!text) return issues

  const oppositeWords = lead.label === '女主' ? maleWords : lead.label === '男主' ? femaleWords : null
  const oppositePronoun = lead.label === '女主'
    ? /(?<!其)他(?=[，。；：、！？\s])|他的/
    : lead.label === '男主'
      ? /(?<!其)她(?=[，。；：、！？\s])|她的/
      : null

  // 场景里已有主角指称（含代词），且也出现对手角色 → 属于正常配角，不算漂移。
  const leadPresent = mentionsLead(text, lead.label)
  const opponentPresent = oppositeWords ? oppositeWords.test(text) : false
  const opponentIsIntentional = leadPresent && opponentPresent

  if (oppositeWords && opponentPresent && !opponentIsIntentional) {
    issues.push({
      code: 'gender-drift',
      severity: 'error',
      shotId: shot.id,
      message: `镜头里只有${lead.label === '女主' ? '男主' : '女主'}指称，没有出现主角“${lead.label}”。`,
      repair: `把主角称呼改回${lead.label}；如果剧情确实有对手角色，请同时写出${lead.label}本人的指称。`,
    })
  }

  if (oppositePronoun && oppositePronoun.test(text) && !opponentIsIntentional) {
    issues.push({
      code: 'pronoun-drift',
      severity: 'error',
      shotId: shot.id,
      message: `镜头中出现与${lead.label}不匹配的代词。`,
      repair: `代词统一为“${lead.pronoun}”和“${lead.possessive}”。`,
    })
  }

  return issues
}

/**
 * 代词与角色称呼归一化。
 *
 * 三条必须同时满足的规则：
 * 1. “男主角 / 男主人”不是“男主”指代，必须保护，否则会被替换成“女主角”。
 * 2. 介词后的对手角色不能替换成主角，否则会出现“女主向她走近”这种自指矛盾。
 * 3. 代词只在它确实指代主角时才替换，指代对手的代词要保留。
 */
/**
 * 代词与角色称呼归一化。
 *
 * 设计原则：
 * - “男主角 / 男主人”不是“男主”指代，必须保护。
 * - 当文本里同时存在主角和另一个异性角色时（例如“她向男主走近”），
 *   那个角色是对手配角，不能替换成主角，否则会出现“女主向她走近”这种自指矛盾。
 * - 只有当文本里根本没有对手角色时，异性称呼才按“主角漂移”归一化。
 */
export function normalizeLeadIdentity(text: string, lead: ContinuityLead) {
  if (!text) return text
  const source_ = text
  const protect = (source: string) => source
    .replace(/男主角/g, '\u0001')
    .replace(/男主人/g, '\u0002')
    .replace(/女主角/g, '\u0003')
    .replace(/女主人/g, '\u0004')
  const restore = (source: string) => source
    .replace(/\u0001/g, '男主角')
    .replace(/\u0002/g, '男主人')
    .replace(/\u0003/g, '女主角')
    .replace(/\u0004/g, '女主人')

  if (lead.label === '女主') {
    const body = protect(source_)
    // 文本里出现主角本人指称（含代词），说明另一个“男主”是对手配角，整体保留。
    const hasOpponent = /男主|男生|男孩|男人|丈夫/.test(body) && mentionsLead(body, '女主')
    const withLead = hasOpponent
      ? body
      : body.replace(/男主|男生|男孩|男人|丈夫/g, '女主')
    return restore(
      withLead
        .replace(/他的/g, '她的')
        .replace(/(?<!其)他(?=[，。；：、！？\s])/g, '她'),
    )
  }
  if (lead.label === '男主') {
    const body = protect(source_)
    const hasOpponent = /女主|女生|女孩|女人|妻子/.test(body) && mentionsLead(body, '男主')
    const withLead = hasOpponent
      ? body
      : body.replace(/女主|女生|女孩|女人|妻子/g, '男主')
    return restore(
      withLead
        .replace(/她的/g, '他的')
        .replace(/(?<!其)她(?=[，。；：、！？\s])/g, '他'),
    )
  }
  return source_
}

function hasTimeline(text: string, mode: DurationMode) {
  return mentionsTimeline(text, mode)
}

function hasExpectedDuration(text: string, mode: DurationMode) {
  return mentionsDuration(text, mode)
}

function hasIncomingAnchor(text: string, previousId: string | null) {
  if (!previousId) return true
  return new RegExp(`${previousId}\\s*(?:最后)?(?:尾帧|一帧)|承接\\s*${previousId}|严格承接|上一镜`).test(text)
}

/**
 * 剥离“负面约束”那一行再检查正文。
 *
 * 必要性：禁止项自身会在负面约束里出现（例如“不要舞蹈”）。
 * 如果不剥离，就会把“声明禁止”误判成“真的出现了”。
 */
export function stripNegativeSection(text: string) {
  if (!text) return ''
  return text
    .split('\n')
    .filter((line) => !/^\s*(负面约束|禁止项|禁忌)\s*[:：]/.test(line))
    .join('\n')
}

/**
 * 判断某段正文里是否真的“正面描述了”这个禁项。
 *
 * 关键点：正文里合法存在「不倒退、不倒放」「避免跳舞」这类否定句，
 * 它们是防退化断言，不是违规动作。直接 body.includes(keyword) 会把它们全部误报。
 * 这里按分句粒度检查：只要该词所在分句处于否定语境，就视为合规。
 */
function assertsForbidden(text: string, keyword: string) {
  const clauses = text
    .split(/[\n，。；;、！？!?]+/)
    .map((clause) => clause.trim())
    .filter(Boolean)

  return clauses.some((clause) => {
    if (!clause.includes(keyword)) return false
    // 分句以否定词开头 ⇒ 整句在禁止该动作，不是在执行它。
    if (clauseIsNegated(clause)) return false
    // 否定词紧挨在该动作词前面 ⇒ 同样是禁止语境。
    const head = clause.split(keyword)[0]
    if (new RegExp(`(?:${NEGATION_WORDS})\\s*(?:要|再|能|可以|得|需|必)?\\s*$`).test(head)) return false
    return true
  })
}

/**
 * 检查镜头正文是否违反了“禁止默认项”。
 *
 * 这是硬性业务规则的最后一道防线：
 * 用户没提舞蹈时，正文里就绝不允许出现跳舞/街舞/耍帅。
 * 之前只把这些词写进负面约束，属于被动提示，模型可以无视；必须在审核层主动拦截。
 */
function forbiddenDefaultIssues(shot: ContinuityShot, forbidden: string[]) {
  const issues: ContinuityIssue[] = []
  const body = stripNegativeSection(shot.prompt)
  if (!body) return issues

  forbidden.forEach((item) => {
    // 只对具体动作类禁项做正文拦截，抽象禁项（如“无关舞蹈动作”）交给负面约束。
    const keyword = item.replace(/^(不要|禁止|无|不)/, '').trim()
    if (!keyword || keyword.length > 6) return
    if (!assertsForbidden(body, keyword)) return
    issues.push({
      code: 'forbidden-default',
      severity: 'error',
      shotId: shot.id,
      message: `正文出现了用户未要求的「${keyword}」。`,
      repair: `删除正文中的「${keyword}」，只保留在负面约束里。`,
    })
  })
  return issues
}

/**
 * 审核镜头连续性。
 *
 * shotIds 决定本次审核期望的镜头编号序列。不传则按 shots 实际数量推导，
 * 这样 3 镜、5 镜、8 镜的剧情都能走同一套审核逻辑。
 */
export function auditContinuity(
  shots: ContinuityShot[],
  lead: ContinuityLead,
  forbiddenDefaults: string[] = [],
  shotIds: string[] = buildShotIds(shots.length || DEFAULT_SHOT_COUNT),
  mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID),
): ContinuityAuditReport {
  const issues: ContinuityIssue[] = []
  const expected = shotIds.length ? shotIds : buildShotIds(shots.length || DEFAULT_SHOT_COUNT)

  expected.forEach((id, index) => {
    const shot = shots[index]
    if (!shot) {
      issues.push({ code: 'missing-shot', severity: 'error', shotId: id, message: `缺少 ${id} 镜头块。`, repair: `补齐一个严格 ${mode.seconds} 秒的镜头块。` })
      return
    }
    if (shot.id !== id) {
      issues.push({ code: 'shot-order', severity: 'error', shotId: shot.id, message: `镜头顺序应为 ${id}，当前为 ${shot.id}。`, repair: `将编号修正为 ${id}。` })
    }
    if (!shot.shotSize?.trim()) {
      issues.push({ code: 'missing-shot-size', severity: 'warning', shotId: shot.id, message: '没有明确景别。', repair: '补充远景、中景、近景或特写等具体景别。' })
    }
    if (!shot.transition?.trim()) {
      issues.push({ code: 'missing-transition', severity: 'warning', shotId: shot.id, message: '没有明确转场。', repair: '补充动作匹配切和声音桥接。' })
    }
    if (!hasExpectedDuration(shot.prompt, mode)) {
      issues.push({ code: 'duration', severity: 'warning', shotId: shot.id, message: `提示词没有明确 ${mode.seconds} 秒时长。`, repair: `在镜头开头补充“严格 ${mode.seconds} 秒”。` })
    }
    if (!hasTimeline(shot.prompt, mode)) {
      issues.push({ code: 'timeline', severity: 'warning', shotId: shot.id, message: '缺少可执行的时间轴。', repair: `补充从 0:00 开始、到 0:${String(mode.seconds).padStart(2, '0')} 结束的时间分段。` })
    }
    if (hasReverseMotionRisk(shot.prompt) || hasReverseMotionRisk(shot.audit)) {
      issues.push({ code: 'reverse-motion', severity: 'error', shotId: shot.id, message: '动作包含倒退、倒放或反向移动风险。', repair: '明确改为正常向前，禁止倒退和倒放。' })
    }
    issues.push(...identityIssues(shot, lead))
    issues.push(...forbiddenDefaultIssues(shot, forbiddenDefaults))

    const previousId = index > 0 ? expected[index - 1] : null
    const anchorText = `${shot.prompt}\n${shot.audit}\n${shot.title}`
    // 免承接模式（6 秒）不检查尾帧承接：用户后期硬切衔接，本来就不该写承接。
    if (mode.chained && !hasIncomingAnchor(anchorText, previousId) && index > 0) {
      issues.push({ code: 'missing-anchor', severity: 'error', shotId: shot.id, message: `没有明确承接 ${previousId} 的尾帧状态。`, repair: `补充“严格承接 ${previousId} 最后一帧”。` })
    }
  })

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.length - errorCount
  return {
    passed: issues.length === 0,
    score: Math.max(0, 100 - errorCount * 18 - warningCount * 5),
    issues,
    checkedRules: requiredRulesFor(mode),
  }
}

function buildPlaceholderShot(index: number, lead: ContinuityLead, shotIds: string[], mode: DurationMode): ContinuityShot {
  const id = shotIds[index] as string
  const previousId = index === 0 ? null : shotIds[index - 1]
  const anchor = mode.chained && previousId ? `严格承接 ${previousId} 最后一帧：保持人物站位、朝向、服装、道具和光线一致。` : ''
  const lastCode = formatTimeCode(mode.seconds)
  return {
    id,
    // 占位镜头的标题也必须可执行，不能写“待补充动作”——该字段会进到成片提示词里。
    title: `${lead.label}连续镜头：完成一个明确动作`,
    shotSize: '中景',
    movement: '稳定跟拍',
    prompt: `严格 ${mode.seconds} 秒。0:00-0:02：${lead.label}入画并起势。${anchor}${lead.label}继续完成当前剧情动作，面朝前方，以左脚或右脚先迈正常向前移动，不倒退、不倒放。0:0${Math.max(2, mode.seconds - 2)}-${lastCode}：停在动作的自然落点。`,
    transition: '动作匹配切 → 声音桥接',
    audit: '自动补齐的连续镜头占位，请根据场景卡补写具体动作。',
  }
}

/**
 * 修正器。核心原则：修正后必须能真正消除问题，
 * 因此景别、转场、时长、时间轴、承接锚点都要补齐，而不是只补一部分。
 */
export function repairContinuity(
  shots: ContinuityShot[],
  report: ContinuityAuditReport,
  lead: ContinuityLead,
  forbiddenDefaults: string[] = [],
  shotIds: string[] = buildShotIds(shots.length || DEFAULT_SHOT_COUNT),
  mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID),
): ContinuityShot[] {
  const expected = shotIds.length ? shotIds : buildShotIds(shots.length || DEFAULT_SHOT_COUNT)
  const sourceShots = shots.slice(0, expected.length)
  while (sourceShots.length < expected.length) {
    sourceShots.push(buildPlaceholderShot(sourceShots.length, lead, expected, mode))
  }

  return sourceShots.map((shot, index) => {
    const id = expected[index] as string
    const previousId = index === 0 ? null : expected[index - 1]
    // 关键修复：修正器只归一化代词与角色称呼，不再改写动作方向描述。
    // 旧实现直接调用 repairIdentity，会把“向男主走近”改成“向女主走近”，制造新的语义错误。
    let prompt = normalizeLeadIdentity(shot.prompt, lead)
    let title = normalizeLeadIdentity(shot.title, lead)
    let audit = normalizeLeadIdentity(shot.audit, lead)
    const issues = report.issues.filter((issue) => issue.shotId === shot.id || issue.shotId === id)

    if (!hasExpectedDuration(prompt, mode)) prompt = `严格 ${mode.seconds} 秒。${prompt}`
    if (!hasTimeline(prompt, mode)) {
      prompt = `${formatRange(0, 2)}：${lead.label}入画并起势。${prompt}`
    }
    // 免承接模式不补承接句：用户后期硬切，补了反而会让镜头结尾变成等待姿态。
    if (mode.chained && !hasIncomingAnchor(prompt, previousId) && previousId) {
      prompt = `严格承接 ${previousId} 最后一帧：保持人物站位、朝向、服装、道具和光线一致。${prompt}`
    }
    if (hasReverseMotionRisk(prompt)) {
      prompt = `${prompt} 动作改为正常向前，身体重心向前，禁止倒退、倒放和反向滑行。`
    }
    // 把违规禁项从正文剔除，只在负面约束里保留声明。
    // 注意两个坑：
    // 1) 不能只改最后一行——违规词通常出现在中间的叙述句里；
    // 2) 不能无差别 split(keyword).join('')——会把「不倒退」这种合法否定句也破坏掉。
    //    这里按分句粒度删除，且只删除“正面描述该动作”的分句。
    if (issues.some((issue) => issue.code === 'forbidden-default')) {
      const keywords = forbiddenDefaults
        .map((item) => item.replace(/^(不要|禁止|无|不)/, '').trim())
        .filter((keyword) => keyword.length > 0 && keyword.length <= 6)

      prompt = prompt
        .split('\n')
        .map((line) => {
          // 负面约束行整体保留，交由 compiler 统一加「不要」前缀。
          if (/^\s*(负面约束|禁止项|禁忌)\s*[:：]/.test(line)) return line
          return line
            .split(/(?<=[，。；;、！？!?])/)
            .filter((clause) => {
              const hit = keywords.find((keyword) => clause.includes(keyword))
              if (!hit) return true
              // 否定语境的分句保留，只删掉真正在描述该动作的分句。
              return !assertsForbidden(clause, hit)
            })
            .join('')
        })
        .join('\n')
    }

    const repairedCodes: string[] = []
    if (issues.some((issue) => issue.code === 'gender-drift' || issue.code === 'pronoun-drift')) {
      repairedCodes.push('已把角色称呼和代词统一到主角锚点')
    }
    if (issues.some((issue) => issue.code === 'reverse-motion')) {
      repairedCodes.push('已补充正常向前、不倒退、不倒放')
    }
    if (issues.some((issue) => issue.code === 'forbidden-default')) {
      repairedCodes.push('已从正文移除用户未要求的动作')
    }
    if (issues.some((issue) => issue.code === 'missing-anchor')) {
      repairedCodes.push(`已补充承接 ${previousId} 尾帧`)
    }
    if (issues.some((issue) => issue.code === 'missing-shot-size')) repairedCodes.push('已补充景别')
    if (issues.some((issue) => issue.code === 'missing-transition')) repairedCodes.push('已补充转场')
    if (issues.some((issue) => issue.code === 'duration' || issue.code === 'timeline')) repairedCodes.push(`已补充 ${mode.seconds} 秒时长和时间轴`)
    if (repairedCodes.length) audit = `${audit} 连续性修正：${repairedCodes.join('；')}。`

    return {
      ...shot,
      id,
      title,
      shotSize: shot.shotSize?.trim() || '中景',
      movement: shot.movement?.trim() || '稳定跟拍',
      transition: shot.transition?.trim() || '动作匹配切 → 声音桥接',
      prompt,
      audit,
    }
  })
}

export function auditAndRepairContinuity(
  shots: ContinuityShot[],
  lead: ContinuityLead,
  forbiddenDefaults: string[] = [],
  shotIds: string[] = buildShotIds(shots.length || DEFAULT_SHOT_COUNT),
  mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID),
) {
  const expected = shotIds.length ? shotIds : buildShotIds(shots.length || DEFAULT_SHOT_COUNT)
  const before = auditContinuity(shots, lead, forbiddenDefaults, expected, mode)
  // 只要有问题（含 warning）就跑一轮修正，否则“已自动修正”永远对不上真实结果。
  const repairedShots = before.issues.length ? repairContinuity(shots, before, lead, forbiddenDefaults, expected, mode) : shots
  const after = auditContinuity(repairedShots, lead, forbiddenDefaults, expected, mode)
  return { before, after, repairedShots }
}
