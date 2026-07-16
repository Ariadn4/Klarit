import { describe, it, expect } from 'vitest'
import type { AsyncGitRunner, GitResult } from './git-write'
import { branchCleanupInfo, recycleCardBranches, type CleanupMember } from './card-cleanup'

const OK: GitResult = { code: 0, stdout: '', stderr: '' }
const FAIL = (stderr: string): GitResult => ({ code: 1, stdout: '', stderr })

function member(over: Partial<CleanupMember> = {}): CleanupMember {
  return {
    memberId: 'web',
    name: 'web',
    repoPath: '/repo/web',
    branch: 'add-thing',
    worktreePath: '/repo/web--wt--add-thing',
    baseBranch: 'main',
    ...over
  }
}

/** 假 runner：按 (repoPath, 首参) 路由到脚本化响应；记录调用供断言。 */
function fakeGit(script: (dir: string, args: string[]) => GitResult): {
  runner: (dir: string) => AsyncGitRunner
  calls: Array<{ dir: string; args: string[] }>
} {
  const calls: Array<{ dir: string; args: string[] }> = []
  return {
    calls,
    runner: (dir) => async (args) => {
      calls.push({ dir, args })
      return script(dir, args)
    }
  }
}

describe('branchCleanupInfo（算合并状态与 worktree 存在）', () => {
  it('分支存在 + 已合并 + worktree 在', async () => {
    const g = fakeGit((_dir, args) => {
      if (args[0] === 'rev-parse') return OK // 分支存在
      if (args[0] === 'merge-base') return OK // is-ancestor 成功 = 已合并
      return OK
    })
    const info = await branchCleanupInfo([member()], { runner: g.runner, exists: () => true })
    expect(info[0]).toMatchObject({ branch: 'add-thing', branchExists: true, worktreeExists: true, merged: true })
  })

  it('分支存在但未合并 → merged=false', async () => {
    const g = fakeGit((_dir, args) => {
      if (args[0] === 'rev-parse') return OK
      if (args[0] === 'merge-base') return FAIL('not ancestor') // 非祖先 = 未合并
      return OK
    })
    const info = await branchCleanupInfo([member()], { runner: g.runner, exists: () => false })
    expect(info[0]).toMatchObject({ branchExists: true, worktreeExists: false, merged: false })
  })

  it('分支不存在 → 不查合并、merged=false', async () => {
    const g = fakeGit((_dir, args) => (args[0] === 'rev-parse' ? FAIL('unknown revision') : OK))
    const info = await branchCleanupInfo([member()], { runner: g.runner, exists: () => false })
    expect(info[0].branchExists).toBe(false)
    expect(info[0].merged).toBe(false)
    // 未查 merge-base（分支不存在时跳过）
    expect(g.calls.some((c) => c.args[0] === 'merge-base')).toBe(false)
  })
})

describe('recycleCardBranches（删 worktree + 分支）', () => {
  it('已合并分支：删 worktree（force）后安全删分支', async () => {
    const g = fakeGit((_dir, args) => {
      if (args[0] === 'worktree' && args[1] === 'remove') return OK
      if (args[0] === 'worktree' && args[1] === 'prune') return OK
      if (args[0] === 'branch' && args[1] === '-d') return OK // 安全删成功
      return OK
    })
    const res = await recycleCardBranches([member()], { runner: g.runner, exists: () => true }, { allowUnmerged: false })
    expect(res[0]).toMatchObject({ worktree: 'removed', branch_: 'safe' })
    // worktree remove 带 --force
    expect(g.calls.some((c) => c.args.includes('remove') && c.args.includes('--force'))).toBe(true)
    // 先 worktree 后 branch
    const wtIdx = g.calls.findIndex((c) => c.args[1] === 'remove')
    const brIdx = g.calls.findIndex((c) => c.args[0] === 'branch')
    expect(wtIdx).toBeLessThan(brIdx)
  })

  it('未合并分支 + allowUnmerged=false → 保留分支（kept），不 force', async () => {
    const g = fakeGit((_dir, args) => {
      if (args[0] === 'worktree') return OK
      if (args[0] === 'branch' && args[1] === '-d') return FAIL('The branch is not fully merged')
      return OK
    })
    const res = await recycleCardBranches([member()], { runner: g.runner, exists: () => true }, { allowUnmerged: false })
    expect(res[0].branch_).toBe('kept')
    expect(g.calls.some((c) => c.args.includes('-D'))).toBe(false) // 没强删
  })

  it('未合并分支 + allowUnmerged=true → 强删（forced，-D）', async () => {
    const g = fakeGit((_dir, args) => {
      if (args[0] === 'worktree') return OK
      if (args[0] === 'branch' && args[1] === '-d') return FAIL('The branch is not fully merged')
      if (args[0] === 'branch' && args[1] === '-D') return OK
      return OK
    })
    const res = await recycleCardBranches([member()], { runner: g.runner, exists: () => true }, { allowUnmerged: true })
    expect(res[0].branch_).toBe('forced')
    expect(g.calls.some((c) => c.args.includes('-D'))).toBe(true)
  })

  it('多成员各自回收', async () => {
    const g = fakeGit((_dir, args) => {
      if (args[0] === 'branch' && args[1] === '-d') return OK
      return OK
    })
    const res = await recycleCardBranches(
      [member({ memberId: 'web', repoPath: '/r/web' }), member({ memberId: 'api', repoPath: '/r/api', branch: 'add-thing' })],
      { runner: g.runner, exists: () => true },
      { allowUnmerged: false }
    )
    expect(res.map((r) => r.memberId)).toEqual(['web', 'api'])
    expect(res.every((r) => r.branch_ === 'safe')).toBe(true)
  })
})
