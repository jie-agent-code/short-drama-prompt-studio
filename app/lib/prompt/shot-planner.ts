import type { SceneCard } from './scene-card'
import { planFromNarrativeBeats, decideShotCount, ROLE_LABELS } from './narrative-planner'
import { buildShotIds } from './continuity-auditor'
import { DEFAULT_DURATION_MODE_ID, formatRange, getDurationMode, type DurationMode } from './duration-modes'
import {
  allocateExtraShots,
  buildCoverageShot,
  pickCoverageSpecs,
  type CoverageContext,
  type CoverageRole,
  type CoverageSpec,
} from './beat-coverage'

export type PlannedShot = {
  id: string
  /** 本镜秒数，由时长模式决定（10 秒或 6 秒）。 */
  durationSeconds: number
  title: string
  shotSize: string
  objective: string
  timeBlocks: string[]
  movement: string
  transition: string
  incomingAnchor: string
  outgoingAnchor: string
  actionDirection: string
  dialogueCue: string
  visualFocus: string
}

function selectedMovement(scene: SceneCard, selected: string[], index: number) {
  return selected[index] || scene.camera.recommendedMovements[index] || scene.camera.recommendedMovements[0] || '稳定跟拍'
}

function buildIntentTemplates(scene: SceneCard, movements: string[]): PlannedShot[] {
  const protagonist = scene.protagonist.label
  const direction = scene.event.movementDirection
  const endState = scene.event.endState
  const base = {
    incomingAnchor: `${protagonist}的身份、服装、道具、光线和空间位置保持一致`,
    actionDirection: direction,
  }

  switch (scene.intent.type) {
    case 'epic_arrival':
      return [
        { ...base, id: 'S01', durationSeconds: 10, title: '大场面建立：神性降临', shotSize: '远景', objective: '在开头建立大空间，并让主角以清楚的视觉动作出现', timeBlocks: ['0:00-0:02：超广角远景，先看清场地和天空变化', '0:02-0:06：光源打开，主角从高处或光柱中出现', '0:06-0:10：主角落地，冲击波扩散，停住供承接'], movement: `${selectedMovement(scene, movements, 0)} + 低机位前推`, transition: '闪白或能量爆发 → 远景建立切', outgoingAnchor: `${protagonist}双脚落地，面朝现场，衣摆和能量光仍在运动`, dialogueCue: '可不说话，或在最后 2 秒留一句低沉威严台词', visualFocus: '光柱、粒子、地面冲击波和人物完整轮廓' },
        { ...base, id: 'S02', durationSeconds: 10, title: '余波推进：众人看见降临者', shotSize: '中景', objective: '用人物关系和反应证明刚才的降临不是普通出场', timeBlocks: ['0:00-0:01：保持 S01 尾帧不动', '0:01-0:05：过肩反打或平稳跟拍，展示见证者后退、跪下或抬头', '0:05-0:09：横移回到主角，主角向前正常走一步', '0:09-0:10：停在脚落地和视线方向上'], movement: `${selectedMovement(scene, movements, 1)} + 过肩反打`, transition: '动作匹配切 → 群众声音桥接', outgoingAnchor: `${protagonist}右脚或左脚落地，身体朝向下一镜要去的方向，环境声不断`, dialogueCue: '见证者低声惊叹或主角说一句短台词', visualFocus: '主角与见证者的大小关系、视线关系和空间距离' },
        { ...base, id: 'S03', durationSeconds: 10, title: '威严定锚：台词与力量揭示', shotSize: '近景 / 特写', objective: '用面部、台词和一次明确的力量动作完成本段高潮', timeBlocks: ['0:00-0:02：承接中景，主角抬眼或抬手', '0:02-0:05：低机位推进到近景，完成台词和口型', '0:05-0:07：只做一次克制的倾斜、环绕或变焦', '0:07-0:10：后拉揭示更大环境，停在可复现姿态'], movement: `${selectedMovement(scene, movements, 2)} + 后拉揭示`, transition: '低频轰鸣桥接 → 后拉揭示', outgoingAnchor: endState, dialogueCue: scene.dialogue.suggestedLines[0] ? `由${protagonist}说：“${scene.dialogue.suggestedLines[0]}”` : '保留风声、轰鸣或脚步声作为下一段入口', visualFocus: '眼神、口型、手部动作、能量源和尾帧姿态' },
      ]
    case 'action':
      return [
        { ...base, id: 'S01', durationSeconds: 10, title: '冲突建立：双方进入攻击距离', shotSize: '中远景', objective: '交代双方站位和攻击方向，不急着堆特效', timeBlocks: ['0:00-0:02：远景交代双方距离和掩体', '0:02-0:06：主角向目标正常前进或起手准备', '0:06-0:10：第一次攻击动作停在即将命中的瞬间'], movement: selectedMovement(scene, movements, 0), transition: '硬切 → 动作建立', outgoingAnchor: `${protagonist}保持攻击起势，身体朝向目标，手中道具位置不变`, dialogueCue: '短促警告或呼吸声，不用长台词', visualFocus: '双方距离、武器或手脚起始位置' },
        { ...base, id: 'S02', durationSeconds: 10, title: '动作推进：攻击与躲闪', shotSize: '中景', objective: '完成一轮有因果的攻击、躲闪和受击反馈', timeBlocks: ['0:00-0:02：承接上一镜即将命中的动作', '0:02-0:06：连续两到三次清楚的攻防动作', '0:06-0:08：一次受击、闪开或局势反转', '0:08-0:10：停在下一次攻击的起始姿态'], movement: `${selectedMovement(scene, movements, 1)} + 手持感`, transition: '动作匹配切 → 打击声桥接', outgoingAnchor: `${protagonist}站位、朝向、道具和受击方向明确，保留下一次动作起势`, dialogueCue: '只保留动作间隙的一句短台词', visualFocus: '攻击路径、受击点、运动拖影和脚步落点' },
        { ...base, id: 'S03', durationSeconds: 10, title: '爆点收束：关键一击与出口', shotSize: '近景 / 特写', objective: '用一次关键动作完成小高潮，并留下下一镜可接的结果', timeBlocks: ['0:00-0:03：近景捕捉关键动作起手', '0:03-0:06：子弹时间或短暂慢动作展示命中细节', '0:06-0:08：受击反馈、碎片或烟尘扩散', '0:08-0:10：拉远或停格，交代结果和危险是否结束'], movement: `${selectedMovement(scene, movements, 2)} + 子弹时间运镜`, transition: '打击特写 → 低频声音延续', outgoingAnchor: endState, dialogueCue: '关键一击后说一句短台词，口型和停顿清楚', visualFocus: '手部、武器、受击点、碎片和人物表情' },
      ]
    case 'chase':
      return [
        { ...base, id: 'S01', durationSeconds: 10, title: '追逐建立：主角开始向前跑', shotSize: '中远景', objective: '交代追逐方向、前后关系和道路障碍', timeBlocks: ['0:00-0:02：远景看清主角和追赶者位置', '0:02-0:07：主角面朝前方正常向前跑，右脚或左脚先迈写清', '0:07-0:10：镜头跟到障碍物前，主角准备改变路线'], movement: selectedMovement(scene, movements, 0), transition: '动作切 → 脚步声接入', outgoingAnchor: `${protagonist}面朝前方，正在接近明确障碍物，不倒退、不倒放`, dialogueCue: '奔跑中的呼喊或喘息，台词短而清楚', visualFocus: '前进方向、脚步、障碍物和双方距离' },
        { ...base, id: 'S02', durationSeconds: 10, title: '空间穿行：追逐关系拉近', shotSize: '中景', objective: '让主角穿过一个具体空间，并展示距离变化', timeBlocks: ['0:00-0:02：承接障碍物前的姿态', '0:02-0:06：穿过门、巷口、人群或狭窄空间', '0:06-0:09：回头一次确认追赶者距离', '0:09-0:10：重新面朝前方停在下一段入口'], movement: `${selectedMovement(scene, movements, 1)} + Fly Through 穿越运镜`, transition: '脚步声桥接 → 空间穿越切', outgoingAnchor: `${protagonist}重新面朝前方，双脚和手的位置稳定，追赶声从后方传来`, dialogueCue: '回头时只说一句警告或求救', visualFocus: '门框、墙面、人群等穿越前景和空间纵深' },
        { ...base, id: 'S03', durationSeconds: 10, title: '追逐爆点：拦截或暂时脱身', shotSize: '近景 / 中景', objective: '完成一次拦截、躲藏或脱身，并留下新的目标', timeBlocks: ['0:00-0:03：主角到达终点或藏身位置', '0:03-0:06：追赶者进入画面，双方距离突然缩短', '0:06-0:08：主角躲开、关门或反向制造障碍', '0:08-0:10：停在主角看向下一出口的视线'], movement: `${selectedMovement(scene, movements, 2)} + 后拉揭示 Dolly Out`, transition: '急促脚步 → 突然安静', outgoingAnchor: endState, dialogueCue: '用喘息、低声计划或一句悬念台词结束', visualFocus: '距离变化、遮挡关系和下一出口' },
      ]
    case 'dance':
      return [
        { ...base, id: 'S01', durationSeconds: 10, title: '表演建立：舞者进入节拍', shotSize: '中远景', objective: '先让观众看清人物全身和完整舞台空间', timeBlocks: ['0:00-0:02：全身中远景，音乐第一拍进入', '0:02-0:07：按顺序完成脚步、肩部和手臂动作', '0:07-0:10：停在一个清楚的起势或指向姿态'], movement: selectedMovement(scene, movements, 0), transition: '音乐起 → 动作切', outgoingAnchor: `${protagonist}全身入镜，停在下一组舞步的起始姿态`, dialogueCue: '不强行添加台词，以音乐和脚步为主', visualFocus: '全身动作、脚步落点和节拍' },
        { ...base, id: 'S02', durationSeconds: 10, title: '表演推进：舞步与镜头环绕', shotSize: '中景', objective: '在不丢失动作方向的前提下增加镜头变化', timeBlocks: ['0:00-0:01：保持上一镜尾帧', '0:01-0:06：完成第二组舞步，写清哪只脚先动', '0:06-0:09：镜头环绕或平移，展示服装和手臂线条', '0:09-0:10：停在转身后的正面或侧面姿态'], movement: `${selectedMovement(scene, movements, 1)} + 环绕运镜`, transition: '动作匹配切 → 音乐连续', outgoingAnchor: `${protagonist}完成转身，面朝固定方向，双脚站稳`, dialogueCue: '保持音乐，不添加剧情台词', visualFocus: '身体方向、手脚顺序、衣摆和灯光反射' },
        { ...base, id: 'S03', durationSeconds: 10, title: '表演高潮：定格与环境揭示', shotSize: '中近景', objective: '用一个明确高潮动作收尾，不把舞蹈延伸成无意义重复', timeBlocks: ['0:00-0:03：完成最后一组动作或旋转', '0:03-0:06：短暂慢动作或子弹时间突出高潮姿态', '0:06-0:08：镜头退到中景，露出环境反应', '0:08-0:10：静止定格，保留音乐下一拍入口'], movement: `${selectedMovement(scene, movements, 2)} + 子弹时间运镜`, transition: '音乐重拍 → 定格或动作剪切', outgoingAnchor: endState, dialogueCue: '不添加未要求的对白', visualFocus: '高潮姿态、灯光、观众反应和可复现尾帧' },
      ]
    case 'romance':
      return [
        { ...base, id: 'S01', durationSeconds: 10, title: '关系建立：两人进入同一空间', shotSize: '远景 / 中远景', objective: '交代双方位置、距离和视线关系', timeBlocks: ['0:00-0:02：远景交代两人的空间关系', '0:02-0:06：主角向对方正常靠近或停下', '0:06-0:10：两人第一次明确对视'], movement: selectedMovement(scene, movements, 0), transition: '环境声淡入 → 视线匹配切', outgoingAnchor: '双方保持对视，距离和站位可在下一镜复现', dialogueCue: '第一句台词自然、短暂、留出反应时间', visualFocus: '距离、视线、手部是否靠近' },
        { ...base, id: 'S02', durationSeconds: 10, title: '情绪推进：话语和反应', shotSize: '中景', objective: '用过肩反打和停顿推进关系冲突', timeBlocks: ['0:00-0:01：承接对视', '0:01-0:05：过肩反打完成一方台词', '0:05-0:08：切到另一方近一点的反应', '0:08-0:10：手部动作或轻微靠近停住'], movement: `${selectedMovement(scene, movements, 1)} + 过肩反打`, transition: '视线匹配切 → 声音桥接', outgoingAnchor: '主角面朝对方，手部停在明确位置，情绪没有跳变', dialogueCue: '台词说完后留出至少半秒停顿', visualFocus: '嘴型、眼神、手部和呼吸变化' },
        { ...base, id: 'S03', durationSeconds: 10, title: '情绪出口：靠近、拒绝或离开', shotSize: '近景', objective: '完成一个关系变化，并留下下一段的情绪方向', timeBlocks: ['0:00-0:03：近景捕捉决定前的表情', '0:03-0:06：完成拥抱、推开、牵手或转身中的一个动作', '0:06-0:08：镜头缓慢推进或后拉强调结果', '0:08-0:10：停在视线、手部或离开方向'], movement: `${selectedMovement(scene, movements, 2)} + 缓慢推进`, transition: '情绪台词 → 声音桥接', outgoingAnchor: endState, dialogueCue: scene.dialogue.suggestedLines[0] ? `由${protagonist}说：“${scene.dialogue.suggestedLines[0]}”` : '保留呼吸、脚步或环境声', visualFocus: '表情变化、手部动作和关系距离' },
      ]
    default:
      return [
        { ...base, id: 'S01', durationSeconds: 10, title: '事件建立：主角进入关键状态', shotSize: '远景', objective: '交代地点、人物和事件起点', timeBlocks: ['0:00-0:02：远景建立空间', '0:02-0:07：主角完成一个明确动作', '0:07-0:10：停在关键视线或姿态'], movement: selectedMovement(scene, movements, 0), transition: '淡入 → 建立切', outgoingAnchor: `${protagonist}停在清楚的站位和视线方向`, dialogueCue: '根据剧情需要加入一句自然台词', visualFocus: '人物、环境和事件起点' },
        { ...base, id: 'S02', durationSeconds: 10, title: '事件推进：信息或情绪发生变化', shotSize: '中景', objective: '只推进一个新的信息或情绪节点', timeBlocks: ['0:00-0:01：承接上一镜尾帧', '0:01-0:07：完成关键动作或信息揭示', '0:07-0:10：停在视线和声音出口'], movement: selectedMovement(scene, movements, 1), transition: '动作匹配切 → 声音桥接', outgoingAnchor: `${protagonist}保持道具、站位和朝向一致`, dialogueCue: '台词短、口型清楚、停顿明确', visualFocus: '关键线索、表情和动作结果' },
        { ...base, id: 'S03', durationSeconds: 10, title: '事件爆点：决定与出口', shotSize: '近景', objective: '完成这一小段的爆点，并留下下一段目标', timeBlocks: ['0:00-0:03：近景捕捉反应', '0:03-0:07：完成决定或反转动作', '0:07-0:10：定格或后拉揭示下一段空间'], movement: selectedMovement(scene, movements, 2), transition: '情绪硬切 → 下一段声音入口', outgoingAnchor: endState, dialogueCue: '用一句短台词或明确环境声收尾', visualFocus: '表情、台词、动作结果和尾帧' },
      ]
  }
}

/**
 * 意图模板按比例缩放到目标时长模式。
 *
 * 为什么用缩放而不是给每个模板重写一套时间码：
 * 六个意图模板共有 18 个镜头、几十个时间码。重写一套等于把同一份内容维护两遍，
 * 以后改模板必然漏掉其中一套。缩放只做一次机械换算，永远和模板保持同步。
 */
function rescaleTimeBlocks(blocks: string[], mode: DurationMode): string[] {
  if (mode.seconds === 10) return blocks
  const factor = mode.seconds / 10
  return blocks.map((block) =>
    block.replace(/(\d+):(\d{2})/g, (_, minutes: string, seconds: string) => {
      const total = Number(minutes) * 60 + Number(seconds)
      const scaled = Math.round(total * factor)
      return `${Math.floor(scaled / 60)}:${String(scaled % 60).padStart(2, '0')}`
    }),
  )
}

/** 意图模板兜底路径：模板本身按 10 秒写，再缩放到目标模式。 */
function planForIntent(scene: SceneCard, movements: string[], mode: DurationMode): PlannedShot[] {
  return buildIntentTemplates(scene, movements).map((shot) => ({
    ...shot,
    durationSeconds: mode.seconds,
    timeBlocks: rescaleTimeBlocks(shot.timeBlocks, mode),
    // 免承接模式下模板里的「停住供承接」类锚点会误导模型，
    // 统一换成不依赖下一镜的落点描述。
    outgoingAnchor: mode.chained
      ? shot.outgoingAnchor
      : shot.outgoingAnchor.replace(/供承接|承接下一镜|下一镜可接|供下一段承接/g, '作为本镜收束'),
    incomingAnchor: mode.chained
      ? shot.incomingAnchor
      : shot.incomingAnchor.replace(/保持一致/g, '在本镜第一帧就明确'),
  }))
}

/**
 * 意图模板兜底路径也按模式放大镜头数。
 *
 * 不放大就会出现「10 秒模式 30 秒、6 秒模式 18 秒」的不一致——
 * 用户选 6 秒模式是为了画面更碎更密，不是为了整段变短。
 * 模板没有节拍信息，所以按位置近似情绪角色（首镜铺垫、中间冲突、末镜爽点），
 * 再复用覆盖镜补齐多出来的镜头。
 */
function expandTemplateShots(scene: SceneCard, shots: PlannedShot[], mode: DurationMode, movementAt: (index: number) => string): PlannedShot[] {
  const target = decideShotCount(shots.length, mode)
  const extra = target - shots.length
  if (extra <= 0) return shots

  const roles: CoverageRole[] = shots.map((_, index) => {
    if (index === 0) return 'setup'
    if (index === shots.length - 1) return 'climax'
    return 'conflict'
  })
  const extras = allocateExtraShots(shots.length, extra, roles)
  const protagonist = scene.protagonist.label

  const ids = buildShotIds(target)
  const out: PlannedShot[] = []
  let cursor = 0
  // 覆盖镜类型在整段里轮转，不能每个节拍都从「道具插入镜」重新开始——
  // 那会让一段里出现两个一模一样的道具特写，等于没有切镜。
  let coverageCursor = 0

  shots.forEach((shot, index) => {
    const role = roles[index] as CoverageRole
    out.push({ ...shot, id: ids[cursor] as string })
    cursor += 1

    const ctx: CoverageContext = {
      lead: protagonist,
      opponent: scene.event.opponentAction || '',
      props: scene.visual.props,
      role,
    }
    const specs: CoverageSpec[] = pickCoverageSpecs(extras[index] || 0, ctx, coverageCursor)
    coverageCursor += specs.length
    specs.forEach((spec) => {
      const coverage = buildCoverageShot(spec, ctx)
      out.push({
        id: ids[cursor] as string,
        durationSeconds: mode.seconds,
        title: `${ROLE_LABELS[role]}·${coverage.label}`,
        shotSize: coverage.shotSize,
        objective: `本镜承担「${ROLE_LABELS[role]}」功能：${coverage.core}`,
        timeBlocks: mode.slots.map((slot) => {
          const range = `${formatRange(slot.from, slot.to)}：`
          if (slot.role === 'tail') return range + coverage.tail
          if (slot.role === 'lead') return range + `${protagonist}的姿态与站位与上一镜一致`
          return range + coverage.core
        }),
        movement: movementAt(cursor),
        transition: coverage.transition,
        incomingAnchor: mode.chained
          ? `${protagonist}的身份、服装、道具、光线和空间位置与 ${ids[cursor - 1]} 最后一帧完全一致`
          : `${protagonist}的身份、服装、道具、光线和空间位置在本镜第一帧就明确`,
        outgoingAnchor: mode.chained
          ? `${protagonist}停在可复现的姿态，保留视线、道具位置和环境声`
          : `${protagonist}停在动作的自然落点，不做等待或回望姿态`,
        actionDirection: coverage.actionDirection,
        dialogueCue: '本段不强行添加台词，以动作和环境声为主',
        visualFocus: coverage.visualFocus,
      })
      cursor += 1
    })
  })

  return out
}

export function planSceneToShots(scene: SceneCard, selectedMovements: string[] = [], mode: DurationMode = getDurationMode(DEFAULT_DURATION_MODE_ID)): PlannedShot[] {
  const movementAt = (index: number) => selectedMovement(scene, selectedMovements, index)
  // 优先：按剧情节拍动态分镜。
  // 只有当剧情里真的切出了 ≥2 个动作节拍时才走这条路径，否则退回意图模板。
  // 这是让「用户写的剧情」真正进入成品的入口——旧实现直接 `return planForIntent(...)`，
  // 剧情被压缩成意图标签后就再也不参与规划了。
  const narrative = planFromNarrativeBeats(scene, movementAt, mode)
  if (narrative.length) return narrative
  return expandTemplateShots(scene, planForIntent(scene, selectedMovements, mode), mode, movementAt)
}
