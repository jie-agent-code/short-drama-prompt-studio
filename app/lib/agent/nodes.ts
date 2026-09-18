import type { PromptAgentIntent, PromptAgentLead, PromptAgentNode, PromptAgentState } from './types'
import { analyzePlotIntent } from '../prompt/intent-classifier'
import { buildSceneCard, protagonistFrom } from '../prompt/scene-card'
import { planSceneToShots } from '../prompt/shot-planner'
import { auditAndRepairContinuity } from '../prompt/continuity-auditor'

export type PromptAgentNodeOptions = {
  identifyLead?: (idea: string) => PromptAgentLead
  classifyIntent?: (idea: string) => PromptAgentIntent
  structureScene?: (state: PromptAgentState) => PromptAgentState['sceneCard'] | Promise<PromptAgentState['sceneCard']>
  planShots?: (state: PromptAgentState) => PromptAgentState['shots'] | Promise<PromptAgentState['shots']>
  auditContinuity?: (state: PromptAgentState) => string[] | Promise<string[]>
  repairContinuity?: (state: PromptAgentState) => PromptAgentState['shots'] | Promise<PromptAgentState['shots']>
}

/**
 * 默认角色识别：直接复用 scene-card 的 protagonistFrom。
 *
 * 这里曾经有第二套独立的「女主/男主」正则，它认不出「妻子/丈夫」，也不支持
 * 姓名和身份解析，代词兜底还返回「角色」而不是「主角」，导致同一个输入在
 * Agent 链路和正式生成链路上得到不同结果。现在统一到唯一实现。
 */
const defaultLead = (idea: string): PromptAgentLead => {
  const protagonist = protagonistFrom(idea)
  return {
    label: protagonist.label,
    pronoun: protagonist.pronoun,
    possessive: protagonist.gender === 'female' ? '她的' : protagonist.gender === 'male' ? '他的' : '主角的',
    gender: protagonist.gender,
    name: protagonist.name,
    role: protagonist.role,
  }
}

/**
 * 默认意图识别：直接复用 analyzePlotIntent。
 *
 * 旧实现是第二套简单关键词匹配，完全没有否定语境处理，
 * 输入「女主不要跳舞」会被误判成 dance——正是业务规则明令禁止的情形。
 */
const defaultIntent = (idea: string): PromptAgentIntent => analyzePlotIntent(idea).intent

export function createAgentNodes(options: PromptAgentNodeOptions = {}) {
  const identifyLead = options.identifyLead || defaultLead
  const classifyIntent = options.classifyIntent || defaultIntent

  const normalizeInput: PromptAgentNode = (state) => ({
    ...state,
    idea: state.idea.trim(),
    movements: Array.from(new Set(state.movements.map((item) => item.trim()).filter(Boolean))),
    stage: 'input',
  })

  const identifyCharacter: PromptAgentNode = (state) => ({ ...state, lead: identifyLead(state.idea), stage: 'character' })
  const classifyStory: PromptAgentNode = (state) => ({ ...state, intent: classifyIntent(state.idea), stage: 'intent' })

  const structureScene: PromptAgentNode = async (state) => {
    const sceneCard = options.structureScene
      ? await options.structureScene(state)
      : state.intent && state.intent !== 'unknown'
        ? buildSceneCard(state.idea, analyzePlotIntent(state.idea))
        : undefined
    return { ...state, sceneCard, stage: 'scene_card' }
  }

  /**
   * 镜头规划节点。
   *
   * 旧默认实现只填了 shotPlan，state.shots 始终为空数组，
   * 导致下游审核节点拿到空列表、整个 Agent 链路产出不了任何镜头。
   * 现在默认把每个 planned shot 转换为可审核的镜头块，并把禁项传给下游。
   */
  const planShots: PromptAgentNode = async (state) => {
    const shotPlan = state.sceneCard ? planSceneToShots(state.sceneCard, state.movements) : []
    if (options.planShots) return { ...state, shotPlan, shots: await options.planShots(state), stage: 'shot_plan' }

    const shots = shotPlan.map((plan) => ({
      id: plan.id,
      title: plan.title,
      shotSize: plan.shotSize,
      movement: plan.movement,
      prompt: plan.timeBlocks.length ? plan.timeBlocks.join('；') + '。' : plan.objective,
      transition: plan.transition,
      audit: '',
    })) as unknown as PromptAgentState['shots']

    return { ...state, shotPlan, shots, stage: 'shot_plan' }
  }

  const assignMovements: PromptAgentNode = (state) => ({
    ...state,
    metadata: { ...state.metadata, selectedMovements: state.movements },
    stage: 'movement',
  })

  /**
   * 连续性审核节点。
   *
   * 旧默认实现是空转：没有传入 options.auditContinuity 就直接把 errors 留空、
   * 直接进 continuity 阶段，等于 Agent 链路完全没有审核能力。
   * 现在默认走真实的 auditAndRepairContinuity，并复用场景卡里的 forbiddenDefaults。
   */
  const auditContinuity: PromptAgentNode = async (state) => {
    if (options.auditContinuity) {
      const errors = await options.auditContinuity(state)
      return { ...state, errors, stage: errors.length ? 'repair' : 'continuity' }
    }

    const lead = state.lead
    if (!lead || !state.shots.length) return { ...state, errors: [], stage: 'continuity' }

    const result = auditAndRepairContinuity(
      state.shots as unknown as Parameters<typeof auditAndRepairContinuity>[0],
      { label: lead.label, pronoun: lead.pronoun, possessive: lead.possessive },
      state.sceneCard?.continuity.forbiddenDefaults ?? [],
    )
    const errors = result.before.issues.map((issue) => `${issue.shotId}: ${issue.message}`)

    return {
      ...state,
      // 审核通过则沿用原镜头；有问题时先用修正结果，交给 repairContinuity 节点收口。
      shots: result.before.issues.length
        ? (result.repairedShots as unknown as PromptAgentState['shots'])
        : state.shots,
      errors,
      metadata: {
        ...state.metadata,
        continuityScore: result.after.score,
        continuityPassed: result.after.passed,
        repairedNote: result.before.issues.length ? '已在审核阶段自动修正' : '无需修正',
      },
      stage: errors.length ? 'repair' : 'continuity',
    }
  }

  const repairContinuity: PromptAgentNode = async (state) => {
    if (options.repairContinuity) {
      if (!state.errors.length) return { ...state, stage: 'complete' }
      return { ...state, shots: await options.repairContinuity(state), errors: [], stage: 'complete' }
    }
    // 默认实现：审核节点已把修正结果写回 shots，这里只需收口状态。
    return { ...state, errors: [], stage: 'complete' }
  }

  const complete: PromptAgentNode = (state) => ({ ...state, stage: 'complete' })

  return { normalizeInput, identifyCharacter, classifyStory, structureScene, planShots, assignMovements, auditContinuity, repairContinuity, complete }
}
