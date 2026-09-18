import type { ShotBlockRecord } from '../domain/types'
import type { SceneCard } from '../prompt/scene-card'
import type { PlannedShot } from '../prompt/shot-planner'

export type PromptAgentStage =
  | 'input'
  | 'character'
  | 'intent'
  | 'scene_card'
  | 'shot_plan'
  | 'movement'
  | 'continuity'
  | 'repair'
  | 'complete'
  | 'error'

export type PromptAgentIntent =
  | 'epic_arrival'
  | 'action'
  | 'dance'
  | 'chase'
  | 'romance'
  | 'dramatic'
  | 'unknown'

export type PromptAgentLead = {
  label: string
  pronoun: string
  possessive: string
  gender?: 'female' | 'male' | 'unknown'
  name?: string
  role?: string
}

export type PromptAgentState = {
  runId: string
  idea: string
  movements: string[]
  lead?: PromptAgentLead
  intent?: PromptAgentIntent
  sceneCard?: SceneCard
  shotPlan?: PlannedShot[]
  shots: ShotBlockRecord[]
  stage: PromptAgentStage
  errors: string[]
  metadata: Record<string, unknown>
}

export type PromptAgentNode = (
  state: PromptAgentState,
) => PromptAgentState | Partial<PromptAgentState> | Promise<PromptAgentState | Partial<PromptAgentState>>

export type PromptAgentNodeMap = Record<string, PromptAgentNode>

export type PromptAgentEdge = {
  from: string
  to: string
  when?: (state: PromptAgentState) => boolean
}

export type PromptAgentGraphDefinition = {
  start: string
  nodes: PromptAgentNodeMap
  edges: PromptAgentEdge[]
  maxSteps?: number
}
