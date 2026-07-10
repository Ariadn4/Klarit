import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, FolderGit2, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitBranches, GitWorktree, Project, SidebarViewState } from '@shared/types'
import { FileTree } from './FileTree'

interface GitViewProps {
  current: Project | null
  viewState: SidebarViewState
  onChangeViewState: (next: SidebarViewState) => void
  refreshKey: number
}

const NO_BRANCHES: GitBranches = { current: null, branches: [] }

/**
 * 侧边栏 git 视图（只读预览器）：顶部成员仓 + 分支选择器，下方展示所选分支对应 worktree 目录的文件树。
 * 切成员仓/分支只换「预览哪个目录」，不执行任何 git 写命令。
 */
export function GitView({
  current,
  viewState,
  onChangeViewState,
  refreshKey
}: GitViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const members = current?.members ?? []
  // 校验持久化选择：失效（成员不存在）则回退到首个成员仓。
  const member = members.find((m) => m.id === viewState.gitMemberId) ?? members[0] ?? null
  const hasGit = member != null && member.git != null && !member.gitless

  const [branches, setBranches] = useState<GitBranches>(NO_BRANCHES)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [openMenu, setOpenMenu] = useState<'member' | 'branch' | null>(null)

  useEffect(() => {
    if (!member || !hasGit) {
      setBranches(NO_BRANCHES)
      setWorktrees([])
      return
    }
    let alive = true
    window.klarit.listBranches(member.rootPath).then((b) => {
      if (alive) setBranches(b)
    })
    window.klarit.listWorktrees(member.rootPath).then((w) => {
      if (alive) setWorktrees(w.worktrees)
    })
    return () => {
      alive = false
    }
  }, [member, hasGit, refreshKey])

  // 校验持久化分支：失效（不在本地分支列表）则回退到当前分支或首个分支。
  const effectiveBranch =
    viewState.gitBranch && branches.branches.includes(viewState.gitBranch)
      ? viewState.gitBranch
      : (branches.current ?? branches.branches[0] ?? null)
  const worktreePath = worktrees.find((w) => w.branch === effectiveBranch)?.path ?? null

  // 让主进程监听当前预览的 worktree 目录（随磁盘变更刷新）；卸载/无目录时取消监听。
  useEffect(() => {
    window.klarit.setGitWatchPath(worktreePath)
    return () => {
      window.klarit.setGitWatchPath(null)
    }
  }, [worktreePath])

  const selectMember = (memberId: string): void => {
    setOpenMenu(null)
    // 换仓时清空分支选择，让新仓按其当前分支重新解析。
    onChangeViewState({ view: 'git', gitMemberId: memberId, gitBranch: null })
  }

  const selectBranch = (branch: string): void => {
    setOpenMenu(null)
    onChangeViewState({ view: 'git', gitMemberId: member?.id ?? null, gitBranch: branch })
  }

  if (!member) {
    // 根容器仍占满高度，底部「选择项目」条才会被顶到底（与文件树视图一致）。
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="px-3 py-4 text-[13px] text-stone-600">{t('gitView.noMembers')}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex items-center justify-between gap-1 border-b border-stone-100 px-1 py-1">
        <button
          type="button"
          onClick={() => setOpenMenu((m) => (m === 'member' ? null : 'member'))}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'member'}
          aria-label={t('gitView.switchMemberAria', { name: member.derivedName })}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[13px] text-ink hover:bg-stone-100"
        >
          <FolderGit2 size={14} className="shrink-0 text-stone-600" />
          <span className="truncate font-medium">{member.derivedName}</span>
          <ChevronsUpDown size={12} className="shrink-0 text-stone-600" />
        </button>

        {hasGit && (
          <button
            type="button"
            onClick={() => setOpenMenu((m) => (m === 'branch' ? null : 'branch'))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'branch'}
            aria-label={t('gitView.switchBranchAria', { branch: effectiveBranch ?? '—' })}
            className="flex min-w-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs text-stone-600 hover:bg-stone-100"
          >
            <GitBranch size={11} className="shrink-0" />
            <span className="truncate">{effectiveBranch ?? '—'}</span>
            <ChevronsUpDown size={11} className="shrink-0" />
          </button>
        )}

        {openMenu === 'member' && (
          <div
            role="menu"
            className="absolute left-1 top-full z-10 mt-1 w-56 overflow-hidden rounded-card border border-stone-100 bg-canvas py-1 shadow-sm"
          >
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={m.id === member.id}
                onClick={() => selectMember(m.id)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[13px] text-ink hover:bg-stone-100"
              >
                <span className="truncate">{m.derivedName}</span>
                {m.id === member.id && <Check size={14} className="shrink-0 text-cobalt-500" />}
              </button>
            ))}
          </div>
        )}

        {openMenu === 'branch' && (
          <div
            role="menu"
            className="absolute right-1 top-full z-10 mt-1 w-56 overflow-hidden rounded-card border border-stone-100 bg-canvas py-1 shadow-sm"
          >
            {branches.branches.map((b) => (
              <button
                key={b}
                type="button"
                role="menuitemradio"
                aria-checked={b === effectiveBranch}
                onClick={() => selectBranch(b)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[13px] text-ink hover:bg-stone-100"
              >
                <span className="truncate">{b}</span>
                {b === effectiveBranch && <Check size={14} className="shrink-0 text-cobalt-500" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!hasGit ? (
          <p className="px-3 py-4 text-[13px] text-stone-600">{t('gitView.noGit')}</p>
        ) : worktreePath ? (
          <FileTree rootPath={worktreePath} refreshKey={refreshKey} />
        ) : (
          <p className="px-3 py-4 text-[13px] text-stone-600">{t('gitView.noWorktree')}</p>
        )}
      </div>
    </div>
  )
}
