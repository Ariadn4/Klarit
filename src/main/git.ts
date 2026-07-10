import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { GitBranches, GitProbeResult, GitWorktrees } from '../shared/types'

/** 跑一条 git 子命令，成功返回 trim 后的 stdout，失败（非零退出）返回 null。 */
export type GitRunner = (args: string[]) => string | null

/** 真实 runner：在 dir 下调用系统 git。 */
export function makeGitRunner(dir: string): GitRunner {
  return (args) => {
    try {
      return execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
    } catch {
      return null
    }
  }
}

/**
 * 探测某目录的 git 状态。只要 `rev-parse --show-toplevel` 成功就视为有 git，
 * 无远程 / detached / 空仓库都不影响 isGit=true（仅 branch/remote 为 null）。
 */
export function probeGit(dir: string, run: GitRunner): GitProbeResult {
  const toplevel = run(['rev-parse', '--show-toplevel'])
  if (toplevel === null) {
    return { isGit: false, toplevel: null, commonDir: null, branch: null, remote: null }
  }
  const commonRaw = run(['rev-parse', '--git-common-dir'])
  // --git-common-dir 可能是相对 dir 的路径，统一解析为绝对路径作为多 worktree 归并键。
  const commonDir = commonRaw ? resolve(dir, commonRaw) : null
  const branchRaw = run(['branch', '--show-current'])
  const branch = branchRaw && branchRaw.length > 0 ? branchRaw : null
  const remoteRaw = run(['remote', 'get-url', 'origin'])
  const remote = remoteRaw && remoteRaw.length > 0 ? remoteRaw : null
  return { isGit: true, toplevel, commonDir, branch, remote }
}

/**
 * 列出某成员仓的**本地分支**（不含远端跟踪分支与 tag），并标记当前 HEAD 分支。
 * 只读查询；非 git 目录安全返回空。
 */
export function listBranches(_dir: string, run: GitRunner): GitBranches {
  const raw = run(['branch', '--format=%(refname:short)'])
  if (raw === null) return { current: null, branches: [] }
  const branches = raw
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
  const currentRaw = run(['branch', '--show-current'])
  const current = currentRaw && currentRaw.length > 0 ? currentRaw : null
  return { current, branches }
}

/**
 * 解析 `git worktree list --porcelain`，得到各 worktree 的目录与所在分支
 * （detached 时 branch 为 null）。只读查询；非 git 目录安全返回空。
 */
export function listWorktrees(_dir: string, run: GitRunner): GitWorktrees {
  const raw = run(['worktree', 'list', '--porcelain'])
  if (raw === null) return { worktrees: [] }
  const worktrees: GitWorktrees['worktrees'] = []
  let path: string | null = null
  let branch: string | null = null
  const flush = (): void => {
    if (path !== null) worktrees.push({ path, branch })
    path = null
    branch = null
  }
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch ')) {
      // 形如 `branch refs/heads/<name>`，取短名。
      branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    }
    // `detached` / `HEAD ...` / 其它行无需处理；空行作为块分隔由 worktree 行的 flush 处理。
  }
  flush()
  return { worktrees }
}
