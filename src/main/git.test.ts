import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { probeGit, listBranches, listWorktrees, type GitRunner } from './git'

/** 构造一个按 args[0..] 返回预设结果的假 runner。 */
function fakeRunner(responses: Record<string, string | null>): GitRunner {
  return (args) => {
    const key = args.join(' ')
    return key in responses ? responses[key] : null
  }
}

describe('probeGit', () => {
  it('无 git 时 isGit=false，其余为 null', () => {
    const run = fakeRunner({})
    const r = probeGit('/some/dir', run)
    expect(r).toEqual({
      isGit: false,
      toplevel: null,
      commonDir: null,
      branch: null,
      remote: null
    })
  })

  it('有 git 且配置了远程：记录分支与远程', () => {
    const run = fakeRunner({
      'rev-parse --show-toplevel': '/repo',
      'rev-parse --git-common-dir': '/repo/.git',
      'branch --show-current': 'main',
      'remote get-url origin': 'git@github.com:me/repo.git'
    })
    const r = probeGit('/repo', run)
    expect(r.isGit).toBe(true)
    expect(r.branch).toBe('main')
    expect(r.remote).toBe('git@github.com:me/repo.git')
    expect(r.commonDir).toBe(resolve('/repo', '/repo/.git'))
  })

  it('有 git 但无远程：仍 isGit=true，remote 为 null', () => {
    const run = fakeRunner({
      'rev-parse --show-toplevel': '/repo',
      'rev-parse --git-common-dir': '.git',
      'branch --show-current': 'main',
      'remote get-url origin': null
    })
    const r = probeGit('/repo', run)
    expect(r.isGit).toBe(true)
    expect(r.remote).toBeNull()
    expect(r.branch).toBe('main')
    // 相对的 .git 应解析为相对 dir 的绝对路径
    expect(r.commonDir).toBe(resolve('/repo', '.git'))
  })

  it('detached / 空仓库：branch 为 null 但仍 isGit=true', () => {
    const run = fakeRunner({
      'rev-parse --show-toplevel': '/repo',
      'rev-parse --git-common-dir': '/repo/.git',
      'branch --show-current': '',
      'remote get-url origin': null
    })
    const r = probeGit('/repo', run)
    expect(r.isGit).toBe(true)
    expect(r.branch).toBeNull()
  })

  it('worktree：--git-common-dir 指向共享仓库目录', () => {
    const run = fakeRunner({
      'rev-parse --show-toplevel': '/repo-wt',
      'rev-parse --git-common-dir': '/repo/.git',
      'branch --show-current': 'feature',
      'remote get-url origin': 'git@github.com:me/repo.git'
    })
    const r = probeGit('/repo-wt', run)
    expect(r.commonDir).toBe(resolve('/repo-wt', '/repo/.git'))
  })
})

describe('listBranches', () => {
  it('只列本地分支，并标记当前分支', () => {
    const run = fakeRunner({
      'branch --format=%(refname:short)': 'main\nfeature\ndev',
      'branch --show-current': 'feature'
    })
    expect(listBranches('/repo', run)).toEqual({
      current: 'feature',
      branches: ['main', 'feature', 'dev']
    })
  })

  it('非 git 目录：安全返回空', () => {
    expect(listBranches('/x', fakeRunner({}))).toEqual({ current: null, branches: [] })
  })

  it('detached（show-current 为空）：current 为 null 但仍列出分支', () => {
    const run = fakeRunner({
      'branch --format=%(refname:short)': 'main\nfeature',
      'branch --show-current': ''
    })
    expect(listBranches('/repo', run)).toEqual({ current: null, branches: ['main', 'feature'] })
  })

  it('忽略空行与多余空白', () => {
    const run = fakeRunner({
      'branch --format=%(refname:short)': '  main \n\n feature \n',
      'branch --show-current': 'main'
    })
    expect(listBranches('/repo', run)).toEqual({ current: 'main', branches: ['main', 'feature'] })
  })
})

describe('listWorktrees', () => {
  it('解析单 worktree', () => {
    const run = fakeRunner({
      'worktree list --porcelain': 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n'
    })
    expect(listWorktrees('/repo', run)).toEqual({
      worktrees: [{ path: '/repo', branch: 'main' }]
    })
  })

  it('解析多 worktree', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-wt/feature',
      'HEAD def456',
      'branch refs/heads/feature',
      ''
    ].join('\n')
    const run = fakeRunner({ 'worktree list --porcelain': porcelain })
    expect(listWorktrees('/repo', run)).toEqual({
      worktrees: [
        { path: '/repo', branch: 'main' },
        { path: '/repo-wt/feature', branch: 'feature' }
      ]
    })
  })

  it('detached worktree 的 branch 为 null', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-wt/detached',
      'HEAD 789aaa',
      'detached',
      ''
    ].join('\n')
    const run = fakeRunner({ 'worktree list --porcelain': porcelain })
    expect(listWorktrees('/repo', run)).toEqual({
      worktrees: [
        { path: '/repo', branch: 'main' },
        { path: '/repo-wt/detached', branch: null }
      ]
    })
  })

  it('非 git 目录：安全返回空', () => {
    expect(listWorktrees('/x', fakeRunner({}))).toEqual({ worktrees: [] })
  })
})
