'use client'

import { DURATION_MODES } from '../lib/prompt/duration-modes'
import { useStudioContext } from './studio-context'
import styles from './style-preset-selector.module.css'

/**
 * 镜头时长模式选择器。
 *
 * 切换会清空镜头规划——每镜秒数、时间块、镜头数、是否承接尾帧全都变了，
 * 保留旧规划等于把 10 秒的镜头挂在 6 秒模式上。
 */
export default function DurationModeSelector() {
  const { durationModeId, setDurationModeId, activeDurationMode } = useStudioContext()
  return <section className={`${styles.panel} ${styles.inline}`} aria-label="镜头时长模式选择">
    <label htmlFor="duration-mode">镜头时长</label>
    <select id="duration-mode" value={durationModeId} onChange={(event) => setDurationModeId(event.target.value as typeof durationModeId)}>
      {DURATION_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
    </select>
    <p>{activeDurationMode.description}</p>
    <span className={styles.badge}>
      {activeDurationMode.chained
        ? '镜头之间承接尾帧，可直接拼接'
        : '不做尾帧承接，由后期硬切衔接'}
    </span>
  </section>
}
