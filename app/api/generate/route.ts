import { NextResponse } from 'next/server'
import { getBailianConfig } from '../../lib/bailian-config'
import { analyzePlotIntent } from '../../lib/prompt/intent-classifier'
import { buildSceneCard, mergeSceneCardOverrides } from '../../lib/prompt/scene-card'
import { planSceneToShots } from '../../lib/prompt/shot-planner'
import { auditAndRepairContinuity, normalizeLeadIdentity } from '../../lib/prompt/continuity-auditor'
import { compilePromptSet } from '../../lib/prompt/prompt-compiler'
import type { SceneCard } from '../../lib/prompt/scene-card'
import type { PlannedShot } from '../../lib/prompt/shot-planner'
import { getStylePreset } from '../../lib/prompt/style-presets'
import { formatTimeCode, getDurationMode, rescaleTimelineText, retimeShotLengthText } from '../../lib/prompt/duration-modes'

type Shot = { id:string; title:string; shotSize?:string; movement:string; prompt:string; transition:string; audit:string }
type Lead = { label:string; pronoun:string; possessive:string }

function inferLead(idea:string): Lead {
  if (/(女主|女生|女孩|女人|妻子|她)/.test(idea)) return { label:'女主', pronoun:'她', possessive:'她的' }
  if (/(男主|男生|男孩|男人|丈夫|他)/.test(idea)) return { label:'男主', pronoun:'他', possessive:'他的' }
  return { label:'主角', pronoun:'主角', possessive:'主角的' }
}

// 本地兜底分支里的角色归一化统一走连续性审核器，
// 避免这里和审核器各维护一套正则、修完又被另一套改回去。
function normalizeGender(text:string, lead:Lead) {
  return normalizeLeadIdentity(text, lead)
}

function normalizeShots(shots:Shot[], lead:Lead):Shot[] {
  return shots.map(shot => ({ ...shot, title:normalizeGender(shot.title, lead), movement:normalizeGender(shot.movement, lead), prompt:normalizeGender(shot.prompt, lead), transition:normalizeGender(shot.transition, lead), audit:normalizeGender(shot.audit, lead) }))
}

function inferIntent(idea:string) {
  return analyzePlotIntent(idea).intent
}

function fallback(idea:string, lead:Lead) {
  const intent = inferIntent(idea)
  const selected = ['跟拍','手持感','焦点转移']
  if (intent === 'epic_arrival') {
    const arrival = `${lead.label}如神明般降临现场`
    return { mode:'local', lead:lead.label, shots: [
      { id:'S01', title:'史诗建立：神圣降临', shotSize:'远景 / Establishing Wide Shot', movement:selected.slice(0,2).join(' · '), prompt:`红果竖屏短剧风格，9:16，10 秒，开场 0.5 秒内给出强视觉钩子。电影级奇幻大制作。剧情核心：${idea}。主角锁定为${lead.label}，不得改成其他性别或人物。废墟广场被乌云笼罩，地面积水反射冷白月光，远处群众作为小比例剪影。0-1 秒：24mm 超广角低机位远景/建立镜头，先让观众看清完整空间关系，风压掀起尘埃与碎布。1-4 秒：云层裂开一道垂直光柱，粒子、灰尘和细小碎石向上漂浮；镜头使用 Crane Down 从高处下降，同时缓慢 Dolly In。4-7 秒：${lead.label}从光柱中心缓慢落地，衣摆和长发被能量气流托起，双脚接触地面时形成一圈可控冲击波，光粒向四周扩散。7-9 秒：镜头沿 180 度环绕至${lead.label}正面中景，${lead.label}抬眼，神情平静而具有压迫感，手中出现微弱金色符文。此时${lead.label}用低沉、从容、带神性压迫感的声音说：“蝼蚁，谁准许你们仰望神明？”要求台词自然口型、停顿清晰、10 秒内说完。9-10 秒：镜头停在${lead.label}正面中景定格，光柱仍在背后，保留风声与低沉轰鸣作为下一镜入口。高对比体积光、真实粒子、史诗尺度，禁止舞蹈动作。`, transition:'闪白 → 远景建立切', audit:`通过：红果式开场钩子明确，远景交代空间，${lead.label}身份、台词和能量光柱尾帧已锁定。` },
      { id:'S02', title:'降临余波：众人反应', shotSize:'中景 / Medium Shot', movement:selected[1] || 'Steadicam Follow', prompt:`严格承接 S01 尾帧：${lead.label}站在光柱中心，衣摆仍被气流吹动，金色符文在右手周围旋转，废墟地面有环形冲击波痕迹。0-1 秒保持${lead.label}正面中景定格。1-4 秒：过肩反打中景从一名群众肩后看向${lead.label}，群众下意识后退，镜头以 Steadicam Follow 平滑向前。群众压低声音说：“是神迹……她真的降临了。”4-7 秒：摄影机横移 Tracking / Truck，逐步揭示更多跪倒或退后的剪影，但不改变主角位置；焦点始终回到${lead.label}。7-9 秒：切回${lead.label}中近景，风压减弱，${lead.label}面朝画面右侧，以右脚先迈、左脚跟上，沿画面右方正常向前走出一步，身体重心向前，不倒退、不反向滑行；符文收束成一道光线。9-10 秒：停在${lead.label}右脚落地、身体朝向右侧的姿态，保留低沉心跳和风声。`, transition:'动作匹配切 → 声音桥接', audit:`通过：中景突出人物与群众关系，台词、主角位置与移动方向均明确。` },
      { id:'S03', title:'力量显现：神明宣告', shotSize:'近景 / Close-up', movement:selected[2] || 'Dolly Out', prompt:`承接 S02：${lead.label}右脚已落地，身体朝向画面右侧，右手金色符文收束。0-2 秒：50mm 中近景，${lead.label}抬起右手，动作从腰侧开始，手掌沿身体前方垂直向上抬至肩上方，空气出现环形波纹，衣摆被能量托起。2-5 秒：镜头低机位 Dolly In 前推至${lead.label}面部近景/特写，眼神从平静转为不可违抗的威严；背景光柱在焦外闪耀。${lead.label}看向镜头，缓慢说：“记住我的名字，凡人。”5-7 秒：使用一次克制的 Dutch Roll 轻微倾斜画面，表现现场秩序被改写，禁止夸张旋转。7-10 秒：镜头 Dolly Out 后拉揭示整座废墟和天空中的巨大光环，从近景退到中远景，${lead.label}保持面朝画面右侧、双脚站稳、右手举起的姿态，成为画面中心的唯一主体，环境轰鸣与风声延续到下一段。`, transition:'低频轰鸣桥接 → 后拉揭示', audit:`通过：近景/特写承载台词和威严表演，结尾后拉揭示大场面。` }
    ] satisfies Shot[] }
  }
  const clothes = '黑色短款夹克、深色直筒长裤、白色球鞋、银色项链'
  const still = `${lead.label}右手指向画面右侧、左脚在前、身体侧向镜头`
  return { mode:'local', lead:lead.label, shots:[
    { id:'S01', title:'动作建立：舞蹈亮相', movement:selected.slice(0,2).join(' · '), prompt:`竖屏 9:16，10 秒，短剧开场。剧情：${idea}。主角锁定为${lead.label}，后续镜头不得改为另一性别或另一人物。夜晚城市广场，湿润地面反射霓虹，背景仅有虚焦路人。${lead.label}穿${clothes}。0-1 秒：35mm 广角中远景，${lead.label}位于画面中央偏左，面向镜头，抬下巴并整理袖口，露出自信、带一点挑衅的表情。1-6 秒：摄影机从侧后方低机位稳定跟拍，${lead.label}完成连续舞步：右脚滑步、肩部律动、转身半圈、右臂甩向镜头；双手五指和双脚清晰，人体结构自然。6-8.5 秒：镜头绕行 45 度到正面中近景，${lead.label}挑眉、打响指。8.5-10 秒：保留轻微手持呼吸感，${lead.label}停在右手指向画外的姿势，静止 0.5 秒。冷蓝轮廓光与暖橙地面反射，真实皮肤和布料质感。`, transition:'黑场淡入 → 动作剪切', audit:`通过：${lead.label}身份、服装、站位和尾帧姿势已锁定。` },
    { id:'S02', title:'节奏推进：舞步与空间穿行', movement:selected[1] || '手持感', prompt:`严格承接 S01 最后一帧：${still}，仍在夜晚城市广场，${clothes}完全一致。0-1 秒保持尾帧不动。1-4 秒：50mm 中景，带克制手持呼吸感，平行跟拍${lead.label}向右连续三步滑行；${lead.pronoun}的肩膀先向后收，再向前弹出，表情从得意转为警觉。4-7 秒：镜头轻微横移并推近，焦点从前景路牌转移到${lead.pronoun}的眼睛；${lead.label}停止舞步，右脚刹住，视线越过镜头看向右后方。7-9 秒：摄影机半环绕 90 度，露出${lead.pronoun}身后的空旷入口，不展示新角色正脸。9-10 秒：${lead.label}保持侧身与右后方视线，环境音乐在最后一拍骤停，只留下脚步和风声。`, transition:'动作匹配切 → 声音桥接', audit:`通过：${lead.label}的手势、站位、服装、光线与声音均承接 S01。` },
    { id:'S03', title:'爆点揭示：舞蹈被打断', movement:selected[2] || '焦点转移', prompt:`承接 S02：${lead.label}侧身站在画面左侧，视线锁定右后方，音乐已停。0-1 秒保持构图，随后用 POV 主观视角短切到${lead.pronoun}的视线：画面右侧出现一只拿着旧照片的手，背景人物虚焦，不新增无关角色。1-3 秒：焦点从照片边缘雨滴转移到照片内容，再转回${lead.pronoun}的瞳孔。3-5 秒：切回${lead.label}正面近景，摄影机沿 180 度弧线环绕到${lead.pronoun}面前；认出照片瞬间做一次短促希区柯克变焦，背景轻微拉伸，不能连续变焦。5-7.5 秒：${lead.pronoun}的笑容垮掉，手指从指向姿势慢慢垂下，完成清晰情绪变化。7.5-10 秒：镜头缓慢拉远成中景，${lead.label}向画面右侧迈出半步又停住，定格在犹豫姿态；保留风声作为下一段声音入口。`, transition:'视线匹配切 → 希区柯克变焦 → 悬停硬切', audit:`通过：主角始终为${lead.label}；下一镜可从${lead.pronoun}的犹豫姿态继续。` }
  ] satisfies Shot[] }
}

export async function POST(req:Request) {
  const { idea='', movements=[], imageReference='', sceneCardOverrides, shotPlanOverrides, stylePresetId, durationModeId } = await req.json()
  const stylePreset = getStylePreset(stylePresetId)
  // 时长模式：决定每镜秒数、时间块切分、镜头数放大系数，以及是否需要承接尾帧。
  const durationMode = getDurationMode(durationModeId)
  const actualIdea = imageReference ? `${idea}\n视觉参考模板：${imageReference}` : (idea || '主角在关键地点完成一个明确的戏剧动作')
  const intentAnalysis = analyzePlotIntent(actualIdea)
  const generatedSceneCard = buildSceneCard(actualIdea, intentAnalysis)
  // 用户覆盖必须走白名单合并：客户端下发的是整份场景卡，其中 beats / emotion / visual
  // 都是从剧情推导出来的、用户改不了的字段。若原样浅合并，改剧情后会被旧值盖回去，
  // 导致动态镜头数、前 3 秒钩子、情绪标注全部按旧剧情输出。
  const sceneCard: SceneCard = mergeSceneCardOverrides(generatedSceneCard, sceneCardOverrides)
  const lead: Lead = {
    label: sceneCard.protagonist.label,
    pronoun: sceneCard.protagonist.pronoun || (sceneCard.protagonist.gender === 'male' ? '他' : '她'),
    possessive: sceneCard.protagonist.gender === 'male' ? '他的' : '她的',
  }
  // 禁止默认项由意图识别器给出（例如神性降临禁止舞蹈、街舞、耍帅）。
  // 必须作为硬约束一路传到审核器，否则“用户没提舞蹈却出现跳舞”无法被拦截。
  // 用户明确提到舞蹈时，dance 意图自身不禁舞蹈，此处天然放行。
  const forbiddenDefaults = intentAnalysis.forbiddenDefaults
  const generatedShotPlan = planSceneToShots(sceneCard, movements, durationMode)
  // 镜头规划覆盖按**下标**合并，所以只在镜头数一致时才生效。
  // 镜头数是按剧情节拍算出来的：用户编辑过 3 镜方案、之后换成 5 个节拍的剧情，
  // 旧 S03 的标题会落到新的 S03 上——而那是完全不同的节拍，等于把两个故事缝在一起。
  // 镜头数变了说明剧情结构已经变了，旧规划整体作废，交给规划器重算。
  const overridesMatchPlan = Array.isArray(shotPlanOverrides) && shotPlanOverrides.length === generatedShotPlan.length
  const shotPlan: PlannedShot[] = overridesMatchPlan
    ? generatedShotPlan.map((shot, index) => ({ ...shot, ...(shotPlanOverrides[index] || {}), id: shot.id, durationSeconds: durationMode.seconds }))
    : generatedShotPlan
  // 镜头数由剧情节拍决定，可能多于 3 个；审核器必须拿到同一个 shotIds，
  // 否则它会按固定 3 镜校验并把超出的镜头截断。
  const shotIds = shotPlan.map((shot) => shot.id)
  const localResult = fallback(actualIdea, lead)
  // 兜底模板是按 10 秒写死的，切到其它时长必须把里面的时间描述一起换算，
  // 否则提示词会同时出现「严格 6 秒」和「9-10 秒」这种自相矛盾的时间码。
  const localShots = durationMode.seconds === 10
    ? localResult.shots
    : localResult.shots.map((shot) => ({ ...shot, prompt: rescaleTimelineText(shot.prompt, 10, durationMode.seconds) }))
  const localContinuity = auditAndRepairContinuity(localShots, lead, forbiddenDefaults, shotIds, durationMode)
  // 把规划器的约束合并进镜头文本。
  // 规划镜头数是权威：模板只提供文案骨架，数量的差异由规划器的镜头补齐，
  // 否则「5 个节拍 → 5 镜」会在本地兜底分支被压回 3 镜，动态镜头数形同虚设。
  const plannedLocalShots = shotPlan.map((plan, index) => {
    const shot = localContinuity.repairedShots[index]
    if (!shot) {
      // 模板镜头用尽，用规划器内容新建一镜，保证编号和锚点与规划一致。
      return {
        id: plan.id,
        title: plan.title,
        shotSize: plan.shotSize,
        movement: plan.movement,
        prompt: `剧情：${actualIdea}。主角锁定为${lead.label}，不得改成其他性别或人物。景别：${plan.shotSize}。${plan.timeBlocks.join('；')}。${plan.actionDirection}。结尾必须停在：${plan.outgoingAnchor}。`,
        transition: plan.transition,
        audit: `通过：本镜由剧情节拍规划器补齐，承接 ${index > 0 ? shotIds[index - 1] : '开场'}。`,
      }
    }
    return {
      ...shot,
      id: plan.id,
      shotSize: shot.shotSize?.trim() || plan.shotSize,
      movement: shot.movement || plan.movement,
      transition: shot.transition || plan.transition,
      prompt: `${shot.prompt}\n\n镜头规划约束：本段目标是“${plan.objective}”。时间分配：${plan.timeBlocks.join('；')}。${plan.actionDirection}。转场：${plan.transition}。结尾必须停在：${plan.outgoingAnchor}。`,
    }
  })
  const recheckedLocal = auditAndRepairContinuity(plannedLocalShots, lead, forbiddenDefaults, shotIds, durationMode)
  const compiledLocal = compilePromptSet(sceneCard, shotPlan, recheckedLocal.repairedShots, recheckedLocal.after, stylePreset, durationMode)
  const fallbackResult = { ...localResult, shots: compiledLocal.shots, compiledText: compiledLocal.compiledText, stylePreset, stylePresetId: stylePreset.id, intent: intentAnalysis.intent, intentLabel: intentAnalysis.label, intentAnalysis, sceneCard, shotPlan, continuity: recheckedLocal.after, continuityBefore: recheckedLocal.before, lead: lead.label }
  const { key, baseUrl: base, model } = await getBailianConfig()
  if (!key) return NextResponse.json(fallbackResult)
  try {
    // 镜头数由剧情节拍动态决定，必须把真实数量告诉模型，
    // 否则它会按「3 个镜头」的旧指令生成，把多节拍剧情重新挤回 3 镜。
    const shotIds = shotPlan.map((item) => item.id)
    const shotCount = shotIds.length
    const timelineEnd = formatTimeCode(durationMode.seconds)
    // 时长模式必须显式告知模型：否则它会按训练里最常见的 10 秒结构写时间轴，
    // 6 秒镜头里就会出现 0:08、0:10 这种超出本镜长度的时间码。
    const durationGuard = `\n\n【时长模式：${durationMode.name}】每个镜头严格 ${durationMode.seconds} 秒，时间轴从 0:00 到 ${timelineEnd}，不得出现超过 ${timelineEnd} 的时间码。${durationMode.chained ? '镜头之间必须严格承接上一镜的尾帧状态，保证可以无缝拼接。' : '本模式不做尾帧承接：每个镜头独立成立，由后期硬切衔接。镜头结尾停在动作的自然落点即可，不要写等待下一镜、回望或保持姿态这类停滞描述。'}`
    const system = `你是红果竖屏短剧的视频提示词导演，也能写大制作游戏 CG、UE5 写实玄幻和国风仙侠动画风格。只输出严格 JSON，不要 Markdown。格式：{"shots":[{"id":"S01","title":"","shotSize":"","prompt":"","movement":"","transition":"","audit":""}]}。红果短剧基调：9:16 竖屏，开头 0.5-1 秒就出现清楚的动作或画面，人物和事件优先，每 ${durationMode.seconds} 秒只完成一个小事件。\n\n提示词采用“高密度电影提示词”的结构，但每个动作仍然用模型看得懂的大白话：\nA. 风格与规格：引擎或渲染质感、画幅、类型、整体色调、光影、景深、动态模糊、画面干净程度。\nB. 人物设定：姓名/身份、年龄感、发型、脸部特征、服装、配饰、手持道具；同一项目后续镜头必须完全一致。\nC. 场景：地点、地面、天空、前景、中景、背景、天气、粒子、群众或敌人数量和位置。\nD. 镜头时序：必须在 0:00 到 ${timelineEnd} 之间按更细的时间段写清动作、景别、镜头位置、镜头运动、特效、声音、台词和本镜落点。\nE. 负面约束：无水印、无文字、无多余人物、无穿模、无肢体变形、无卡顿、无倒放、无反向行走。\n\n用户如果给出类似“UE5.4 引擎渲染、3D 写实国风仙侠、暗紫墨黑配色、魔域大战”这样的风格词，必须保留并扩展为完整的风格与规格、人物设定、场景和时间轴；不要把它压缩成几句普通描述。高级词可以保留，但后面必须跟能拍出来的内容。例如“神性美感”后面要写“人物从光柱中落地，白光从头顶照下，脸部保持平静，衣摆向后飘”；“动态快门”后面要写“快速挥扇时扇刃边缘留下短暂白色拖影”。句子让普通人看得懂，但要有前景、主体、背景、光线方向、镜头路径、速度、停顿和画面变化。不要只写“她很美、很震撼、很高级”。\n\n角色锚点不可改变：本片唯一主角是“${lead.label}”，代词使用“${lead.pronoun}”。禁止擅自添加用户未提及的舞蹈、跳舞、街舞、耍帅等动作；只有用户明确提到舞蹈时才可以生成。强戏剧场面加入 1-2 句短台词，写明谁说、什么声音、口型如何、停顿多久。所有动作必须写成空间指令：人物面朝哪边、从画面哪侧到哪侧、哪只脚先迈、走几步、身体重心、结束姿势；明确写“正常向前走，不倒退、不倒放”。转身写明顺时针/逆时针、转向画面左/右和角度；抬手、放下、拿取写明起始位置和结束位置。每个镜头必须明确景别，shotSize 只能从“远景 / 中远景 / 中景 / 中近景 / 近景 / 特写 / 极特写”中选择，并在 prompt 中再次写出景别、机位和焦段感。**本次必须生成 ${shotCount} 个连续镜头（编号 ${shotIds.join('、')}），每个严格 ${durationMode.seconds} 秒。镜头数量已按剧情节拍确定，不得增加也不得减少，不得把多个镜头的剧情合并成更少的镜头。**连续镜头必须重复角色、服装、道具、站位、朝向、光线和声音锚点。运镜术语按直白动作执行：过肩反打就是从前景人物肩膀后拍对面人物；子弹时间就是人物动作变慢、镜头绕一圈；慢门就是移动物体留下拖影；斜角就是画面向一边倾斜；Fly Through 就是镜头穿过门、窗或人群；Dolly In/Out 就是镜头向前推近/向后拉远；Steadicam Follow 就是镜头平稳跟着人走；Crane Up/Down 就是镜头向上/向下升降；Tracking/Truck 就是镜头向左/右平移；Dutch Roll 就是镜头慢慢倾斜旋转。`
    const intentGuard = `\n\n风格预设：${stylePreset.name}。${retimeShotLengthText(stylePreset.description, 10, durationMode.seconds)}。${stylePreset.format}。视觉规则：${stylePreset.visualRules.map((rule) => retimeShotLengthText(rule, 10, durationMode.seconds)).join('、')}。节奏规则：${stylePreset.pacingRules.map((rule) => retimeShotLengthText(rule, 10, durationMode.seconds)).join('、')}。台词规则：${stylePreset.dialogueRules.join('、')}。推荐景别：${stylePreset.recommendedShotSizes.join('、')}。推荐运镜：${stylePreset.recommendedMovements.join('、')}。\n\n剧情意图识别器结果：${intentAnalysis.label}（${intentAnalysis.intent}，置信度 ${intentAnalysis.confidence}）。识别依据：${intentAnalysis.reason}。必须包含：${intentAnalysis.mustInclude.join('、')}。禁止默认加入：${intentAnalysis.forbiddenDefaults.join('、')}。除非用户明确提到，否则不要自动生成舞蹈、街舞或耍帅动作。\n\n结构化场景卡：${JSON.stringify(sceneCard)}\n\n镜头规划器：${JSON.stringify(shotPlan)}。必须严格按以上 ${shotCount} 个镜头（${shotIds.join('、')}）各自的事件目标、景别、时间段、转场和尾帧锚点生成，不能把多个镜头写成同一段重复描述，也不能合并或省略任何一个镜头。用户对场景卡或镜头规划做过的修改属于最高优先级，必须执行。`
    const user = `剧情：${idea}\n唯一主角：${sceneCard.protagonist.label}\n识别后的剧情意图：${intentAnalysis.label}\n风格预设：${stylePreset.name}\n结构化场景卡：${JSON.stringify(sceneCard)}\n镜头规划：${JSON.stringify(shotPlan)}\n视觉参考模板说明：${imageReference || '无'}\n指定运镜：${movements.join('、') || '请智能选择'}\n生成 ${shotCount} 个可拼接的 ${durationMode.seconds} 秒镜头块（${shotIds.join('、')}）。视觉参考只影响人物外观、服装、场景美术、构图和色彩；不得改变用户指定的角色身份与剧情。`
    const response = await fetch(`${base}/chat/completions`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,messages:[{role:'system',content:system + durationGuard + intentGuard},{role:'user',content:user}],temperature:0.65})})
    if (!response.ok) throw new Error('DashScope request failed')
    const data = await response.json(); const content = data.choices?.[0]?.message?.content || ''
    const parsed = JSON.parse(content.replace(/```json|```/g,'').trim())
    const normalizedShots = normalizeShots(parsed.shots, lead)
    const continuity = auditAndRepairContinuity(normalizedShots, lead, forbiddenDefaults, shotIds, durationMode)
    const compiled = compilePromptSet(sceneCard, shotPlan, continuity.repairedShots, continuity.after, stylePreset, durationMode)
    return NextResponse.json({mode:'dashscope',lead:lead.label,stylePreset,stylePresetId:stylePreset.id,intent:intentAnalysis.intent,intentLabel:intentAnalysis.label,intentAnalysis,sceneCard,shotPlan,continuity:continuity.after,continuityBefore:continuity.before,compiledText:compiled.compiledText,shots:compiled.shots})
  } catch { return NextResponse.json(fallbackResult) }
}
