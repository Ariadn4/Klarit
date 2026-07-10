import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ManageProjectsScreen } from './components/ManageProjectsScreen'
// i18n 单例:顶层 import 确保翻译运行时先于首帧渲染就绪(避免裸键/错语言闪烁)。
import './i18n'
// 自托管品牌字体（CSP font-src 'self'，不走外部 CDN）。字重对齐 docs/brand：Inter 400/500/600、JetBrains Mono 400/500。
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'

// 管理项目窗口与项目窗口共用同一入口，用 #manage hash 分流（见 main/index.ts createBrowserWindow）。
const isManage = window.location.hash === '#manage'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{isManage ? <ManageProjectsScreen /> : <App />}</StrictMode>
)
