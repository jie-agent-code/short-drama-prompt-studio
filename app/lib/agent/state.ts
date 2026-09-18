import type { PromptAgentIntent, PromptAgentLead, PromptAgentState } from './types'

export function createPromptAgentState(input: {
  idea?: string
  movements?: string[]
  runId?: string
  metadata?: Record<string, unknown>
}): PromptAgentState {
  return {
    runId: input.runId || crypto.randomUUID(),
    idea: input.idea?.trim() || '',
    movements: [...(input.movements || [])],
    shots: [],
    stage: 'input',
    errors: [],
    metadata: { ...(input.metadata || {}) },
  }
}

export function withLead(state: PromptAgentState, lead: PromptAgentLead): PromptAgentState {
  return { ...state, lead, stage: 'character' }
}

export function withIntent(state: PromptAgentState, intent: PromptAgentIntent): PromptAgentState {
  return { ...state, intent, stage: 'intent' }
}
