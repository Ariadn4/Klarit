import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, MoreHorizontal, Trash2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { KlaritLogo } from './KlaritLogo'
import { WindowControls } from './WindowControls'

const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/** 项目所在文件夹：单仓即其 rootPath；多仓取首个成员路径（用于「在资源管理器中显示」）。 */
function projectPath(p: Project): string {
  return p.members[0]?.rootPath ?? ''
}

/** 上一级目录（清单里只显示父目录，避免与项目名重复）。 */
function parentDir(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const idx = Math.max(norm.lastIndexOf('\\'), norm.lastIndexOf('/'))
  return idx >= 0 ? norm.slice(0, idx + 1) : norm
}

interface ProjectRowProps {
  project: Project
  onOpen: (projectId: string) => void
  onReveal: (path: string) => void
  onRemove: (projectId: string) => void
}

function ProjectRow({ project, onOpen, onReveal, onRemove }: ProjectRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const path = projectPath(project)

  return (
    <div className="group relative flex items-center gap-2 px-2">
      <button
        type="button"
        onClick={() => onOpen(project.id)}
        className="flex min-w-0 flex-1 flex-col items-start rounded px-2 py-2 text-left hover:bg-stone-100"
      >
        <span className="w-full truncate text-[13px] text-ink">{project.displayName}</span>
        <span className="w-full truncate text-[11px] text-stone-600">{parentDir(path)}</span>
      </button>

      <div className="relative shrink-0">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('manageProjects.moreActions')}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded text-stone-600 opacity-0 hover:bg-stone-100 hover:text-ink group-hover:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontal size={16} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-card border border-stone-100 bg-canvas py-1 shadow-sm"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                onReveal(path)
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-[13px] text-ink hover:bg-stone-100"
            >
              <FolderOpen size={14} className="shrink-0 text-stone-600" />
              {t('manageProjects.revealInExplorer')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                onRemove(project.id)
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-[13px] text-ink hover:bg-stone-100"
            >
              <Trash2 size={14} className="shrink-0 text-stone-600" />
              {t('manageProjects.removeFromList')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function ManageProjectsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<Project[]>([])
  const [version, setVersion] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setProjects(await window.klarit.listProjects())
  }, [])

  useEffect(() => {
    refresh()
    window.klarit.getAppVersion().then(setVersion)
  }, [refresh])

  const onOpen = useCallback((projectId: string) => {
    // 主进程负责统一落点并关闭本管理窗口。
    window.klarit.openProjectFromManage(projectId)
  }, [])

  const onReveal = useCallback((path: string) => {
    if (path) window.klarit.showItemInFolder(path)
  }, [])

  const onRemove = useCallback(async (projectId: string) => {
    const next = await window.klarit.removeProject(projectId)
    setProjects(next)
  }, [])

  const onOpenLocal = useCallback(async () => {
    // 含多子仓的目录也直接组建多仓项目；成功则主进程已打开项目并关闭本窗口，取消/失败无操作。
    await window.klarit.importProjectFromManage()
  }, [])

  return (
    <div className="flex h-full bg-paper">
      <aside className="flex w-60 shrink-0 flex-col border-r border-stone-100 bg-canvas">
        <div className="min-h-0 flex-1 overflow-auto py-2">
          {projects.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-stone-600">{t('manageProjects.emptyList')}</p>
          ) : (
            projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                onOpen={onOpen}
                onReveal={onReveal}
                onRemove={onRemove}
              />
            ))
          )}
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-8">
        {/* 顶部可拖动条；右上角自绘窗口控制按钮。 */}
        <div style={DRAG} className="absolute inset-x-0 top-0 flex h-11 items-center justify-end">
          <WindowControls />
        </div>
        <div className="flex flex-col items-center gap-3">
            <KlaritLogo size={64} />
            <div className="text-center">
              <div className="text-lg font-semibold text-ink">Klarit</div>
              {version && (
                <div className="mt-0.5 text-[13px] text-stone-600">
                  {t('manageProjects.version', { version })}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              style={NO_DRAG}
              onClick={onOpenLocal}
              className="flex items-center gap-2 rounded-card bg-cobalt-500 px-4 py-2 text-[13px] text-white hover:bg-cobalt-600"
            >
              <FolderOpen size={16} />
              {t('manageProjects.openLocal')}
            </button>
          </div>
        </main>
    </div>
  )
}
