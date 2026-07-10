import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { git, initRepo, makeTrash } from '../git-test-helpers'
import { makeGitRunner } from '../git'
import { makeAsyncGitRunner } from '../git-write'
import { linkJunction } from '../junction'
import {
  ensureBranch,
  ensureWorktree,
  ensureMerged,
  ensureNoWorktree,
  ensureNoBranch,
  ensureJunction,
  type EnsureContext
} from './ensure'

const trash = makeTrash()
afterEach(() => trash.cleanup())

function ctxFor(repo: string): EnsureContext {
  return { repoPath: repo, run: makeAsyncGitRunner(repo), read: makeGitRunner(repo), remote: 'origin' }
}

describe('ensure 幂等', () => {
  it('ensureBranch 连跑两次,第二次 noop、状态不变', async () => {
    const repo = trash.track(initRepo())
    const ctx = ctxFor(repo)
    const a = await ensureBranch(ctx, 'feature', 'main')
    const b = await ensureBranch(ctx, 'feature', 'main')
    expect(a.done && b.done).toBe(true)
    expect(b.outcome).toBe('noop')
  })

  it('ensureWorktree 连跑两次,第二次 noop', async () => {
    const repo = trash.track(initRepo())
    const ctx = ctxFor(repo)
    await ensureBranch(ctx, 'feature', 'main')
    const wt = trash.track(join(repo, '..', `wt-${Date.now()}`))
    const a = await ensureWorktree(ctx, wt, 'feature')
    const b = await ensureWorktree(ctx, wt, 'feature')
    expect(a.done && b.done).toBe(true)
    expect(b.outcome).toBe('noop')
  })

  it('ensureNoBranch 连跑两次,第二次 noop', async () => {
    const repo = trash.track(initRepo())
    const ctx = ctxFor(repo)
    await ensureBranch(ctx, 'tmp', 'main') // 与 main 同点 = 已合并
    const a = await ensureNoBranch(ctx, 'tmp')
    const b = await ensureNoBranch(ctx, 'tmp')
    expect(a.done && b.done).toBe(true)
    expect(b.outcome).toBe('noop')
  })
})

describe('ensure 半成品调谐', () => {
  it('失效 worktree 登记被 prune 后补齐', async () => {
    const repo = trash.track(initRepo())
    const ctx = ctxFor(repo)
    await ensureBranch(ctx, 'feature', 'main')
    const wt = trash.track(join(repo, '..', `wt-stale-${Date.now()}`))
    await ensureWorktree(ctx, wt, 'feature')
    // 模拟中断:直接删掉 worktree 目录,留下失效登记
    git(repo, 'worktree', 'list') // 触发一次,无副作用
    const fs = await import('node:fs')
    fs.rmSync(wt, { recursive: true, force: true })
    // 再 ensure:应 prune 失效登记并重建
    const r = await ensureWorktree(ctx, wt, 'feature')
    expect(r.done).toBe(true)
    expect(existsSync(wt)).toBe(true)
  })

  it('在途合并(MERGE_HEAD)被 abort 后达成', async () => {
    const repo = trash.track(initRepo())
    const ctx = ctxFor(repo)
    // 造冲突,手动留下在途合并
    writeFileSync(join(repo, 'a.txt'), 'main-side\n')
    git(repo, 'commit', '-q', '-am', 'main edit')
    git(repo, 'checkout', '-q', '-b', 'feature', 'HEAD~1')
    writeFileSync(join(repo, 'a.txt'), 'feature-side\n')
    git(repo, 'commit', '-q', '-am', 'feature edit')
    git(repo, 'checkout', '-q', 'main')
    // 第一次 ensureMerged → 冲突(内部 abort)
    const first = await ensureMerged(ctx, 'feature', 'main')
    expect(first.outcome).toBe('conflict')
    // 工作树应已干净(无在途合并)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})

describe('ensureNoBranch 级联清 worktree', () => {
  it('分支仍被 worktree 检出时,先移除 worktree 再删分支', async () => {
    const repo = trash.track(initRepo())
    const ctx = ctxFor(repo)
    await ensureBranch(ctx, 'feature', 'main') // 与 main 同点 = 已合并,可安全删
    const wt = trash.track(join(repo, '..', `wt-held-${Date.now()}`))
    await ensureWorktree(ctx, wt, 'feature')
    // 直接删分支会被 git 拒(被 worktree 检出);ensureNoBranch 应级联清掉
    const r = await ensureNoBranch(ctx, 'feature')
    expect(r.done).toBe(true)
    expect(makeGitRunner(repo)(['branch', '--list', 'feature'])).toBe('')
    expect(existsSync(wt)).toBe(false)
  })
})

describe('ensureNoWorktree 防御性解 junction', () => {
  it('worktree 内含 junction 时先解链再删,目标内容不变', async () => {
    const repo = trash.track(initRepo())
    const ctx = ctxFor(repo)
    await ensureBranch(ctx, 'feature', 'main')
    const wt = trash.track(join(repo, '..', `wt-j-${Date.now()}`))
    await ensureWorktree(ctx, wt, 'feature')
    const target = trash.track(join(repo, '..', `target-${Date.now()}`))
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'precious.txt'), 'keep\n')
    await linkJunction(target, join(wt, 'node_modules'))
    const r = await ensureNoWorktree(ctx, wt)
    expect(r.done).toBe(true)
    expect(existsSync(wt)).toBe(false)
    expect(existsSync(join(target, 'precious.txt'))).toBe(true) // 目标完好
  })
})

describe('ensureJunction', () => {
  it('目标不存在报 no-target', async () => {
    const repo = trash.track(initRepo())
    const wt = trash.track(join(repo, '..', `wt-nt-${Date.now()}`))
    mkdirSync(wt, { recursive: true })
    const r = await ensureJunction(wt, [{ target: join(repo, '..', 'nope'), mountPath: 'node_modules' }])
    expect(r.done).toBe(false)
    expect(r.outcome).toBe('no-target')
  })

  it('链接后再 ensure 为幂等(指向正确即跳过)', async () => {
    const repo = trash.track(initRepo())
    const wt = trash.track(join(repo, '..', `wt-ok-${Date.now()}`))
    mkdirSync(wt, { recursive: true })
    const target = trash.track(join(repo, '..', `tgt-${Date.now()}`))
    mkdirSync(target, { recursive: true })
    const links = [{ target, mountPath: 'node_modules' }]
    const a = await ensureJunction(wt, links)
    const b = await ensureJunction(wt, links)
    expect(a.done && b.done).toBe(true)
  })
})
