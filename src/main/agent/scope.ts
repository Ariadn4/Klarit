/**
 * 可写范围越界后置检测（纯分类 + git 还原/提交）。PTY-free 无头拉第三方 CLI 无法逐路径沙箱，故
 * **节点完成时后置检测**：比对改动集与**实际可写范围**（`writableScope ∪ 产出路径`；空＝整条分支可写），
 * 越界文件确定性还原到节点起始基线、范围内保留并提交。按每个目标仓各自成立。
 */

/** 归一路径分隔为 `/` 并去首部 `./`。 */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** 某相对路径是否落在一条可写范围条目内（目录前缀按段边界匹配，或精确文件相等）。 */
function within(file: string, scope: string): boolean {
  const f = norm(file)
  const s = norm(scope).replace(/\/+$/, '') // 去尾斜杠
  if (s === '' || s === '.') return true // 整条分支可写
  return f === s || f.startsWith(`${s}/`)
}

/** 改动集分类：范围内（可保留/提交）与越界（须还原）。`writableScope` 为空即整条分支可写。 */
export function classifyScope(
  changed: string[],
  writableScope: string[],
  outputPaths: string[]
): { inScope: string[]; outOfScope: string[] } {
  const scope = [...writableScope, ...outputPaths].map((s) => s.trim()).filter((s) => s !== '')
  const wholeBranch = writableScope.filter((s) => s.trim() !== '').length === 0
  const inScope: string[] = []
  const outOfScope: string[] = []
  for (const file of changed) {
    const ok = wholeBranch || scope.some((s) => within(file, s))
    ;(ok ? inScope : outOfScope).push(file)
  }
  return { inScope, outOfScope }
}

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AsyncGitRunner } from '../git-write'

/** 同步 git 读运行器（args → 成功时 trim 后 stdout，失败/非零退出返回 null）。同 `makeGitRunner`。 */
export type GitRead = (args: string[]) => string | null

export interface ScopeGuardResult {
  inScope: string[]
  outOfScope: string[]
  /** 提交范围内改动后的 commit SHA；无范围内改动则 null（不产空提交）。 */
  commitSha: string | null
}

function lines(s: string | null): string[] {
  return (s ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x !== '')
}

/**
 * 对一个目标仓 worktree 做越界后置检测 + 还原 + 提交：
 * 改动集 = 相对 `startSha` 的跟踪改动 ∪ 未跟踪新文件；越界文件还原到起始基线（起始存在→checkout、
 * 新文件→删除），范围内保留并提交（记 commitSha；无范围内改动跳过提交、不产空 commit）。
 */
export async function scopeGuard(opts: {
  worktree: string
  read: GitRead
  write: AsyncGitRunner
  startSha: string
  writableScope: string[]
  outputPaths: string[]
  message: string
}): Promise<ScopeGuardResult> {
  const { worktree, read, write, startSha, writableScope, outputPaths, message } = opts
  const tracked = lines(read(['diff', '--name-only', startSha]))
  const untracked = lines(read(['ls-files', '--others', '--exclude-standard']))
  const changed = Array.from(new Set([...tracked, ...untracked]))
  const { inScope, outOfScope } = classifyScope(changed, writableScope, outputPaths)

  // 还原越界：起始基线存在该文件 → checkout 还原；否则是新文件 → 删除。确定性撤销、不靠 agent 自觉。
  for (const f of outOfScope) {
    const existedAtStart = read(['cat-file', '-e', `${startSha}:${f}`]) !== null
    if (existedAtStart) await write(['checkout', startSha, '--', f])
    else rmSync(join(worktree, f), { force: true })
  }

  // 提交范围内改动（有则提交、记 SHA；无则不产空提交）。带显式身份以免仓未配 user.*。
  let commitSha: string | null = null
  if (inScope.length > 0) {
    await write(['add', '--', ...inScope])
    const staged = lines(read(['diff', '--cached', '--name-only']))
    if (staged.length > 0) {
      await write(['-c', 'user.name=Klarit Engine', '-c', 'user.email=engine@klarit.local', 'commit', '-m', message])
      commitSha = read(['rev-parse', 'HEAD'])
    }
  }
  return { inScope, outOfScope, commitSha }
}
