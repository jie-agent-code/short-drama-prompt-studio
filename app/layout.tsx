import './globals.css'
import type { ReactNode } from 'react'
import ContinuityReview from './components/continuity-review'
import ScenePlannerPanel from './components/scene-planner-panel'
import { StudioProvider } from './components/studio-context'

export const metadata = { title: '短剧提示词工作台', description: '支持 10 秒与 6 秒镜头块协议的短剧分镜工作台' }

export default function RootLayout({ children }: { children: ReactNode }) {
  // 风格预设选择器改为在页面内联渲染（见 page.tsx），
  // 避免 fixed 浮层压住右上角的「模板库 / 百炼配置」按钮。
  return <html lang="zh-CN"><body><StudioProvider>{children}<ScenePlannerPanel /><ContinuityReview /></StudioProvider></body></html>
}
