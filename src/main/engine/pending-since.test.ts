/**
 * 断点上的「待决策产生时刻」`pendingSince`：与 `pendingDecision` 同生共死（置决策时写、清决策时清），
 * 不分来源（失败决策 / 人工评审门 / 外部门 / agent 提问），且不影响引擎自身的恢复与续跑行为。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, initRepo, initBare, makeTrash } from '../git-test-helpers'
import type {
  AgentHandshake,
  RunRequest,
  WorkflowDefinition,
  WorkflowNode
} from '../../shared/types'
import type { CommandResult } from '../command-run'
import { createEngine, type AgentPrep, type EngineDeps } from './engine'
import { createMemoryRunStore } from './run-store'
import type { AgentRunner } from '../agent/runner'

const trash = makeTrash()
afterEach(() => trash.cleanup())

let nid = 0
function engineNode(operation: string, gate?: WorkflowNode['gate']): WorkflowNode {
  return {
    id: `n${nid++}-${operation}`,
    name: { zh: operation },
    stageId: 's',
    executor: { kind: 'engine', operation },
    outputs: [],
    ...(gate ? { gate } : {})
  }
}
function agentNode(): WorkflowNode {
  return {
    id: `a${nid++}`,
    name: { zh: 'implement' },
    stageId: 's',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: '实现' } },
    outputs: []
  }
}
function commandNode(command: string): WorkflowNode {
  return {
    id: `c${nid++}`,
    name: { zh: 'cmd' },
    stageId: 's',
    executor: { kind: 'command', commands: [{ command }] },
    outputs: []
  }
}
function wf(nodes: WorkflowNode[]): WorkflowDefinition {
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes }
}
function deps(def: WorkflowDefinition, extra: Partial<EngineDeps> = {}): EngineDeps {
  return { getWorkflow: (id) => (id === def.id ? def : null), store: createMemoryRunStore(), ...extra }
}

/** 假 agent 运行器：不真拉进程，恒 0 退出。 */
function fakeRunner(): AgentRunner {
  return {
    supportsResume: () => true,
    start: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }),
    resume: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
  }
}
const PREP: AgentPrep = { prompt: 'P', toolId: 'claude-code' }
const NO_REPO_REQ: RunRequest = {
  workflowId: 'wf',
  repoPath: '/no/repo',
  branch: 'card-x',
  worktreePath: '/no/wt',
  baseBranch: 'main'
}

/** 一个有未合并提交的分支（删它会失败 → 抛失败决策）。 */
function seedUnmerged(repo: string): void {
  git(repo, 'checkout', '-q', '-b', 'wip')
  writeFileSync(join(repo, 'b.txt'), 'wip\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'wip')
  git(repo, 'checkout', '-q', 'main')
}

/** 一个已推上远端但未合并的 feature（外部门挂起用）。 */
function seedFeature(repo: string): void {
  git(repo, 'checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'f.txt'), 'feature\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'feature work')
  git(repo, 'checkout', '-q', 'main')
}

describe('置决策时记录 pendingSince（不分来源）', () => {
  it('失败决策（删未合并分支）→ 断点带 pendingSince', async () => {
    const repo = trash.track(initRepo())
    seedUnmerged(repo)
    const engine = createEngine(deps(wf([engineNode('delete-branch')])))
    const before = Date.now()
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'wip', baseBranch: 'main' })
      .settled
    expect(bp.pendingDecision).not.toBeNull()
    expect(typeof bp.pendingSince).toBe('number')
    expect(bp.pendingSince!).toBeGreaterThanOrEqual(before)
    expect(bp.pendingSince!).toBeLessThanOrEqual(Date.now())
  })

  it('人工评审门 → 断点带 pendingSince', async () => {
    const repo = trash.track(initRepo())
    const engine = createEngine(
      deps(wf([engineNode('create-branch', [{ kind: 'manual', actions: [] }])]))
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' })
      .settled
    expect(bp.pendingDecision!.source.endsWith(':manual-gate')).toBe(true)
    expect(typeof bp.pendingSince).toBe('number')
  })

  it('外部门（PR 未合并）→ 断点带 pendingSince', async () => {
    const repo = trash.track(initRepo())
    const bare = trash.track(initBare())
    git(repo, 'remote', 'add', 'origin', bare)
    git(repo, 'push', '-q', 'origin', 'main')
    seedFeature(repo)
    git(repo, 'push', '-q', 'origin', 'feature')
    const engine = createEngine(
      deps(wf([engineNode('create-branch', [{ kind: 'external', verify: 'pr-merged' }])]))
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' })
      .settled
    expect(bp.pendingDecision!.source.endsWith(':external-gate')).toBe(true)
    expect(typeof bp.pendingSince).toBe('number')
  })

  it('agent 提问（握手 need-decision）→ 断点带 pendingSince', async () => {
    const def = wf([agentNode()])
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: fakeRunner(),
      prepareAgent: () => PREP,
      readHandshake: (): AgentHandshake => ({
        status: 'need-decision',
        decision: { title: '用 REST 还是 GraphQL？', options: [{ id: 'rest', label: '用 REST' }] }
      })
    })
    const bp = await engine.start(NO_REPO_REQ).settled
    expect(bp.pendingDecision!.sourceKind).toBe('agent')
    expect(typeof bp.pendingSince).toBe('number')
  })
})

describe('清决策时一并清 pendingSince', () => {
  it('decide 回应人工门 → pendingDecision 与 pendingSince 一并清空', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const engine = createEngine(deps(def))
    const at = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' })
      .settled
    expect(at.pendingSince).toEqual(expect.any(Number))
    const done = await engine.decide(at.runId, { optionId: 'pass' }).settled
    expect(done.pendingDecision).toBeNull()
    expect(done.pendingSince).toBeUndefined()
  })

  it('abort 停在决策上的运行 → 二者一并清空', async () => {
    const repo = trash.track(initRepo())
    seedUnmerged(repo)
    const engine = createEngine(deps(wf([engineNode('delete-branch')])))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'wip', baseBranch: 'main' })
      .settled
    expect(bp.pendingSince).toEqual(expect.any(Number))
    const aborted = await engine.abort(bp.runId)
    expect(aborted!.state).toBe('aborted')
    expect(aborted!.pendingDecision).toBeNull()
    expect(aborted!.pendingSince).toBeUndefined()
  })

  it('命令失败决策被 skip 回应后跑到 done → 不残留 pendingSince', async () => {
    const def = wf([commandNode('flaky')])
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runCommand: async (): Promise<CommandResult> => ({ code: 1, stdout: '', stderr: 'x', killed: false })
    })
    const bp = await engine.start(NO_REPO_REQ).settled
    expect(bp.pendingSince).toEqual(expect.any(Number))
    const done = await engine.decide(bp.runId, { optionId: 'skip' }).settled
    expect(done.state).toBe('done')
    expect(done.pendingSince).toBeUndefined()
  })
})

describe('pendingSince 不影响恢复与续跑', () => {
  it('带 pendingSince 的断点跨引擎实例恢复 → 仍是 waiting-decision，通过后完成', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const store = createMemoryRunStore()
    const a = await createEngine({ getWorkflow: () => def, store })
      .start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(a.pendingSince).toEqual(expect.any(Number))

    const engineB = createEngine({ getWorkflow: () => def, store })
    const resumed = await engineB.resume(a.runId).settled
    expect(resumed.state).toBe('waiting-decision')
    expect(resumed.pendingSince).toBe(a.pendingSince) // 恢复不刷新时刻
    const done = await engineB.decide(a.runId, { optionId: 'pass' }).settled
    expect(done.state).toBe('done')
  })

  it('老断点缺 pendingSince（本能力前写下的数据）→ 读取与续跑照常，不报错', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const store = createMemoryRunStore()
    const a = await createEngine({ getWorkflow: () => def, store })
      .start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    // 抹掉时刻，模拟老数据
    const old = store.load(a.runId)!
    delete old.pendingSince
    store.save(old)

    const engineB = createEngine({ getWorkflow: () => def, store })
    const seen = engineB.getRunState(a.runId)!
    expect(seen.pendingDecision).not.toBeNull()
    expect(seen.pendingSince).toBeUndefined()
    const done = await engineB.decide(a.runId, { optionId: 'pass' }).settled
    expect(done.state).toBe('done')
  })
})
