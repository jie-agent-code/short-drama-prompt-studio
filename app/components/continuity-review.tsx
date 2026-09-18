'use client'

import { useStudioContext } from './studio-context'
import styles from './continuity-review.module.css'

export default function ContinuityReview() {
  const { auditReport: report, auditBefore: before, editorOpen } = useStudioContext()

  if (!report) return null
  // 关键修复：面板之前和场景卡编辑面板都用 right:24px/bottom:24px，互相完全遮挡。
  // 现在编辑面板打开时审核面板左移让位，两个浮层可以同时看到。
  const repairedCount = before ? Math.max(0, before.issues.length - report.issues.length) : 0

  return (
    <aside
      className={editorOpen ? `${styles.panel} ${styles.shifted}` : styles.panel}
      aria-live="polite"
    >
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CONTINUITY REVIEW</span>
          <h2>连续性审核</h2>
        </div>
      </div>
      <div className={styles.scoreRow}>
        <strong>{report.score}</strong>
        <span>/ 100<br />{report.passed ? '检查通过' : '仍有待处理项'}</span>
      </div>
      <div className={styles.summary}>
        <span>{report.issues.length ? `${report.issues.length} 项待关注` : '未发现连续性问题'}</span>
        {repairedCount > 0 && <b>已修正 {repairedCount} 项</b>}
      </div>
      <div className={styles.rules}>{report.checkedRules.slice(0, 5).map((rule) => <span key={rule}>✓ {rule}</span>)}</div>
      {report.issues.length > 0 && <div className={styles.issues}>{report.issues.slice(0, 4).map((issue) => <div key={`${issue.code}-${issue.shotId}`} className={styles.issue}><b>{issue.shotId}</b><span>{issue.message}<em className={styles.repair}>修正：{issue.repair}</em></span></div>)}</div>}
    </aside>
  )
}
