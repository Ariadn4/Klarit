import { useState } from 'react'
import { Check, ChevronsUpDown, FolderPlus, Library } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Project } from '@shared/types'

interface ProjectSwitcherProps {
  current: Project | null
  projects: Project[]
  onSelect: (projectId: string) => void
  onImport: () => void
  /** 「管理项目…」入口：打开管理项目窗口。 */
  onManage?: () => void
}

export function ProjectSwitcher({
  current,
  projects,
  onSelect,
  onImport,
  onManage
}: ProjectSwitcherProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // 从未导入任何项目 → 显示「导入新项目」。
  if (projects.length === 0) {
    return (
      <button
        type="button"
        onClick={onImport}
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-[13px] text-cobalt-500 hover:bg-stone-100"
      >
        <FolderPlus size={16} />
        {t('projectSwitcher.importNew')}
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-[13px] text-ink hover:bg-stone-100"
      >
        <ChevronsUpDown size={14} className="shrink-0 text-stone-600" />
        <span className="truncate">{current?.displayName ?? t('projectSwitcher.selectProject')}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-card border border-stone-100 bg-canvas py-1 shadow-sm"
        >
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.id === current?.id}
              onClick={() => {
                setOpen(false)
                onSelect(p.id)
              }}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[13px] text-ink hover:bg-stone-100"
            >
              <span className="truncate">{p.displayName}</span>
              {p.id === current?.id && <Check size={14} className="shrink-0 text-cobalt-500" />}
            </button>
          ))}
          <div className="my-1 border-t border-stone-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onManage?.()
            }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-[13px] text-ink hover:bg-stone-100"
          >
            <Library size={14} />
            {t('projectSwitcher.manageProjects')}
          </button>
        </div>
      )}
    </div>
  )
}
