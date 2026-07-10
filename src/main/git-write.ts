/**
 * git **写侧**:异步运行器 + 写侧四件套(建/删分支、加/删 worktree)+ 合并 + 推送。
 * 与只读同步 `git.ts` 并存(读侧走 `makeGitRunner`,写侧走这里)。每个原语返回**结构化结果**
 * `{ ok, outcome, detail }`,让上层 `engine` 的 ensure 调谐器据 outcome 判定「成功/已达期望态/失败原因」。
 * 运行器**不带取消信号**——引擎操作跑到底、不被中途打断(见 engine-execution 设计)。
 */

import { execFile } from 'node:child_process'
import { unlinkReparsePoints } from './junction'

/** 一条 git 子命令的结构化结果:退出码 + trim 后的标准输出/错误。 */
export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** 异步 git 运行器:在绑定目录下跑一条子命令,永不抛(失败以非零 code 表达)。 */
export type AsyncGitRunner = (args: string[]) => Promise<GitResult>

/** 真实异步 runner:在 dir 下调用系统 git,捕获 code/stdout/stderr 而不抛。 */
export function makeAsyncGitRunner(dir: string): AsyncGitRunner {
  return (args) =>
    new Promise<GitResult>((resolve) => {
      execFile(
        'git',
        args,
        { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const raw = err as (Error & { code?: number | string }) | null
          const code = typeof raw?.code === 'number' ? raw.code : raw ? 1 : 0
          resolve({ code, stdout: (stdout ?? '').trim(), stderr: (stderr ?? '').trim() })
        }
      )
    })
}

/** 写操作的归类结果——上层据此走幂等收敛与失败决策路由。 */
export type GitWriteOutcome =
  | 'success' // 施加了改动
  | 'noop' // 已处于期望态
  | 'conflict' // 合并冲突(已中止回干净态)
  | 'not-merged' // 安全删被拒(未合并)
  | 'non-fast-forward' // 推送被拒(远端先行)
  | 'no-remote' // 无远端 / 无推送目标
  | 'auth' // 认证 / 权限失败
  | 'locked' // 目录/分支被占用
  | 'error' // 其它失败

export interface GitWriteResult {
  ok: boolean
  outcome: GitWriteOutcome
  detail: string
}

const ok = (outcome: GitWriteOutcome, detail = ''): GitWriteResult => ({
  ok: outcome === 'success' || outcome === 'noop',
  outcome,
  detail
})

/** 把一条失败命令的输出归类(小写匹配 git 文案),给不出明确归类时回落 error。 */
function classify(r: GitResult, map: Array<[GitWriteOutcome, string[]]>): GitWriteResult {
  const hay = `${r.stdout}\n${r.stderr}`.toLowerCase()
  for (const [outcome, needles] of map) {
    if (needles.some((n) => hay.includes(n))) return ok(outcome, r.stderr || r.stdout)
  }
  return ok('error', r.stderr || r.stdout)
}

/** 建分支:在 base(默认 HEAD)创建 branch。已存在 → noop。 */
export async function createBranch(
  run: AsyncGitRunner,
  branch: string,
  base = 'HEAD'
): Promise<GitWriteResult> {
  const r = await run(['branch', branch, base])
  if (r.code === 0) return ok('success')
  return classify(r, [['noop', ['already exists']]])
}

/** 加 worktree:在 path 检出 branch。 */
export async function addWorktree(
  run: AsyncGitRunner,
  path: string,
  branch: string
): Promise<GitWriteResult> {
  const r = await run(['worktree', 'add', path, branch])
  if (r.code === 0) return ok('success')
  return classify(r, [
    ['noop', ['already exists', 'is already checked out']],
    ['locked', ['locked', 'permission denied']]
  ])
}

/**
 * 删 worktree:删前**无条件防御性解链**(解掉 path 内所有 reparse point,绝不递归进去),
 * 再 `worktree remove`,最后 `worktree prune` 清残留注册。已不在 → noop。
 */
export async function removeWorktree(
  run: AsyncGitRunner,
  path: string,
  opts: { force?: boolean } = {}
): Promise<GitWriteResult> {
  await unlinkReparsePoints(path)
  const args = ['worktree', 'remove', ...(opts.force ? ['--force'] : []), path]
  const r = await run(args)
  await run(['worktree', 'prune'])
  if (r.code === 0) return ok('success')
  const hay = `${r.stdout}\n${r.stderr}`.toLowerCase()
  if (hay.includes('is not a working tree') || hay.includes('no such')) return ok('noop')
  return classify(r, [
    ['locked', ['locked', 'permission denied', 'unable to remove']],
    ['error', ['contains modified or untracked']]
  ])
}

/** 删本地分支:安全删(`-d`,未合并即拒)。未合并 → not-merged;被 worktree 占用 → locked;不存在 → noop。 */
export async function deleteBranch(run: AsyncGitRunner, branch: string): Promise<GitWriteResult> {
  const r = await run(['branch', '-d', branch])
  if (r.code === 0) return ok('success')
  return classify(r, [
    ['not-merged', ['not fully merged']],
    ['locked', ['used by worktree', 'checked out at']],
    ['noop', ['not found', "couldn't find"]]
  ])
}

/** 强删本地分支(`-D`)——仅供上层据用户「仍然删除」决策显式调用。 */
export async function forceDeleteBranch(
  run: AsyncGitRunner,
  branch: string
): Promise<GitWriteResult> {
  const r = await run(['branch', '-D', branch])
  if (r.code === 0) return ok('success')
  return classify(r, [['noop', ['not found', "couldn't find"]]])
}

/**
 * 合并 from 到当前分支。**默认**冲突即 `merge --abort` 回干净态报 conflict;已合并报 noop。
 * `leaveConflict`（供 heal 用）:冲突时**不 abort**、保留 `MERGE_HEAD` 与工作区冲突标记、报 conflict——
 * 由上层交 heal agent 就地解决;此时**延迟中止**由上层负责(heal 失败/超限时补 abort 回干净态)。
 * 默认路径(不启用该参数)行为不变。
 */
export async function mergeBranch(
  run: AsyncGitRunner,
  from: string,
  opts: { leaveConflict?: boolean } = {}
): Promise<GitWriteResult> {
  const r = await run(['merge', '--no-edit', from])
  if (r.code === 0) {
    return /already up to date/i.test(r.stdout) ? ok('noop') : ok('success')
  }
  const hay = `${r.stdout}\n${r.stderr}`.toLowerCase()
  // 冲突判定以**未合并条目**(`ls-files -u`,语言无关)为准——兼容 git 文案本地化与空输出的失败;辅以文案兜底。
  const unmerged = await run(['ls-files', '-u'])
  const isConflict =
    unmerged.stdout.trim() !== '' || hay.includes('conflict') || hay.includes('automatic merge failed')
  // 保留冲突态模式:冲突不 abort,留 MERGE_HEAD 交上层 heal。非冲突的其它失败仍中止(不留脏索引)。
  if (opts.leaveConflict && isConflict) {
    return ok('conflict', r.stdout || r.stderr)
  }
  // 默认:任何失败都先中止,确保不留半合并脏索引。
  await run(['merge', '--abort'])
  if (isConflict) {
    return ok('conflict', r.stdout || r.stderr)
  }
  return ok('error', r.stderr || r.stdout)
}

/** 推送 branch 到 remote。非快进 → non-fast-forward;无远端/认证 → no-remote。 */
export async function pushBranch(
  run: AsyncGitRunner,
  remote: string,
  branch: string
): Promise<GitWriteResult> {
  const r = await run(['push', remote, branch])
  if (r.code === 0) return ok('success')
  return classify(r, [
    ['non-fast-forward', ['non-fast-forward', 'fetch first', 'rejected']],
    ['auth', ['authentication', 'permission denied', 'could not read username', 'terminal prompts disabled', 'repository not found']],
    ['no-remote', ['does not appear to be a git repository', 'no configured push destination', "'origin' does not appear", 'could not read from remote']]
  ])
}

/** 推送删除远端分支。远端已无该分支 → noop。 */
export async function deleteRemoteBranch(
  run: AsyncGitRunner,
  remote: string,
  branch: string
): Promise<GitWriteResult> {
  const r = await run(['push', remote, '--delete', branch])
  if (r.code === 0) return ok('success')
  return classify(r, [
    ['noop', ['remote ref does not exist', 'does not exist']],
    [
      'no-remote',
      ['could not read from remote', 'does not appear to be a git repository', 'authentication']
    ]
  ])
}
