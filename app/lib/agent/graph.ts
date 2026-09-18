import { createPromptAgentState } from './state'
import { createAgentNodes, type PromptAgentNodeOptions } from './nodes'
import type { PromptAgentGraphDefinition, PromptAgentState } from './types'

export function createPromptAgentGraph(options: PromptAgentNodeOptions = {}): PromptAgentGraphDefinition {
  const nodes = createAgentNodes(options)
  return {
    start: 'normalizeInput',
    nodes,
    edges: [
      { from: 'normalizeInput', to: 'identifyCharacter' },
      { from: 'identifyCharacter', to: 'classifyStory' },
      { from: 'classifyStory', to: 'structureScene' },
      { from: 'structureScene', to: 'planShots' },
      { from: 'planShots', to: 'assignMovements' },
      { from: 'assignMovements', to: 'auditContinuity' },
      { from: 'auditContinuity', to: 'repairContinuity', when: (state) => state.errors.length > 0 },
      { from: 'auditContinuity', to: 'complete', when: (state) => state.errors.length === 0 },
      { from: 'repairContinuity', to: 'complete' },
    ],
    maxSteps: 20,
  }
}

function nextNode(graph: PromptAgentGraphDefinition, current: string, state: PromptAgentState) {
  return graph.edges.find((edge) => edge.from === current && (!edge.when || edge.when(state)))?.to
}

/** Local runner kept dependency-free so a LangGraph adapter can be added later. */
export async function runPromptAgent(
  input: { idea?: string; movements?: string[]; runId?: string; metadata?: Record<string, unknown> },
  options: PromptAgentNodeOptions = {},
): Promise<PromptAgentState> {
  const graph = createPromptAgentGraph(options)
  let state = createPromptAgentState(input)
  let current: string | undefined = graph.start
  let steps = 0

  while (current && steps < (graph.maxSteps || 20)) {
    const node = graph.nodes[current]
    if (!node) return { ...state, stage: 'error', errors: [...state.errors, `Unknown agent node: ${current}`] }
    try {
      state = { ...state, ...(await node(state)) }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agent error'
      return { ...state, stage: 'error', errors: [...state.errors, message] }
    }
    current = nextNode(graph, current, state)
    steps += 1
  }

  if (steps >= (graph.maxSteps || 20) && state.stage !== 'complete') {
    return { ...state, stage: 'error', errors: [...state.errors, 'Agent graph exceeded max steps'] }
  }
  return state
}
