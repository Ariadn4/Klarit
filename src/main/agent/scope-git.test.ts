import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { git, initRepo, makeTrash } from '../git-test-helpers'
import { makeGitRunner } from '../git'
import { makeAsyncGitRunner } from '../git-write'
import { scopeGuard } from './scope'

const trash = makeTrash()
afterEach(() => trash.cleanup())

function head(repo: string): string {
  return git(repo, 'rev-parse', 'HEAD')
}

describe('scopeGuard — 越界还原 + 范围内提交（真 git）', () => {
  it('越界文件还原/删除、范围内保留并提交、记 SHA', async () => {
    const repo = trash.track(initRepo())
    mkdirSync(join(repo, 'docs'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'seed.md'), 'seed\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'seed')
    const startSha = head(repo)

    // 模拟 agent 改动：docs/ 内（范围内，改已有 + 新增）、src/ 外（越界，新文件）
    writeFileSync(join(repo, 'docs', 'seed.md'), 'edited\n') // 范围内改
    writeFileSync(join(repo, 'docs', 'new.md'), '新\n') // 范围内新增
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', 'x.ts'), 'leak\n') // 越界新文件

    const r = await scopeGuard({
      worktree: repo,
      read: makeGitRunner(repo),
      write: makeAsyncGitRunner(repo),
      startSha,
      writableScope: ['docs/'],
      outputPaths: [],
      message: 'node commit'
    })

    expect(r.outOfScope).toEqual(['src/x.ts'])
    expect(existsSync(join(repo, 'src', 'x.ts'))).toBe(false) // 越界新文件被删
    expect(r.inScope.sort()).toEqual(['docs/new.md', 'docs/seed.md'])
    expect(r.commitSha).toBeTruthy()
    expect(r.commitSha).not.toBe(startSha)
    // 提交后工作树干净（范围内已提交、越界已还原）
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('无范围内改动 → 不产空提交、commitSha=null', async () => {
    const repo = trash.track(initRepo())
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'base')
    const startSha = head(repo)
    writeFileSync(join(repo, 'leak.ts'), 'x\n') // 仅越界

    const r = await scopeGuard({
      worktree: repo,
      read: makeGitRunner(repo),
      write: makeAsyncGitRunner(repo),
      startSha,
      writableScope: ['docs/'],
      outputPaths: [],
      message: 'm'
    })
    expect(r.commitSha).toBeNull()
    expect(head(repo)).toBe(startSha) // HEAD 未动
    expect(existsSync(join(repo, 'leak.ts'))).toBe(false)
  })

  it('越界文件在起始已存在 → 还原到起始内容（非删除）', async () => {
    const repo = trash.track(initRepo())
    writeFileSync(join(repo, 'keep.ts'), 'original\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'seed')
    const startSha = head(repo)
    writeFileSync(join(repo, 'keep.ts'), 'tampered\n') // 越界改已有文件

    await scopeGuard({
      worktree: repo,
      read: makeGitRunner(repo),
      write: makeAsyncGitRunner(repo),
      startSha,
      writableScope: ['docs/'],
      outputPaths: [],
      message: 'm'
    })
    expect(existsSync(join(repo, 'keep.ts'))).toBe(true)
    expect(git(repo, 'show', 'HEAD:keep.ts')).toBe('original')
  })
})
