import { useState } from 'react'
import { ChevronRight, GitBranch, FolderGit2, AlertTriangle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RepoMember } from '@shared/types'
import { FileTree } from './FileTree'

interface RepoGroupProps {
  member: RepoMember
  refreshKey: number
  onUnlink: () => void
  onRelocate: () => void
}

/** 多仓项目里一个成员仓的可折叠分组：仓名 + 分支，内嵌该仓文件树；缺失时给复位/移除入口。 */
export function RepoGroup({ member, refreshKey, onUnlink, onRelocate }: RepoGroupProps): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  return (
    <section className="mb-1">
      <div className="group flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-stone-100"
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-stone-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <FolderGit2 size={14} className="shrink-0 text-cobalt-500" />
          <span className="truncate text-[13px] font-medium text-ink">{member.derivedName}</span>
          {member.git?.branch && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-stone-600">
              <GitBranch size={11} />
              {member.git.branch}
            </span>
          )}
          {member.missing && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-danger">
              <AlertTriangle size={11} />
              {t('repoGroup.missing')}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onUnlink}
          aria-label={t('repoGroup.unlinkAria', { name: member.derivedName })}
          title={t('repoGroup.unlinkTitle')}
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-100 hover:text-danger group-hover:flex"
        >
          <X size={13} />
        </button>
      </div>

      {expanded &&
        (member.missing ? (
          <MissingNotice onRelocate={onRelocate} onRemove={onUnlink} />
        ) : (
          <FileTree rootPath={member.rootPath} refreshKey={refreshKey} />
        ))}
    </section>
  )
}

interface MissingNoticeProps {
  onRemove: () => void
  /** 缺省则不显示「重新定位」（多仓项目目录暂不支持整体重定位）。 */
  onRelocate?: () => void
  message?: string
  removeLabel?: string
}

export function MissingNotice({
  onRemove,
  onRelocate,
  message,
  removeLabel
}: MissingNoticeProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mx-2 rounded-card border border-stone-100 bg-canvas px-2 py-2 text-xs text-stone-600">
      <p className="mb-1.5">{message ?? t('repoGroup.memberMissingMessage')}</p>
      <div className="flex gap-2">
        {onRelocate && (
          <button
            type="button"
            onClick={onRelocate}
            className="rounded px-2 py-1 text-cobalt-500 hover:bg-stone-100"
          >
            {t('repoGroup.relocate')}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="rounded px-2 py-1 text-stone-600 hover:bg-stone-100"
        >
          {removeLabel ?? t('repoGroup.removeFromProject')}
        </button>
      </div>
    </div>
  )
}
