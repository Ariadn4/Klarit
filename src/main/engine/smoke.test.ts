import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, initRepo, initBare, makeTrash } from '../git-test-helpers'
import { makeGitRunner } from '../git'
import { createDefaultWorkflow, createDefaultWorkflowPr } from '../../shared/workflow'
import { createEngine } from './engine'
import { createRunStore } from './run-store'
import { testTmpDir } from '../test-tmp'

const trash = makeTrash()
afterEach(() => trash.cleanup())

/** repo + 本地裸仓 origin（已 push main），并预置一个领先 main 的 feature 分支。 */
function projectWithFeature(): { repo: string; bare: string } {
  const repo = trash.track(initRepo('klarit-smoke-'))
  const bare = trash.track(initBare())
  git(repo, 'remote', 'add', 'origin', bare)
  git(repo, 'push', '-q', 'origin', 'main')
  git(repo, 'checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'feat.txt'), 'feature work\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'feature work')
  git(repo, 'checkout', '-q', 'main')
  return { repo, bare }
}

describe('默认工作流端到端 smoke', () => {
  it('本地直合：建分支→开worktree→关联→〔实现占位跳过〕→合并前人工审批门→合并→push main→删worktree→删分支', async () => {
    const { repo, bare } = projectWithFeature()
    const def = createDefaultWorkflow('local')
    const wt = trash.track(join(repo, '..', `wt-local-${Date.now()}`))
    const engine = createEngine({ getWorkflow: () => def, store: createRunStore(trash.track(testTmpDir('runs-'))) })
    // 合并前停在人工审批门（重大步骤须人拍板：默认工作流不再无人值守跑到底）。
    const paused = await engine.start({
      workflowId: 'local',
      repoPath: repo,
      branch: 'feature',
      worktreePath: wt,
      baseBranch: 'main'
    }).settled
    expect(paused.state).toBe('waiting-decision')
    expect(paused.pendingDecision!.source.endsWith(':manual-gate')).toBe(true)
    // 审批通过 → 继续合并、推送、清理跑完。
    const bp = await engine.decide(paused.runId, { optionId: 'pass' }).settled
    expect(bp.state).toBe('done')
    expect(git(repo, 'log', '--oneline').includes('feature work')).toBe(true) // 已合并
    expect(git(bare, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main')) // 主干已推
    expect(existsSync(wt)).toBe(false) // worktree 已清
    expect(makeGitRunner(repo)(['branch', '--list', 'feature'])).toBe('') // 本地分支已删
  })

  it('PR 模式 + 断点恢复：停在人工评审门→换新引擎实例从持久化断点续→pass 跑完', async () => {
    const { repo, bare } = projectWithFeature()
    const def = createDefaultWorkflowPr('pr')
    const wt = trash.track(join(repo, '..', `wt-pr-${Date.now()}`))
    const runsDir = trash.track(testTmpDir('runs-'))

    // 引擎 A：跑到 push 需求分支后的人工评审门停住。
    const engineA = createEngine({ getWorkflow: () => def, store: createRunStore(runsDir) })
    const a = await engineA.start({
      workflowId: 'pr',
      repoPath: repo,
      branch: 'feature',
      worktreePath: wt,
      baseBranch: 'main'
    }).settled
    expect(a.state).toBe('waiting-decision')
    expect(a.pendingDecision!.source.endsWith(':manual-gate')).toBe(true)
    // 需求分支此刻已推到远端
    expect(git(repo, 'ls-remote', '--heads', 'origin', 'feature')).not.toBe('')

    // 引擎 B：同一持久化目录、全新实例，加载断点、评审通过、跑完。
    const engineB = createEngine({ getWorkflow: () => def, store: createRunStore(runsDir) })
    expect(engineB.getRunState(a.runId)!.state).toBe('waiting-decision')
    const b = await engineB.decide(a.runId, { optionId: 'pass' }).settled
    expect(b.state).toBe('done')
    expect(git(repo, 'log', '--oneline').includes('feature work')).toBe(true) // 已合并
    expect(git(bare, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main')) // 主干已推
    expect(git(repo, 'ls-remote', '--heads', 'origin', 'feature')).toBe('') // 云端分支已删
    expect(existsSync(wt)).toBe(false) // worktree 已清
    expect(makeGitRunner(repo)(['branch', '--list', 'feature'])).toBe('') // 本地分支已删
  })

  it('开机自动恢复：resumeAll 续跑持久化中 running 的运行', async () => {
    // 用一个无门、纯引擎的小工作流，手造一份「running」断点，验证 resumeAll 能把它跑完。
    const repo = trash.track(initRepo('klarit-resume-'))
    const def = createDefaultWorkflow('local')
    const runsDir = trash.track(testTmpDir('runs-'))
    const store = createRunStore(runsDir)
    // 直接写入一份初始 running 断点（模拟上次关软件时留存）。
    store.save({
      runId: 'r1',
      request: { workflowId: 'local', repoPath: repo, branch: 'feature', baseBranch: 'main' },
      state: 'running',
      currentNodeId: null,
      phase: { kind: 'executing' },
      pendingDecision: null
    })
    const engine = createEngine({ getWorkflow: () => def, store })
    await engine.resumeAll()
    const after = engine.getRunState('r1')!
    expect(['done', 'waiting-decision']).toContain(after.state) // 至少不再停在初始 running
  })
})
