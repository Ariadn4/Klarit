import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  makeAsyncGitRunner,
  createBranch,
  addWorktree,
  removeWorktree,
  deleteBranch,
  mergeBranch,
  pushBranch,
  deleteRemoteBranch
} from './git-write'
import { listBranches, listWorktrees, makeGitRunner } from './git'

/** 在 dir 下同步跑 git（仅测试搭台用），失败抛出。 */
function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

/** 建一个带初始提交的真实仓库，返回其路径。 */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'klarit-gitw-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@klarit.dev')
  git(dir, 'config', 'user.name', 'Klarit Test')
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** 建一个裸仓库当远端，返回其路径。 */
function initBare(): string {
  const dir = mkdtempSync(join(tmpdir(), 'klarit-bare-'))
  git(dir, 'init', '-q', '--bare', '-b', 'main')
  return dir
}

const trash: string[] = []
function track(dir: string): string {
  trash.push(dir)
  return dir
}
afterEach(() => {
  while (trash.length) {
    try {
      rmSync(trash.pop()!, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('makeAsyncGitRunner', () => {
  it('成功命令返回 code 0 与 trim 的 stdout，Promise 不抛', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    const r = await run(['rev-parse', '--abbrev-ref', 'HEAD'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('main')
  })

  it('失败命令以非零 code + stderr 返回，Promise 不抛', async () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'klarit-nogit-')))
    const run = makeAsyncGitRunner(dir)
    const r = await run(['status'])
    expect(r.code).not.toBe(0)
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})

describe('createBranch', () => {
  it('在基点建一个新分支', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    const r = await createBranch(run, 'feature', 'main')
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('success')
    expect(listBranches(repo, makeGitRunner(repo)).branches).toContain('feature')
  })

  it('分支已存在时报 noop（幂等友好）', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    await createBranch(run, 'feature', 'main')
    const r = await createBranch(run, 'feature', 'main')
    expect(r.outcome).toBe('noop')
  })
})

describe('addWorktree / removeWorktree', () => {
  it('为分支在空闲路径加 worktree', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    await createBranch(run, 'feature', 'main')
    const wt = join(repo, '..', `wt-${Date.now()}`)
    track(wt)
    const r = await addWorktree(run, wt, 'feature')
    expect(r.ok).toBe(true)
    const paths = listWorktrees(repo, makeGitRunner(repo)).worktrees.map((w) => w.branch)
    expect(paths).toContain('feature')
  })

  it('删 worktree 后清理注册，worktree list 不再含它', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    await createBranch(run, 'feature', 'main')
    const wt = track(join(repo, '..', `wt-rm-${Date.now()}`))
    await addWorktree(run, wt, 'feature')
    const r = await removeWorktree(run, wt)
    expect(r.ok).toBe(true)
    const branches = listWorktrees(repo, makeGitRunner(repo)).worktrees.map((w) => w.branch)
    expect(branches).not.toContain('feature')
  })
})

describe('deleteBranch（安全删）', () => {
  it('已合并分支删除成功', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    await createBranch(run, 'merged', 'main') // 与 main 同点，视为已合并
    const r = await deleteBranch(run, 'merged')
    expect(r.ok).toBe(true)
    expect(listBranches(repo, makeGitRunner(repo)).branches).not.toContain('merged')
  })

  it('未合并分支被拒、分支保留、带 not-merged 原因', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    git(repo, 'checkout', '-q', '-b', 'wip')
    writeFileSync(join(repo, 'b.txt'), 'work\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'wip commit')
    git(repo, 'checkout', '-q', 'main')
    const r = await deleteBranch(run, 'wip')
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe('not-merged')
    expect(listBranches(repo, makeGitRunner(repo)).branches).toContain('wip')
  })
})

describe('mergeBranch', () => {
  it('无冲突合并成功', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(repo, 'c.txt'), 'feature\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'feature commit')
    git(repo, 'checkout', '-q', 'main')
    const r = await mergeBranch(run, 'feature')
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('success')
  })

  it('冲突合并被中止、回到干净态、报 conflict', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    // main 改 a.txt
    writeFileSync(join(repo, 'a.txt'), 'main-side\n')
    git(repo, 'commit', '-q', '-am', 'main edit')
    // feature 从 init 起改同一文件不同内容
    git(repo, 'checkout', '-q', '-b', 'feature', 'HEAD~1')
    writeFileSync(join(repo, 'a.txt'), 'feature-side\n')
    git(repo, 'commit', '-q', '-am', 'feature edit')
    git(repo, 'checkout', '-q', 'main')
    const r = await mergeBranch(run, 'feature')
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe('conflict')
    // 工作树干净、无在途合并
    expect(git(repo, 'status', '--porcelain')).toBe('')
    const merging = makeGitRunner(repo)(['rev-parse', '--verify', 'MERGE_HEAD'])
    expect(merging).toBeNull()
  })

  it('已合并报 noop（已是最新）', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    await createBranch(run, 'same', 'main')
    const r = await mergeBranch(run, 'same')
    expect(r.outcome).toBe('noop')
  })

  it('leaveConflict 模式：冲突不 abort、保留 MERGE_HEAD 与冲突标记、报 conflict', async () => {
    const repo = track(initRepo())
    const run = makeAsyncGitRunner(repo)
    writeFileSync(join(repo, 'a.txt'), 'main-side\n')
    git(repo, 'commit', '-q', '-am', 'main edit')
    git(repo, 'checkout', '-q', '-b', 'feature', 'HEAD~1')
    writeFileSync(join(repo, 'a.txt'), 'feature-side\n')
    git(repo, 'commit', '-q', '-am', 'feature edit')
    git(repo, 'checkout', '-q', 'main')
    const r = await mergeBranch(run, 'feature', { leaveConflict: true })
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe('conflict')
    // 在途合并保留：MERGE_HEAD 存在、有未合并条目
    expect(makeGitRunner(repo)(['rev-parse', '--verify', 'MERGE_HEAD'])).not.toBeNull()
    expect(makeGitRunner(repo)(['ls-files', '-u'])).not.toBe('')
  })
})

describe('pushBranch / deleteRemoteBranch（本地裸仓当 origin）', () => {
  it('普通推送成功', async () => {
    const repo = track(initRepo())
    const bare = track(initBare())
    git(repo, 'remote', 'add', 'origin', bare)
    const run = makeAsyncGitRunner(repo)
    const r = await pushBranch(run, 'origin', 'main')
    expect(r.ok).toBe(true)
    expect(git(bare, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main'))
  })

  it('非快进推送被拒、报 non-fast-forward、不强推', async () => {
    const bare = track(initBare())
    const repoA = track(initRepo())
    git(repoA, 'remote', 'add', 'origin', bare)
    await pushBranch(makeAsyncGitRunner(repoA), 'origin', 'main')
    // 第二个克隆推进远端 main
    const repoB = track(mkdtempSync(join(tmpdir(), 'klarit-cloneB-')))
    git(repoB, 'clone', '-q', bare, '.')
    git(repoB, 'config', 'user.email', 'b@klarit.dev')
    git(repoB, 'config', 'user.name', 'B')
    writeFileSync(join(repoB, 'fromB.txt'), 'b\n')
    git(repoB, 'add', '-A')
    git(repoB, 'commit', '-q', '-m', 'B commit')
    git(repoB, 'push', '-q', 'origin', 'main')
    // A 在旧基点提交后推 → 非快进
    writeFileSync(join(repoA, 'fromA.txt'), 'a\n')
    git(repoA, 'add', '-A')
    git(repoA, 'commit', '-q', '-m', 'A commit')
    const r = await pushBranch(makeAsyncGitRunner(repoA), 'origin', 'main')
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe('non-fast-forward')
  })

  it('删除远端分支成功；已不存在报 noop', async () => {
    const repo = track(initRepo())
    const bare = track(initBare())
    git(repo, 'remote', 'add', 'origin', bare)
    const run = makeAsyncGitRunner(repo)
    await pushBranch(run, 'origin', 'main')
    await createBranch(run, 'feature', 'main')
    await pushBranch(run, 'origin', 'feature')
    const r = await deleteRemoteBranch(run, 'origin', 'feature')
    expect(r.ok).toBe(true)
    const again = await deleteRemoteBranch(run, 'origin', 'feature')
    expect(again.outcome).toBe('noop')
  })
})
