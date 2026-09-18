'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SceneCard } from '../lib/prompt/scene-card'
import { mergeSceneCardOverrides } from '../lib/prompt/scene-card'
import type { PlannedShot } from '../lib/prompt/shot-planner'
import type { ContinuityAuditReport } from '../lib/prompt/continuity-auditor'
import type { CompiledPromptSet } from '../lib/prompt/prompt-compiler'
import type { StylePreset } from '../lib/prompt/style-presets'
import { DEFAULT_STYLE_PRESET_ID } from '../lib/prompt/style-presets'
import { DEFAULT_DURATION_MODE_ID, getDurationMode, type DurationMode, type DurationModeId } from '../lib/prompt/duration-modes'

export type GeneratedShot = {
  id: string
  title: string
  shotSize?: string
  movement: string
  prompt: string
  transition: string
  audit: string
}

type StudioContextValue = {
  sceneCard: SceneCard | null
  shotPlan: PlannedShot[]
  setSceneCard: (card: SceneCard | null) => void
  setShotPlan: (plan: PlannedShot[]) => void
  updateSceneCard: (patch: (draft: SceneCard) => void) => void
  updateShotPlanAt: (index: number, patch: (draft: PlannedShot) => void) => void
  editorOpen: boolean
  setEditorOpen: (open: boolean) => void
  overridesDirty: boolean
  markOverridesDirty: () => void
  /** 新剧情开始：清掉上一轮的场景卡覆盖，避免旧覆盖污染新生成。 */
  beginNewStoryline: () => void
  /** 生成请求实际发送时的输入快照，用于判断“编辑是否真的影响了这一次生成”。 */
  appliedSnapshot: { sceneCard: SceneCard | null; shotPlan: PlannedShot[] } | null
  getOverridesForRequest: () => { sceneCardOverrides: SceneCard | undefined; shotPlanOverrides: PlannedShot[] | undefined }
  applyGenerated: (card: SceneCard | null, plan: PlannedShot[]) => void
  auditReport: ContinuityAuditReport | null
  auditBefore: ContinuityAuditReport | null
  setAuditReports: (report: ContinuityAuditReport | null, before: ContinuityAuditReport | null) => void
  stylePresetId: string
  setStylePresetId: (id: string) => void
  /** 镜头时长模式：10 秒或 6 秒。 */
  durationModeId: DurationModeId
  setDurationModeId: (id: DurationModeId) => void
  activeDurationMode: DurationMode
  /** 最后一次生效的风格预设对象，用于确认预设真的传进了 API 和最终提示词。 */
  activeStylePreset: StylePreset | null
  setActiveStylePreset: (preset: StylePreset | null) => void
  compiled: CompiledPromptSet | null
  setCompiled: (value: CompiledPromptSet | null) => void
  generatedAt: string | null
  setGeneratedAt: (value: string | null) => void
}

const StudioContext = createContext<StudioContextValue | null>(null)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [sceneCard, setSceneCard] = useState<SceneCard | null>(null)
  const [shotPlan, setShotPlan] = useState<PlannedShot[]>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const [overridesDirty, setOverridesDirty] = useState(false)
  const [appliedSnapshot, setAppliedSnapshot] = useState<{ sceneCard: SceneCard | null; shotPlan: PlannedShot[] } | null>(null)
  const [auditReport, setAuditReport] = useState<ContinuityAuditReport | null>(null)
  const [auditBefore, setAuditBefore] = useState<ContinuityAuditReport | null>(null)
  const [stylePresetId, setStylePresetIdState] = useState(DEFAULT_STYLE_PRESET_ID)
  const [durationModeId, setDurationModeIdState] = useState<DurationModeId>(DEFAULT_DURATION_MODE_ID)
  const [activeStylePreset, setActiveStylePreset] = useState<StylePreset | null>(null)
  const [compiled, setCompiled] = useState<CompiledPromptSet | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  // 用 ref 保存最新值，避免把闭包里的旧状态交给请求参数。
  const sceneCardRef = useRef<SceneCard | null>(null)
  const shotPlanRef = useRef<PlannedShot[]>([])
  const dirtyRef = useRef(false)
  sceneCardRef.current = sceneCard
  shotPlanRef.current = shotPlan
  dirtyRef.current = overridesDirty

  const markOverridesDirty = useCallback(() => setOverridesDirty(true), [])

  const updateSceneCard = useCallback((patch: (draft: SceneCard) => void) => {
    setSceneCard((current) => {
      if (!current) return current
      const next = clone(current)
      patch(next)
      // 关键修复：代词由性别派生。用户在面板里把主角身份改成“男主”后，
      // 代词必须同步变成“他”，否则提示词里会出现“男主…她”的自相矛盾。
      if (next.protagonist.gender === 'male') next.protagonist.pronoun = '他'
      else if (next.protagonist.gender === 'female') next.protagonist.pronoun = '她'
      return next
    })
    setOverridesDirty(true)
  }, [])

  const updateShotPlanAt = useCallback((index: number, patch: (draft: PlannedShot) => void) => {
    setShotPlan((current) => {
      if (!current[index]) return current
      const next = clone(current)
      patch(next[index])
      return next
    })
    setOverridesDirty(true)
  }, [])

  /**
   * 关键修复：旧实现只在“生成时”重置 overridesDirty，
   * 一旦用户打开编辑面板改过任何字段，之后每一次生成都会把这份旧场景卡当成硬约束下发，
   * 换新剧情也依然被旧覆盖污染。现在把“重置”和“新剧情”绑定：
   * 任一编辑动作会置脏，而标记新剧情（beginNewStoryline）会清脏并清空快照。
   */
  const beginNewStoryline = useCallback(() => {
    setOverridesDirty(false)
    setAppliedSnapshot(null)
  }, [])

  const applyGenerated = useCallback((card: SceneCard | null, plan: PlannedShot[]) => {
    // 用户手动编辑过的内容优先保留，不被服务端回传的重算结果覆盖。
    const dirty = dirtyRef.current
    if (!dirty) {
      setSceneCard(card)
      setShotPlan(plan)
    } else {
      if (card) {
        setSceneCard((current) => {
          if (!current) return card
          // 必须走白名单合并：直接浅合并 event 会让旧场景卡的 beats / opponentAction
          // 盖掉服务端按新剧情重算的结果，导致换剧情后镜头数、钩子、情绪仍按旧剧情走。
          return mergeSceneCardOverrides(card, current)
        })
      }
      if (plan.length) {
        setShotPlan((current) => {
          // 镜头数变了说明剧情节拍结构已变，按下标合并会把两个故事缝在一起，直接采用新规划。
          if (current.length !== plan.length) return plan
          return plan.map((shot, index) => ({ ...shot, ...current[index], id: shot.id, durationSeconds: 10 }))
        })
      }
    }
    // 记录本次真正下发的快照，供面板显示“本次生成已应用你的编辑”。
    setAppliedSnapshot({
      sceneCard: dirty ? (sceneCardRef.current ? clone(sceneCardRef.current) : null) : card,
      shotPlan: dirty ? clone(shotPlanRef.current) : plan,
    })
  }, [])

  const getOverridesForRequest = useCallback(() => {
    if (!dirtyRef.current) return { sceneCardOverrides: undefined, shotPlanOverrides: undefined }
    return {
      sceneCardOverrides: sceneCardRef.current ? clone(sceneCardRef.current) : undefined,
      shotPlanOverrides: shotPlanRef.current.length ? clone(shotPlanRef.current) : undefined,
    }
  }, [])

  const setAuditReports = useCallback((report: ContinuityAuditReport | null, before: ContinuityAuditReport | null) => {
    setAuditReport(report)
    setAuditBefore(before)
  }, [])

  const setStylePresetId = useCallback((id: string) => setStylePresetIdState(id), [])
  // 切换时长模式等于换一套分镜结构（每镜秒数、时间块、镜头数、是否承接），
  // 旧的场景卡覆盖和镜头规划都不再适用，必须一起清掉，否则会留下按旧时长写的镜头。
  const setDurationModeId = useCallback((id: DurationModeId) => {
    setDurationModeIdState(id)
    setOverridesDirty(false)
    setAppliedSnapshot(null)
    setShotPlan([])
  }, [])

  const value = useMemo(() => ({
    sceneCard,
    shotPlan,
    setSceneCard,
    setShotPlan,
    updateSceneCard,
    updateShotPlanAt,
    editorOpen,
    setEditorOpen,
    overridesDirty,
    markOverridesDirty,
    appliedSnapshot,
    getOverridesForRequest,
    beginNewStoryline,
    applyGenerated,
    auditReport,
    auditBefore,
    setAuditReports,
    stylePresetId,
    setStylePresetId,
    durationModeId,
    setDurationModeId,
    activeDurationMode: getDurationMode(durationModeId),
    activeStylePreset,
    setActiveStylePreset,
    compiled,
    setCompiled,
    generatedAt,
    setGeneratedAt,
  }), [sceneCard, shotPlan, editorOpen, overridesDirty, appliedSnapshot, getOverridesForRequest, beginNewStoryline, applyGenerated, auditReport, auditBefore, setAuditReports, stylePresetId, setStylePresetId, activeStylePreset, compiled, generatedAt, updateSceneCard, updateShotPlanAt, markOverridesDirty])

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudioContext() {
  const value = useContext(StudioContext)
  if (!value) throw new Error('useStudioContext must be used inside StudioProvider')
  return value
}
