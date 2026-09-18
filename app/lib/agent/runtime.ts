import { runPromptAgent } from './graph'
import type { PromptAgentNodeOptions } from './nodes'
import type { PromptAgentState } from './types'

export type PromptAgentInput = {
  idea?: string
  movements?: string[]
  runId?: string
  metadata?: Record<string, unknown>
}

/**
 * Runtime boundary for the API layer. The implementation can later be swapped
 * for a LangGraph StateGraph without changing route handlers or UI payloads.
 */
export type PromptAgentRuntime = {
  run(input: PromptAgentInput, options?: PromptAgentNodeOptions): Promise<PromptAgentState>
}

export const localPromptAgentRuntime: PromptAgentRuntime = {
  run: runPromptAgent,
}
