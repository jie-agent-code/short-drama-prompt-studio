'use client'

import { STYLE_PRESETS } from '../lib/prompt/style-presets'
import { useStudioContext } from './studio-context'
import styles from './style-preset-selector.module.css'

export default function StylePresetSelector() {
  const { stylePresetId, setStylePresetId, activeStylePreset } = useStudioContext()
  const active = STYLE_PRESETS.find((preset) => preset.id === stylePresetId) || STYLE_PRESETS[0]
  // 只有服务端回传过同一个预设，才能确认它真的进入了 API 和最终提示词。
  const applied = activeStylePreset?.id === active.id
  return <section className={`${styles.panel} ${styles.inline}`} aria-label="风格预设选择">
    <label htmlFor="style-preset">风格预设</label>
    <select id="style-preset" value={stylePresetId} onChange={(event) => setStylePresetId(event.target.value)}>
      {STYLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select>
    <p>{active.description}</p>
    <span className={styles.badge}>
      {applied ? `已生效：${active.name} 已写入最后一次生成的提示词` : '未生效：修改后需重新点击生成'}
    </span>
  </section>
}
