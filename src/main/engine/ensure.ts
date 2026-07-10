/**
 * 引擎执行器的核心:把每个引擎操作建成**幂等的 ensure 调谐器**——先探测 git/fs 实际状态,
 * 已达目标即 no-op,否则补齐(reconcile-by-probe)。对「目标已达 / 未达 / 半成品残留」三态都安全收敛。
 * 这让恢复变成「重跑当前阶段即收敛」,无需写前日志。
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { listBranches, listWorktrees, type GitRunner } from '../git'
import {
  addWorktree,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  forceDeleteBranch,
  mergeBranch,
  pushBranch,
  removeWorktree,
  type AsyncGitRunner
} from '../git-write'
import { linkJunction, readJunction, unlinkReparsePoints } from '../junction'

/** ensure 调谐器运行所需的上下文(均绑定到主仓 repoPath)。 */
export interface EnsureContext {
  repoPath: string
  /** 异步写运行器(绑定 repoPath)。 */
  run: AsyncGitRunner
  /** 同步只读运行器(绑定 repoPath),供 listBranches/listWorktrees 探测。 */
  read: GitRunner
  remote: string
}

/** 一次 ensure 的结果:目标是否达成 + 失败归类(供决策路由)+ 详情。 */
export interface EnsureResult {
  done: boolean
  outcome: string
  detail: string
}

const reached = (): EnsureResult => ({ done: true, outcome: 'noop', detail: '' })
const ok = (): EnsureResult => ({ done: true, outcome: 'success', detail: '' })
const failed = (outcome: string, detail: string): EnsureResult => ({ done: false, outcome, detail })

/** 路径归一比较(Windows 大小写不敏感、统一分隔符)。 */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => resolve(p).replace(/\\/g, '/').toLowerCase()
  return norm(a) === norm(b)
}

/** ensure 分支存在于期望基点(已存在即认领)。 */
export async function ensureBranch(
  ctx: EnsureContext,
  branch: string,
  base = 'HEAD'
): Promise<EnsureResult> {
  if (listBranches(ctx.repoPath, ctx.read).branches.includes(branch)) return reached()
  const r = await createBranch(ctx.run, branch, base)
  return r.ok ? ok() : failed(r.outcome, r.detail)
}

/** ensure 该分支在期望路径有 worktree(残留登记先 prune,失效/错配先移除再重加)。 */
export async function ensureWorktree(
  ctx: EnsureContext,
  worktreePath: string,
  branch: string
): Promise<EnsureResult> {
  await ctx.run(['worktree', 'prune'])
  const existing = listWorktrees(ctx.repoPath, ctx.read).worktrees.find((w) =>
    samePath(w.path, worktreePath)
  )
  if (existing && existing.branch === branch && existsSync(worktreePath)) return reached()
  // 登记在但分支不对 / 目录失效 → 先移除登记(强制),再重加。
  if (existing) await removeWorktree(ctx.run, worktreePath, { force: true })
  const r = await addWorktree(ctx.run, worktreePath, branch)
  if (r.outcome === 'noop') return reached()
  return r.ok ? ok() : failed(r.outcome, r.detail)
}

/** ensure 关联环境的各 junction 存在且指向正确(指向错先解再链;目标不存在报 no-target)。 */
export async function ensureJunction(
  worktreePath: string,
  links: Array<{ target: string; mountPath: string }>
): Promise<EnsureResult> {
  for (const { target, mountPath } of links) {
    const full = resolve(worktreePath, mountPath)
    const cur = await readJunction(full)
    if (cur && samePath(cur, target)) continue
    if (cur) await unlinkReparsePoints(full).catch(() => {})
    if (!existsSync(target)) return failed('no-target', `关联目标不存在:${target}`)
    try {
      await linkJunction(target, full)
    } catch (e) {
      return failed('error', String(e))
    }
  }
  return links.length ? ok() : reached()
}

/** ensure from 已并入 into(在 into 上合并;在途合并由 mergeBranch 内部 abort;冲突报 conflict)。 */
export async function ensureMerged(
  ctx: EnsureContext,
  from: string,
  into: string
): Promise<EnsureResult> {
  await ctx.run(['checkout', into])
  const anc = await ctx.run(['merge-base', '--is-ancestor', from, into])
  if (anc.code === 0) return reached()
  const r = await mergeBranch(ctx.run, from)
  if (r.outcome === 'noop') return reached()
  return r.ok ? ok() : failed(r.outcome, r.detail)
}

/** ensure 远端分支已是本地 HEAD(已一致即 noop;非快进/无远端为终局失败)。 */
export async function ensurePushed(
  ctx: EnsureContext,
  branch: string,
  opts: { force?: boolean; pullFirst?: boolean } = {}
): Promise<EnsureResult> {
  if (opts.pullFirst) {
    await ctx.run(['fetch', ctx.remote])
    await ctx.run(['rebase', `${ctx.remote}/${branch}`, branch])
  }
  if (opts.force) {
    const f = await ctx.run(['push', '--force-with-lease', ctx.remote, branch])
    return f.code === 0 ? ok() : failed('non-fast-forward', f.stderr || f.stdout)
  }
  const r = await pushBranch(ctx.run, ctx.remote, branch)
  return r.ok ? ok() : failed(r.outcome, r.detail)
}

/** ensure 该路径无 worktree(删前防御性解 junction,见 removeWorktree)。 */
export async function ensureNoWorktree(
  ctx: EnsureContext,
  worktreePath: string,
  opts: { force?: boolean } = {}
): Promise<EnsureResult> {
  await ctx.run(['worktree', 'prune'])
  const present = listWorktrees(ctx.repoPath, ctx.read).worktrees.some((w) =>
    samePath(w.path, worktreePath)
  )
  if (!present && !existsSync(worktreePath)) {
    // 即便目录已不在,仍兜一手 prune 清残留登记。
    return reached()
  }
  const r = await removeWorktree(ctx.run, worktreePath, { force: opts.force })
  if (r.outcome === 'noop') return reached()
  return r.ok ? ok() : failed(r.outcome, r.detail)
}

/** ensure 本地分支不存在(仍被 worktree 检出则级联先清 worktree;未合并安全删被拒报 not-merged)。 */
export async function ensureNoBranch(
  ctx: EnsureContext,
  branch: string,
  opts: { force?: boolean } = {}
): Promise<EnsureResult> {
  if (!listBranches(ctx.repoPath, ctx.read).branches.includes(branch)) return reached()
  // 级联:清掉任何检出该分支的 worktree。**沿用调用方的 force 意向、不硬编码 force**——
  // 默认(非 force)时 worktree 若脏(含未提交改动)则 removeWorktree 拒删,失败在此冒泡为可见停点,
  // 保护未提交工作(GC 安全红线);用户显式选「仍然删除」(opts.force)才 --force 越过。
  const holders = listWorktrees(ctx.repoPath, ctx.read).worktrees.filter((w) => w.branch === branch)
  for (const w of holders) {
    const wr = await ensureNoWorktree(ctx, w.path, { force: opts.force })
    if (!wr.done) return wr
  }
  const r = opts.force
    ? await forceDeleteBranch(ctx.run, branch)
    : await deleteBranch(ctx.run, branch)
  return r.ok ? ok() : failed(r.outcome, r.detail)
}

/** ensure 远端分支不存在(已不在即 noop)。 */
export async function ensureNoRemoteBranch(
  ctx: EnsureContext,
  branch: string
): Promise<EnsureResult> {
  const r = await deleteRemoteBranch(ctx.run, ctx.remote, branch)
  return r.ok ? ok() : failed(r.outcome, r.detail)
}
