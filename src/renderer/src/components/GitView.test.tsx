import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GitBranches, GitWorktrees, Project, RepoMember, SidebarViewState } from '@shared/types'
import { GitView } from './GitView'

interface KlaritStub {
  listDir: ReturnType<typeof vi.fn>
  listBranches: ReturnType<typeof vi.fn>
  listWorktrees: ReturnType<typeof vi.fn>
  setGitWatchPath: ReturnType<typeof vi.fn>
}

function installKlarit(over: Partial<KlaritStub> = {}): KlaritStub {
  const api: KlaritStub = {
    listDir: vi.fn(async () => []),
    listBranches: vi.fn(async (): Promise<GitBranches> => ({ current: 'main', branches: ['main'] })),
    listWorktrees: vi.fn(
      async (): Promise<GitWorktrees> => ({ worktrees: [{ path: '/repo', branch: 'main' }] })
    ),
    setGitWatchPath: vi.fn(async () => {}),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api
}

beforeEach(() => {
  installKlarit()
})

function member(id: string, over: Partial<RepoMember> = {}): RepoMember {
  return {
    id,
    idKind: 'uuid',
    derivedName: id,
    rootPath: `/${id}`,
    worktreePaths: [`/${id}`],
    git: { branch: 'main', remote: null, commonDir: `/${id}/.git` },
    gitless: false,
    ...over
  }
}

function project(members: RepoMember[]): Project {
  return { id: 'p', displayName: 'P', derivedName: 'P', members, createdAt: '', updatedAt: '' }
}

const noop = (): void => {}

function renderGitView(current: Project, viewState: SidebarViewState, onChange = noop) {
  return render(
    <GitView current={current} viewState={viewState} onChangeViewState={onChange} refreshKey={0} />
  )
}

const VS = (over: Partial<SidebarViewState> = {}): SidebarViewState => ({
  view: 'git',
  gitMemberId: null,
  gitBranch: null,
  ...over
})

describe('GitView 顶部展示', () => {
  it('展示当前成员仓名与当前分支', async () => {
    renderGitView(project([member('VibePM')]), VS({ gitMemberId: 'VibePM' }))
    expect(screen.getByRole('button', { name: /切换成员仓：VibePM/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /切换分支：main/ })).toBeInTheDocument()
    )
  })

  it('无成员仓空态根容器仍 flex-1（底部条被顶到底）', () => {
    const { container } = renderGitView(project([]), VS())
    expect(screen.getByText(/该项目暂无成员仓/)).toBeInTheDocument()
    expect(container.firstElementChild?.className).toContain('flex-1')
  })

  it('成员仓无 git：显示提示且不查询分支/worktree', async () => {
    const api = installKlarit()
    renderGitView(
      project([member('docs', { git: null, gitless: true })]),
      VS({ gitMemberId: 'docs' })
    )
    expect(screen.getByText(/该成员仓无 git/)).toBeInTheDocument()
    expect(api.listBranches).not.toHaveBeenCalled()
    expect(api.listWorktrees).not.toHaveBeenCalled()
  })
})

describe('GitView 成员仓切换', () => {
  it('点击成员仓名弹出列表（当前勾选），选择另一仓触发回写', async () => {
    const onChange = vi.fn()
    renderGitView(project([member('frontend'), member('backend')]), VS({ gitMemberId: 'frontend' }), onChange)
    await userEvent.click(screen.getByRole('button', { name: /切换成员仓：frontend/ }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: /frontend/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(screen.getByRole('menuitemradio', { name: /backend/ }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'git', gitMemberId: 'backend' })
    )
  })
})

describe('GitView 分支切换（只读）', () => {
  it('点击分支名弹出本地分支列表（当前勾选），选择另一分支只回写、不调用 git 写命令', async () => {
    const api = installKlarit({
      listBranches: vi.fn(async () => ({ current: 'main', branches: ['main', 'feature'] })),
      listWorktrees: vi.fn(async () => ({
        worktrees: [
          { path: '/repo', branch: 'main' },
          { path: '/repo-wt/feature', branch: 'feature' }
        ]
      }))
    })
    const onChange = vi.fn()
    renderGitView(project([member('repo')]), VS({ gitMemberId: 'repo', gitBranch: 'main' }), onChange)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /切换分支：main/ })).toBeInTheDocument()
    )
    await userEvent.click(screen.getByRole('button', { name: /切换分支：main/ }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: /^main/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(screen.getByRole('menuitemradio', { name: /feature/ }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'git', gitMemberId: 'repo', gitBranch: 'feature' })
    )
    // 只读：window.klarit 上不存在任何 git 写方法
    expect((api as unknown as Record<string, unknown>).checkoutBranch).toBeUndefined()
  })

  it('所选分支无对应 worktree：显示空态', async () => {
    installKlarit({
      listBranches: vi.fn(async () => ({ current: 'main', branches: ['main', 'orphan'] })),
      listWorktrees: vi.fn(async () => ({ worktrees: [{ path: '/repo', branch: 'main' }] }))
    })
    renderGitView(project([member('repo')]), VS({ gitMemberId: 'repo', gitBranch: 'orphan' }))
    await waitFor(() => expect(screen.getByText(/暂未创建 worktree/)).toBeInTheDocument())
  })
})

describe('GitView 监听当前 worktree', () => {
  it('解析出 worktree 路径后通知主进程监听该路径', async () => {
    const api = installKlarit({
      listWorktrees: vi.fn(async () => ({ worktrees: [{ path: '/repo-wt/feature', branch: 'main' }] }))
    })
    renderGitView(project([member('repo')]), VS({ gitMemberId: 'repo', gitBranch: 'main' }))
    await waitFor(() => expect(api.setGitWatchPath).toHaveBeenCalledWith('/repo-wt/feature'))
  })

  it('卸载时取消监听', async () => {
    const api = installKlarit()
    const { unmount } = renderGitView(project([member('repo')]), VS({ gitMemberId: 'repo' }))
    await waitFor(() => expect(api.setGitWatchPath).toHaveBeenCalled())
    unmount()
    expect(api.setGitWatchPath).toHaveBeenCalledWith(null)
  })
})
