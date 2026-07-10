import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Minus, SquareMenu } from 'lucide-react'
import type { ReadFileResult } from '@shared/types'
import { useFileViewerStore } from '../stores/fileViewer'

/** monaco 较重且有 worker 副作用——懒加载，避免无打开文件时挂载、也避免测试环境引入。 */
const LazyMonaco = lazy(() =>
  import('./MonacoViewer').then((m) => ({ default: m.MonacoViewer }))
)

interface FileViewerProps {
  /** 只读读取注入点（默认走 window.klarit.readFile，测试可替换）。 */
  readFile?: (path: string) => Promise<ReadFileResult>
  /** 文本内容渲染注入点（默认 monaco，测试可替换为轻量替身）。 */
  renderText?: (value: string, path: string) => React.ReactNode
}

function Placeholder({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-stone-600">
      {children}
    </div>
  )
}

function renderContent(
  result: ReadFileResult | undefined,
  path: string,
  renderText: (value: string, path: string) => React.ReactNode,
  t: (key: string, opts?: Record<string, unknown>) => string
): React.ReactNode {
  if (!result) return <Placeholder>{t('common.loading')}</Placeholder>
  switch (result.kind) {
    case 'text':
      return renderText(result.content, path)
    case 'binary':
      return <Placeholder>{t('fileViewer.binaryNotPreviewable')}</Placeholder>
    case 'too-large':
      return <Placeholder>{t('fileViewer.tooLarge')}</Placeholder>
    case 'error':
      return <Placeholder>{t('fileViewer.openError', { message: result.message })}</Placeholder>
  }
}

const defaultRenderText = (value: string, path: string): React.ReactNode => (
  <Suspense fallback={<DefaultRenderTextFallback />}>
    <LazyMonaco value={value} path={path} />
  </Suspense>
)

function DefaultRenderTextFallback(): React.JSX.Element {
  const { t } = useTranslation()
  return <Placeholder>{t('common.loading')}</Placeholder>
}

/**
 * 带蒙层的浮层文件查看器：订阅 useFileViewerStore，渲染标签页 + 只读内容；
 * 可最小化到主窗口底栏、整体关闭。无打开文件时不渲染。
 */
export function FileViewer({
  readFile = (p) => window.klarit.readFile(p),
  renderText = defaultRenderText
}: FileViewerProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const tabs = useFileViewerStore((s) => s.tabs)
  const activePath = useFileViewerStore((s) => s.activePath)
  const popupOpen = useFileViewerStore((s) => s.popupOpen)
  const setActive = useFileViewerStore((s) => s.setActive)
  const closeTab = useFileViewerStore((s) => s.closeTab)
  const minimize = useFileViewerStore((s) => s.minimize)
  const toggle = useFileViewerStore((s) => s.toggle)
  const closeAll = useFileViewerStore((s) => s.closeAll)

  // 已读内容按路径缓存，切回标签不重复读盘；version 触发重渲染。
  const cache = useRef<Record<string, ReadFileResult>>({})
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!activePath || cache.current[activePath]) return
    let alive = true
    readFile(activePath).then((r) => {
      if (!alive) return
      cache.current[activePath] = r
      setVersion((v) => v + 1)
    })
    return () => {
      alive = false
    }
  }, [activePath, readFile])

  const showPopup = popupOpen && tabs.length > 0

  return (
    <>
      {/* 浮层区：限定在底栏之上、主面板区之内（top-0 ~ 底栏顶）。蒙层不覆盖侧边栏、也不覆盖底栏。 */}
      {showPopup && (
        <div className="absolute inset-x-0 bottom-7 top-0">
          {/* 蒙层：点空白处收起浮层（底栏与标签保留）。panel 层级更高，点 panel 不触发此处。 */}
          <div
            data-testid="viewer-scrim"
            aria-label={t('fileViewer.collapse')}
            onClick={minimize}
            className="absolute inset-0 z-40 bg-ink-deep/40"
          />
          <div className="absolute left-1/2 top-1/2 z-50 flex h-[92%] w-[88%] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card border border-stone-300 bg-canvas">
            <div className="flex items-center border-b border-stone-100">
          <div role="tablist" className="flex min-w-0 flex-1 items-center overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.path === activePath
              return (
                <div
                  key={tab.path}
                  className={`flex shrink-0 items-center gap-1 border-r border-stone-100 pl-3 pr-1 ${active ? 'bg-stone-100' : ''}`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActive(tab.path)}
                    className={`max-w-[200px] truncate py-2 text-[13px] ${active ? 'text-ink' : 'text-stone-600 hover:text-ink'}`}
                  >
                    {tab.name}
                  </button>
                  <button
                    type="button"
                    aria-label={t('fileViewer.closeTab', { name: tab.name })}
                    onClick={() => closeTab(tab.path)}
                    className="flex h-5 w-5 items-center justify-center rounded text-stone-600 hover:bg-stone-300 hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex shrink-0 items-center gap-1 px-1">
            <button
              type="button"
              aria-label={t('fileViewer.minimize')}
              onClick={minimize}
              className="flex h-7 w-7 items-center justify-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              aria-label={t('fileViewer.closeViewer')}
              onClick={closeAll}
              className="flex h-7 w-7 items-center justify-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </div>
            <div className="min-h-0 flex-1 overflow-auto bg-paper">
              {activePath && renderContent(cache.current[activePath], activePath, renderText, t)}
            </div>
          </div>
        </div>
      )}

      {/* 常驻底栏（任务栏）：始终显示、限定主面板区、不被蒙层覆盖；与浮层共存。
          有打开文件时左侧给出 square-menu + 数量入口，点击在展开/收起间切换。 */}
      <div className="absolute inset-x-0 bottom-0 z-[60] flex h-7 items-center border-t border-stone-100 bg-canvas px-1.5">
        {tabs.length > 0 && (
          <button
            type="button"
            aria-label={popupOpen ? t('fileViewer.collapse') : t('fileViewer.expand')}
            aria-pressed={popupOpen}
            onClick={toggle}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-stone-100 hover:text-ink ${popupOpen ? 'bg-stone-100 text-ink' : 'text-stone-600'}`}
          >
            <SquareMenu size={14} />
            <span className="tabular-nums">{tabs.length}</span>
          </button>
        )}
      </div>
    </>
  )
}
