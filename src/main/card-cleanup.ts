/**
 * 删卡的分支/worktree 回收（card-cleanup）：给删卡确认框算每条成员分支的**合并状态与 worktree 存在**，
 * 并在用户勾选「一并回收」时**删 worktree（force）+ 删分支**（复用 git-write 安全原语；未合并分支仅在
 * 用户显式允许时才 force 删）。纯逻辑注入 git 运行器与路径存在判定，供单测无盘验证。
 */

import type { BranchCleanupItem } from '../shared/types'
import type { AsyncGitRunner } from './git-write'
import { deleteBranch, forceDeleteBranch, removeWorktree } from './git-write'

/** 一个成员仓在某运行里的回收上下文（取自 MemberDerived + 显示名）。 */
export interface CleanupMember {
  memberId: string
  name: string
  repoPath: string
  branch: string
  worktreePath: string
  baseBranch: string
}

/** 注入依赖：按目录建 git 运行器 + 判目录存在（真实为 makeAsyncGitRunner / existsSync）。 */
export interface CleanupDeps {
  runner: (dir: string) => AsyncGitRunner
  exists: (path: string) => boolean
}

/** 分支本地是否存在（`rev-parse --verify` 成功即存在）。 */
async function branchExists(run: AsyncGitRunner, branch: string): Promise<boolean> {
  const r = await run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  return r.code === 0
}

/** 分支是否已合并进 base（branch 是 base 的祖先即其提交全在 base 里 = 已合并）。 */
async function isMerged(run: AsyncGitRunner, branch: string, base: string): Promise<boolean> {
  const r = await run(['merge-base', '--is-ancestor', branch, base])
  return r.code === 0
}

/** 算每条成员分支的合并状态与 worktree 存在，供删卡确认框展示。 */
export async function branchCleanupInfo(
  members: CleanupMember[],
  deps: CleanupDeps
): Promise<BranchCleanupItem[]> {
  const items: BranchCleanupItem[] = []
  for (const m of members) {
    const run = deps.runner(m.repoPath)
    const exists = await branchExists(run, m.branch)
    items.push({
      memberId: m.memberId,
      name: m.name,
      branch: m.branch,
      worktreePath: m.worktreePath,
      branchExists: exists,
      worktreeExists: deps.exists(m.worktreePath),
      merged: exists ? await isMerged(run, m.branch, m.baseBranch) : false
    })
  }
  return items
}

/** 一条分支的回收结果（供回报与测试断言）。 */
export interface BranchRecycleResult {
  memberId: string
  branch: string
  /** worktree 删除结果（noop=本就不在）。 */
  worktree: 'removed' | 'noop' | 'failed'
  /** 分支删除结果：safe=安全删；forced=未合并但按 allowUnmerged 强删；kept=未合并且未允许强删，保留；noop=本就不在。 */
  branch_: 'safe' | 'forced' | 'kept' | 'noop' | 'failed'
}

/**
 * 回收一张卡的全部成员分支：**先删 worktree（force）再删分支**（worktree 占用会挡分支删除）。
 * 分支安全删（`-d`）；遇未合并——`allowUnmerged` 为真则 force 删（`-D`），否则保留该分支不动。
 */
export async function recycleCardBranches(
  members: CleanupMember[],
  deps: CleanupDeps,
  opts: { allowUnmerged: boolean }
): Promise<BranchRecycleResult[]> {
  const results: BranchRecycleResult[] = []
  for (const m of members) {
    const run = deps.runner(m.repoPath)
    // 1) 删 worktree（force：删卡是终局意图，未提交改动一并丢）。
    const wt = await removeWorktree(run, m.worktreePath, { force: true })
    const worktree: BranchRecycleResult['worktree'] = wt.outcome === 'success' ? 'removed' : wt.outcome === 'noop' ? 'noop' : 'failed'
    // 2) 删分支：安全删；未合并按 allowUnmerged 决定强删或保留。
    let branch_: BranchRecycleResult['branch_']
    const del = await deleteBranch(run, m.branch)
    if (del.ok) branch_ = del.outcome === 'noop' ? 'noop' : 'safe'
    else if (del.outcome === 'not-merged') {
      if (opts.allowUnmerged) {
        const f = await forceDeleteBranch(run, m.branch)
        branch_ = f.ok ? 'forced' : 'failed'
      } else branch_ = 'kept'
    } else branch_ = 'failed'
    results.push({ memberId: m.memberId, branch: m.branch, worktree, branch_ })
  }
  return results
}
