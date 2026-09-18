'use client'

import { useEffect } from 'react'
import { useStudioContext } from './studio-context'
import styles from './scene-planner-panel.module.css'

export default function ScenePlannerPanel() {
  const {
    sceneCard,
    shotPlan,
    updateSceneCard,
    updateShotPlanAt,
    editorOpen,
    setEditorOpen,
    markOverridesDirty,
    beginNewStoryline,
    appliedSnapshot,
    overridesDirty,
  } = useStudioContext()

  useEffect(() => {
    if (editorOpen) setEditorOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!sceneCard || !editorOpen) return null

  // 编辑动作本身已经把状态置脏，这里不再重复 setState（旧实现调了两次 setSceneCard/setShotPlan）。
  const card = (patch: Parameters<typeof updateSceneCard>[0]) => updateSceneCard(patch)
  const plan = (index: number, patch: Parameters<typeof updateShotPlanAt>[1]) => updateShotPlanAt(index, patch)

  const appliedNote = appliedSnapshot
    ? '本次生成已把你的编辑作为最高优先级约束下发。'
    : overridesDirty
      ? '已记录你的修改，点击主界面“生成导演级分镜”后生效。'
      : '当前显示的是服务端重算结果，尚未有手动修改。'

  return (
    <aside className={styles.panel} aria-label="场景卡和镜头规划编辑面板">
      <div className={styles.header}>
        <div><span className={styles.eyebrow}>SCENE CARD / SHOT PLAN</span><h2>场景卡与镜头规划</h2></div>
        <button className={styles.close} onClick={() => setEditorOpen(false)} aria-label="关闭编辑面板">×</button>
      </div>
      <p className={styles.note}>{appliedNote}</p>
      <div className={styles.actions}>
        <button className={styles.ghost} onClick={() => markOverridesDirty()}>标记为已编辑</button>
        <button className={styles.ghost} onClick={() => beginNewStoryline()}>开始新剧情（清除覆盖）</button>
      </div>
      <section className={styles.section}>
        <h3>主角与事件</h3>
        <div className={styles.twoCol}>
          <label>主角身份
            <select value={sceneCard.protagonist.label} onChange={(e) => card((draft) => {
              draft.protagonist.label = e.target.value
              if (e.target.value === '女主') draft.protagonist.gender = 'female'
              else if (e.target.value === '男主') draft.protagonist.gender = 'male'
              else draft.protagonist.gender = 'unknown'
            })}>
              <option value="女主">女主</option>
              <option value="男主">男主</option>
              <option value="主角">主角</option>
            </select>
          </label>
          <label>性别锚点
            <select value={sceneCard.protagonist.gender} onChange={(e) => card((draft) => {
              draft.protagonist.gender = e.target.value as typeof draft.protagonist.gender
            })}>
              <option value="female">女</option>
              <option value="male">男</option>
              <option value="unknown">未指定</option>
            </select>
          </label>
        </div>
        <label>代词<input value={sceneCard.protagonist.pronoun} readOnly title="代词由性别锚点自动派生，保证提示词不会出现性别矛盾" /></label>
        <label>姓名<input value={sceneCard.protagonist.name || ''} onChange={(e) => card((draft) => { draft.protagonist.name = e.target.value || undefined })} placeholder="可选" /></label>
        <label>身份 / 职业<input value={sceneCard.protagonist.role || ''} onChange={(e) => card((draft) => { draft.protagonist.role = e.target.value || undefined })} placeholder="例如：神界使者、律师、学生" /></label>
        <label>核心动作<textarea value={sceneCard.event.primaryAction} onChange={(e) => card((draft) => { draft.event.primaryAction = e.target.value })} rows={2} /></label>
        <label>动作方向<textarea value={sceneCard.event.movementDirection} onChange={(e) => card((draft) => { draft.event.movementDirection = e.target.value })} rows={2} /></label>
      </section>
      <section className={styles.section}>
        <h3>场景与台词</h3>
        <div className={styles.twoCol}>
          <label>地点<input value={sceneCard.setting.location} onChange={(e) => card((draft) => { draft.setting.location = e.target.value })} /></label>
          <label>时间<input value={sceneCard.setting.time} onChange={(e) => card((draft) => { draft.setting.time = e.target.value })} /></label>
        </div>
        <label>天气<input value={sceneCard.setting.weather} onChange={(e) => card((draft) => { draft.setting.weather = e.target.value })} /></label>
        <label>台词语气<input value={sceneCard.dialogue.tone} onChange={(e) => card((draft) => { draft.dialogue.tone = e.target.value })} /></label>
        <label>建议台词（每行一句）<textarea value={sceneCard.dialogue.suggestedLines.join('\n')} onChange={(e) => card((draft) => { draft.dialogue.suggestedLines = e.target.value.split('\n').map((item) => item.trim()).filter(Boolean); draft.dialogue.required = draft.dialogue.suggestedLines.length > 0 })} rows={3} /></label>
      </section>
      <section className={styles.section}>
        <h3>{shotPlan.length} 段镜头规划（按剧情节拍自动决定段数）</h3>
        {shotPlan.map((shot, index) => <div className={styles.shot} key={shot.id}>
          <div className={styles.shotTitle}><b>{shot.id}</b><span>{shot.durationSeconds}.0 秒</span></div>
          <label>镜头标题<input value={shot.title} onChange={(e) => plan(index, (draft) => { draft.title = e.target.value })} /></label>
          <div className={styles.twoCol}>
            <label>景别<input value={shot.shotSize} onChange={(e) => plan(index, (draft) => { draft.shotSize = e.target.value })} /></label>
            <label>运镜<input value={shot.movement} onChange={(e) => plan(index, (draft) => { draft.movement = e.target.value })} /></label>
          </div>
          <label>本段目标<textarea value={shot.objective} onChange={(e) => plan(index, (draft) => { draft.objective = e.target.value })} rows={2} /></label>
          <label>时间轴<textarea value={shot.timeBlocks.join('\n')} onChange={(e) => plan(index, (draft) => { draft.timeBlocks = e.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} rows={3} /></label>
          <label>上一镜承接<textarea value={shot.incomingAnchor} onChange={(e) => plan(index, (draft) => { draft.incomingAnchor = e.target.value })} rows={2} /></label>
          <label>尾帧承接<textarea value={shot.outgoingAnchor} onChange={(e) => plan(index, (draft) => { draft.outgoingAnchor = e.target.value })} rows={2} /></label>
          <label>台词提示<input value={shot.dialogueCue} onChange={(e) => plan(index, (draft) => { draft.dialogueCue = e.target.value })} /></label>
        </div>)}
      </section>
      <button className={styles.save} onClick={() => setEditorOpen(false)}>保存编辑</button>
    </aside>
  )
}
