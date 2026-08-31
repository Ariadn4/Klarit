import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { git, initRepo, initBare, makeTrash } from '../git-test-helpers'
import { makeGitRunner } from '../git'
import type { ArchiveDocEntry, DocRegistry, EngineProgressEvent, RunBreakpoint, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type EngineDeps } from './engine'
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
    id: `n${nid++}-agent`,
    name: { zh: 'implement' },
    stageId: 's',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } },
    outputs: []
  }
}
function wf(nodes: WorkflowNode[]): WorkflowDefinition {
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes }
}
function deps(def: WorkflowDefinition, extra: Partial<EngineDeps> = {}): EngineDeps {
  return {
    getWorkflow: (id) => (id === def.id ? def : null),
    store: createMemoryRunStore(),
    ...extra
  }
}
/** 给 repo 接一个本地裸仓当 origin。 */
function withOrigin(repo: string): string {
  const bare = trash.track(initBare())
  git(repo, 'remote', 'add', 'origin', bare)
  return bare
}

/** 最小 agent 运行器桩：成功退出、不产改动（供外部门打回的回退判定 agent 等用）。 */
function stubAgentRunner(): AgentRunner {
  return {
    supportsResume: () => true,
    start: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }),
    resume: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
  }
}

describe('全生命周期(本地直合 mini smoke)', () => {
  it('建分支→开worktree→合并→push main→删worktree→删分支 跑到 done', async () => {
    const repo = trash.track(initRepo())
    const bare = withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    // 预置一个领先 main 的 feature(让 merge 真的有活)
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(repo, 'f.txt'), 'feature\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'feature work')
    git(repo, 'checkout', '-q', 'main')

    const def = wf([
      engineNode('create-branch'),
      engineNode('open-worktree'),
      engineNode('merge-branch'),
      engineNode('push-branch'),
      engineNode('remove-worktree'),
      engineNode('delete-branch')
    ])
    const wtPath = trash.track(join(repo, '..', `wt-smoke-${Date.now()}`))
    const engine = createEngine(deps(def))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: repo,
      branch: 'feature',
      worktreePath: wtPath,
      baseBranch: 'main'
    }).settled
    expect(bp.state).toBe('done')
    // 合并生效:main 含 feature 的提交
    expect(git(repo, 'log', '--oneline').includes('feature work')).toBe(true)
    // 远端 main 已推上
    expect(git(bare, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main'))
    // worktree 与分支已清
    expect(existsSync(wtPath)).toBe(false)
    expect(makeGitRunner(repo)(['branch', '--list', 'feature'])).toBe('')
  })
})

describe('非引擎执行者被跳过', () => {
  it('agent 占位节点发 skip 事件并推进、不报错', async () => {
    const repo = trash.track(initRepo())
    const def = wf([engineNode('create-branch'), agentNode(), engineNode('delete-branch')])
    const events: EngineProgressEvent[] = []
    const engine = createEngine(deps(def, { emit: (e) => events.push(e) }))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('done')
    expect(events.some((e) => e.kind === 'skip')).toBe(true)
    expect(makeGitRunner(repo)(['branch', '--list', 'feature'])).toBe('')
  })
})

describe('复合别名 delete-branch-worktree', () => {
  it('既有种子形态:一个别名节点 = 删 worktree + 删本地分支', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch'),
      engineNode('open-worktree'),
      engineNode('delete-branch-worktree')
    ])
    const wtPath = trash.track(join(repo, '..', `wt-alias-${Date.now()}`))
    const engine = createEngine(deps(def))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: repo,
      branch: 'feature',
      worktreePath: wtPath,
      baseBranch: 'main'
    }).settled
    expect(bp.state).toBe('done')
    expect(existsSync(wtPath)).toBe(false)
    expect(makeGitRunner(repo)(['branch', '--list', 'feature'])).toBe('')
  })
})

describe('失败 → 人工决策(统一结构、前进式、sourceKind=engine)', () => {
  it('决策无「中止」死结、sourceKind 为 engine', async () => {
    const repo = trash.track(initRepo())
    git(repo, 'checkout', '-q', '-b', 'wip')
    writeFileSync(join(repo, 'b.txt'), 'wip\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'wip')
    git(repo, 'checkout', '-q', 'main')
    const def = wf([engineNode('delete-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'wip', baseBranch: 'main' }).settled
    expect(bp.state).toBe('waiting-decision')
    const d = bp.pendingDecision!
    expect(d.sourceKind).toBe('engine')
    const ids = d.options.map((o) => o.id)
    expect(ids).not.toContain('abort') // 前进式:无中止死结
    expect(ids).toEqual(expect.arrayContaining(['merge-then-delete', 'force', 'skip']))
  })

  it('删未合并分支:decide force(直接删丢弃)→ 删除完成', async () => {
    const repo = trash.track(initRepo())
    git(repo, 'checkout', '-q', '-b', 'wip')
    writeFileSync(join(repo, 'b.txt'), 'wip\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'wip')
    git(repo, 'checkout', '-q', 'main')
    const def = wf([engineNode('delete-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'wip', baseBranch: 'main' }).settled
    const after = await engine.decide(bp.runId, { optionId: 'force' }).settled
    expect(after.state).toBe('done')
    expect(makeGitRunner(repo)(['branch', '--list', 'wip'])).toBe('')
  })

  it('删未合并分支:decide skip(保留分支跳过该节点)→ 分支留存、流程继续', async () => {
    const repo = trash.track(initRepo())
    git(repo, 'checkout', '-q', '-b', 'wip')
    writeFileSync(join(repo, 'b.txt'), 'wip\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'wip')
    git(repo, 'checkout', '-q', 'main')
    const def = wf([engineNode('delete-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'wip', baseBranch: 'main' }).settled
    const after = await engine.decide(bp.runId, { optionId: 'skip' }).settled
    expect(after.state).toBe('done')
    expect(makeGitRunner(repo)(['branch', '--list', 'wip'])).toBe('wip') // 仍在
  })

  it('删未合并分支:decide merge-then-delete(先合并再删)→ 合并后删除完成', async () => {
    const repo = trash.track(initRepo())
    git(repo, 'checkout', '-q', '-b', 'wip')
    writeFileSync(join(repo, 'b.txt'), 'wip\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'wip')
    git(repo, 'checkout', '-q', 'main')
    const def = wf([engineNode('delete-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'wip', baseBranch: 'main' }).settled
    const after = await engine.decide(bp.runId, { optionId: 'merge-then-delete' }).settled
    expect(after.state).toBe('done')
    expect(makeGitRunner(repo)(['branch', '--list', 'wip'])).toBe('') // 已删
    expect(git(repo, 'log', '--oneline', 'main').includes('wip')).toBe(true) // 已并入 main
  })

  it('push 非快进:decide pull-rebase → 推送完成', async () => {
    const repoA = trash.track(initRepo())
    const bare = withOrigin(repoA)
    git(repoA, 'push', '-q', 'origin', 'main')
    const repoB = trash.track(initRepo('klarit-cloneB-'))
    git(repoB, 'remote', 'add', 'origin', bare)
    git(repoB, 'fetch', '-q', 'origin')
    git(repoB, 'reset', '-q', '--hard', 'origin/main')
    writeFileSync(join(repoB, 'fromB.txt'), 'b\n')
    git(repoB, 'add', '-A')
    git(repoB, 'commit', '-q', '-m', 'B')
    git(repoB, 'push', '-q', 'origin', 'main')
    writeFileSync(join(repoA, 'fromA.txt'), 'a\n')
    git(repoA, 'add', '-A')
    git(repoA, 'commit', '-q', '-m', 'A')
    const def = wf([engineNode('push-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repoA, branch: 'main', baseBranch: 'main' }).settled
    expect(bp.pendingDecision!.options.map((o) => o.id)).toEqual(
      expect.arrayContaining(['pull-rebase', 'force', 'skip'])
    )
    const after = await engine.decide(bp.runId, { optionId: 'pull-rebase' }).settled
    expect(after.state).toBe('done')
  })

  it('push 无远端:决策带填空(远端地址);decide text → 配置远端并推送', async () => {
    const repo = trash.track(initRepo()) // 无 origin
    const bare = trash.track(initBare())
    const def = wf([engineNode('push-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'main', baseBranch: 'main' }).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision!.input?.labelKey).toBe('engineDecision.inputRemoteAddress')
    expect(bp.pendingDecision!.titleKey).toBe('engineDecision.pushNoRemote')
    expect(bp.pendingDecision!.options.map((o) => o.id)).toContain('skip')
    const after = await engine.decide(bp.runId, { text: bare }).settled
    expect(after.state).toBe('done')
    expect(git(bare, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main'))
  })

  it('填了无效地址推不上去 → 弹回带填空的决策让重填;填对则完成', async () => {
    const repo = trash.track(initRepo())
    const bare = trash.track(initBare())
    const def = wf([engineNode('push-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'main', baseBranch: 'main' }).settled
    // 填一个不是仓库的路径 → 推送失败 → 应弹回、仍带填空框(可重填)
    const badAddr = join(repo, '..', 'not-a-repo-' + Date.now())
    const bad = await engine.decide(bp.runId, { text: badAddr }).settled
    expect(bad.state).toBe('waiting-decision')
    expect(bad.pendingDecision!.input?.labelKey).toBe('engineDecision.inputRemoteAddress')
    // 提示用"地址不可用"的 key + 把地址作为参数带出(让用户知道是这次失败,不是卡住)
    expect(bad.pendingDecision!.titleKey).toBe('engineDecision.pushBadAddress')
    expect(bad.pendingDecision!.titleParams?.address).toBe(badAddr)
    // git 原始英文只进 raw(供测试),不进用户可见的 key/参数
    expect(bad.pendingDecision!.raw).toBeTruthy()
    // 再填正确的裸仓 → 完成
    const good = await engine.decide(bad.runId, { text: bare }).settled
    expect(good.state).toBe('done')
    expect(git(bare, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'main'))
  })
})

describe('自动处理(不抛决策)', () => {
  it('link-env 目标不存在 → 自动跳过、流程继续', async () => {
    const repo = trash.track(initRepo())
    const def = wf([engineNode('create-branch'), engineNode('link-env'), engineNode('delete-branch')])
    const events: EngineProgressEvent[] = []
    const engine = createEngine(deps(def, { emit: (e) => events.push(e) }))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: repo,
      branch: 'feature',
      baseBranch: 'main',
      links: [{ target: join(repo, '..', 'nope-' + Date.now()), mountPath: 'node_modules' }]
    }).settled
    expect(bp.state).toBe('done') // 没有停在决策
    expect(events.some((e) => e.kind === 'skip')).toBe(true)
  })
})

describe('抛决策先落盘再发事件', () => {
  // 消费方(决策收件箱投影)是**按 runId 回读持久化断点**来认这条决策的。若先发事件后落盘,
  // 它在收到事件那刻读到的是旧断点、看不见 pendingDecision,于是把决策当「已消失」丢弃——
  // 条目最终仍会被全量重建补上(计数正确),但只为新增触发的副作用(桌面通知)永久丢失。
  it('decision 事件发出的那一刻,按 runId 回读断点即可读到 pendingDecision', async () => {
    const repo = trash.track(initRepo())
    const def = wf([engineNode('create-branch', [{ kind: 'manual', actions: [] }])])
    const store = createMemoryRunStore()
    const readable: boolean[] = []
    const engine = createEngine({
      getWorkflow: () => def,
      store,
      emit: (e) => {
        if (e.kind === 'decision') readable.push(!!store.load(e.runId)?.pendingDecision)
      }
    })
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' })
      .settled
    expect(bp.state).toBe('waiting-decision')
    expect(readable).toEqual([true])
  })
})

describe('人工评审门(只「通过」)+ 断点恢复(跨引擎实例)', () => {
  it('停在 manual gate → 换新引擎从断点续 → 通过完成,不重做上游', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    const def = wf([
      engineNode('create-branch'),
      engineNode('push-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const store = createMemoryRunStore()
    const engineA = createEngine({ getWorkflow: () => def, store })
    const a = await engineA.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(a.state).toBe('waiting-decision')
    expect(a.pendingDecision!.source.endsWith(':manual-gate')).toBe(true)
    expect(a.pendingDecision!.options.map((o) => o.id)).toEqual(['pass']) // 仅「通过」；驳回走自由输入框

    const eventsB: EngineProgressEvent[] = []
    const engineB = createEngine({ getWorkflow: () => def, store, emit: (e) => eventsB.push(e) })
    expect(engineB.getRunState(a.runId)!.state).toBe('waiting-decision')
    const b = await engineB.decide(a.runId, { optionId: 'pass' }).settled
    expect(b.state).toBe('done')
    const reentered = eventsB.filter((e) => e.kind === 'node-enter').map((e) => (e as { nodeId: string }).nodeId)
    expect(reentered.some((id) => id.includes('create-branch'))).toBe(false)
  })

  it('多道门:通过第0道后停在第1道,从第1道续', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch', [
        { kind: 'manual', actions: [] },
        { kind: 'manual', actions: [] }
      ]),
      engineNode('delete-branch')
    ])
    const engine = createEngine(deps(def))
    const a = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(a.phase).toEqual({ kind: 'gate', index: 0 })
    const b = await engine.decide(a.runId, { optionId: 'pass' }).settled
    expect(b.phase).toEqual({ kind: 'gate', index: 1 })
    const c = await engine.decide(a.runId, { optionId: 'pass' }).settled
    expect(c.state).toBe('done')
  })
})

describe('暂停与恢复', () => {
  it('pause→paused;resume 后有待决策则回 waiting-decision', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const engine = createEngine(deps(def))
    const a = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    const paused = await engine.pause(a.runId)
    expect(paused.state).toBe('paused')
    const resumed = await engine.resume(a.runId).settled
    expect(resumed.state).toBe('waiting-decision')
    const done = await engine.decide(a.runId, { optionId: 'pass' }).settled
    expect(done.state).toBe('done')
  })

  it('abort：把停在门上的运行落到 aborted 终局', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const engine = createEngine(deps(def))
    const a = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(a.state).toBe('waiting-decision')
    const aborted = await engine.abort(a.runId)
    expect(aborted?.state).toBe('aborted')
    expect(engine.getRunState(a.runId)?.state).toBe('aborted')
  })

  it('abort：暂停中的运行也能落到 aborted', async () => {
    const repo = trash.track(initRepo())
    const def = wf([
      engineNode('create-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const engine = createEngine(deps(def))
    const a = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    const paused = await engine.pause(a.runId)
    expect(paused.state).toBe('paused')
    const aborted = await engine.abort(a.runId)
    expect(aborted?.state).toBe('aborted')
  })

  it('abort：已终局(done)幂等返回、未知运行返回 null', async () => {
    const repo = trash.track(initRepo())
    const def = wf([engineNode('create-branch'), engineNode('delete-branch')])
    const engine = createEngine(deps(def))
    const a = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(a.state).toBe('done')
    const again = await engine.abort(a.runId)
    expect(again?.state).toBe('done')
    expect(await engine.abort('no-such-run')).toBeNull()
  })
})

describe('建分支统一递增避撞(avoidBranchConflict)', () => {
  const nonEmpty = (s: string | null): boolean => !!s && s.trim() !== ''

  it('opt-in + slug 分支在某仓已存在 → 全仓统一递增到 slug-2、在 slug-2 建分支与 worktree', async () => {
    const a = trash.track(initRepo())
    const b = trash.track(initRepo())
    git(a, 'branch', 'feat/x') // A 预置同名分支制造冲突;B 干净——期望两仓一起改用 feat/x-2
    const engine = createEngine(deps(wf([engineNode('create-branch'), engineNode('open-worktree')])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [
        { memberId: 'A', repoPath: a },
        { memberId: 'B', repoPath: b }
      ],
      avoidBranchConflict: true
    }).settled
    expect(bp.state).toBe('done')
    expect(bp.request.branch).toBe('feat/x-2')
    expect(bp.members!.A.branch).toBe('feat/x-2')
    expect(bp.members!.B.branch).toBe('feat/x-2')
    expect(nonEmpty(makeGitRunner(a)(['branch', '--list', 'feat/x-2']))).toBe(true)
    expect(nonEmpty(makeGitRunner(b)(['branch', '--list', 'feat/x-2']))).toBe(true)
    expect(existsSync(bp.members!.A.worktreePath)).toBe(true)
    expect(existsSync(bp.members!.B.worktreePath)).toBe(true)
  })

  it('未 opt-in → 沿用幂等认领:slug 已存在也不改名(保既有直接运行语义)', async () => {
    const a = trash.track(initRepo())
    git(a, 'branch', 'feat/x')
    const engine = createEngine(deps(wf([engineNode('create-branch')])))
    const bp = await engine.start({ workflowId: 'wf', repoPath: a, branch: 'feat/x', baseBranch: 'main' })
      .settled
    expect(bp.state).toBe('done')
    expect(bp.request.branch).toBe('feat/x')
  })

  it('resume 沿用已烙入的递增分支名、不再递增(恢复稳定,不造孤儿)', async () => {
    const a = trash.track(initRepo())
    git(a, 'branch', 'feat/x') // 首次冲突 → 解析到 feat/x-2
    const def = wf([
      engineNode('create-branch', [{ kind: 'manual', actions: [] }]),
      engineNode('delete-branch')
    ])
    const engine = createEngine(deps(def))
    const started = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      baseBranch: 'main',
      avoidBranchConflict: true
    }).settled
    expect(started.request.branch).toBe('feat/x-2')
    expect(nonEmpty(makeGitRunner(a)(['branch', '--list', 'feat/x-2']))).toBe(true)
    // feat/x-2 此刻已被本运行占用;resume MUST NOT 再递增到 feat/x-3
    const resumed = await engine.resume(started.runId).settled
    expect(resumed.request.branch).toBe('feat/x-2')
    expect(nonEmpty(makeGitRunner(a)(['branch', '--list', 'feat/x-3']))).toBe(false)
  })
})

describe('多仓扇出(一卡多仓建分支)', () => {
  const nonEmpty = (s: string | null): boolean => !!s && s.trim() !== ''

  it('create-branch 缺省(=all) 在涉及仓各建同名分支', async () => {
    const a = trash.track(initRepo())
    const b = trash.track(initRepo())
    const engine = createEngine(deps(wf([engineNode('create-branch')])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [
        { memberId: 'A', repoPath: a },
        { memberId: 'B', repoPath: b }
      ]
    }).settled
    expect(bp.state).toBe('done')
    expect(nonEmpty(makeGitRunner(a)(['branch', '--list', 'feat/x']))).toBe(true)
    expect(nonEmpty(makeGitRunner(b)(['branch', '--list', 'feat/x']))).toBe(true)
  })

  it('target=repo 只在指定成员建分支', async () => {
    const a = trash.track(initRepo())
    const b = trash.track(initRepo())
    const cb = engineNode('create-branch')
    cb.target = { kind: 'repo', memberId: 'B' }
    const engine = createEngine(deps(wf([cb])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [
        { memberId: 'A', repoPath: a },
        { memberId: 'B', repoPath: b }
      ]
    }).settled
    expect(bp.state).toBe('done')
    expect(makeGitRunner(a)(['branch', '--list', 'feat/x'])).toBe('')
    expect(nonEmpty(makeGitRunner(b)(['branch', '--list', 'feat/x']))).toBe(true)
  })

  it('target=tag 按成员仓标签筛', async () => {
    const a = trash.track(initRepo())
    const b = trash.track(initRepo())
    const cb = engineNode('create-branch')
    cb.target = { kind: 'tag', tag: '后端' }
    const engine = createEngine(deps(wf([cb])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [
        { memberId: 'A', repoPath: a, tag: '前端' },
        { memberId: 'B', repoPath: b, tag: '后端' }
      ]
    }).settled
    expect(bp.state).toBe('done')
    expect(makeGitRunner(a)(['branch', '--list', 'feat/x'])).toBe('')
    expect(nonEmpty(makeGitRunner(b)(['branch', '--list', 'feat/x']))).toBe(true)
  })

  it('逐仓解析各自主线为基(A=master / B=main)', async () => {
    const a = trash.track(initRepo())
    git(a, 'branch', '-m', 'master') // A 主线改名 master
    const b = trash.track(initRepo()) // B 主线 main
    const engine = createEngine(deps(wf([engineNode('create-branch')])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [
        { memberId: 'A', repoPath: a },
        { memberId: 'B', repoPath: b }
      ]
    }).settled
    expect(bp.state).toBe('done')
    expect(git(a, 'rev-parse', 'feat/x')).toBe(git(a, 'rev-parse', 'master'))
    expect(git(b, 'rev-parse', 'feat/x')).toBe(git(b, 'rev-parse', 'main'))
    expect(bp.members?.A.baseBranch).toBe('master')
    expect(bp.members?.B.baseBranch).toBe('main')
  })

  it('单仓退化(无 repos)行为不变', async () => {
    const a = trash.track(initRepo())
    const engine = createEngine(deps(wf([engineNode('create-branch')])))
    const bp = await engine.start({ workflowId: 'wf', repoPath: a, branch: 'feat/x', baseBranch: 'main' }).settled
    expect(bp.state).toBe('done')
    expect(nonEmpty(makeGitRunner(a)(['branch', '--list', 'feat/x']))).toBe(true)
  })

  it('子集中某成员失败进入可见等待决策(不静默成功)', async () => {
    const a = trash.track(initRepo())
    const bogus = join(a, '..', `not-a-repo-${Date.now()}`)
    const engine = createEngine(deps(wf([engineNode('create-branch')])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [
        { memberId: 'A', repoPath: a },
        { memberId: 'B', repoPath: bogus }
      ]
    }).settled
    expect(bp.state).not.toBe('done')
  })
})

describe('默认全建 + 自然回收(GC 安全)', () => {
  const nonEmpty = (s: string | null): boolean => !!s && s.trim() !== ''

  it('空分支 merge 报 noop、随后安全删回收', async () => {
    const b = trash.track(initRepo())
    const def = wf([engineNode('create-branch'), engineNode('merge-branch'), engineNode('delete-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: b,
      branch: 'feat/x',
      repos: [{ memberId: 'B', repoPath: b }]
    }).settled
    expect(bp.state).toBe('done')
    expect(makeGitRunner(b)(['branch', '--list', 'feat/x'])).toBe('') // 空分支被回收
  })

  it('有未合并提交的分支安全删被拒(保护)、进入可见停点', async () => {
    const a = trash.track(initRepo())
    git(a, 'checkout', '-q', '-b', 'feat/x')
    writeFileSync(join(a, 'w.txt'), 'work\n')
    git(a, 'add', '-A')
    git(a, 'commit', '-q', '-m', 'dev')
    git(a, 'checkout', '-q', 'main')
    const engine = createEngine(deps(wf([engineNode('delete-branch')])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [{ memberId: 'A', repoPath: a }]
    }).settled
    expect(bp.state).not.toBe('done') // 未合并 → 保护 → 可见停点
    expect(nonEmpty(makeGitRunner(a)(['branch', '--list', 'feat/x']))).toBe(true)
  })

  it('worktree 有未提交改动时 delete-branch 级联拒删(非 force)、保护未提交工作', async () => {
    const a = trash.track(initRepo())
    git(a, 'branch', 'feat/x')
    const wt = trash.track(join(a, '..', `wt-dirty-${Date.now()}`))
    git(a, 'worktree', 'add', wt, 'feat/x')
    writeFileSync(join(wt, 'a.txt'), 'uncommitted edit\n') // 弄脏 tracked 文件、不提交
    const engine = createEngine(deps(wf([engineNode('delete-branch')])))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [{ memberId: 'A', repoPath: a }]
    }).settled
    expect(bp.state).not.toBe('done') // 拒删 → 可见停点
    expect(existsSync(wt)).toBe(true) // worktree 仍在
    expect(nonEmpty(makeGitRunner(a)(['branch', '--list', 'feat/x']))).toBe(true) // 分支仍在
  })

  it('push-branch 对空分支 skip(不建垃圾远端分支)', async () => {
    const a = trash.track(initRepo())
    const bare = withOrigin(a)
    git(a, 'push', '-q', 'origin', 'main')
    const def = wf([engineNode('create-branch'), engineNode('push-branch')])
    const engine = createEngine(deps(def))
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [{ memberId: 'A', repoPath: a }]
    }).settled
    expect(bp.state).toBe('done')
    expect(makeGitRunner(bare)(['branch', '--list', 'feat/x'])).toBe('') // 空分支未推
  })
})

describe('多仓兼容与恢复', () => {
  it('无 cardId/repos 的运行按单仓上下文跑到 done(向后兼容)', async () => {
    const a = trash.track(initRepo())
    const bp = await createEngine(deps(wf([engineNode('create-branch')]))).start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      baseBranch: 'main'
    }).settled
    expect(bp.state).toBe('done')
    expect(bp.request.cardId).toBeUndefined()
  })

  it('旧断点(无 cardId/repos/members)可读并续跑', async () => {
    const a = trash.track(initRepo())
    const store = createMemoryRunStore()
    store.save({
      runId: 'legacy-1',
      request: {
        workflowId: 'wf',
        repoPath: a,
        branch: 'feat/x',
        baseBranch: 'main',
        worktreePath: join(a, '..', `wt-legacy-${Date.now()}`)
      },
      state: 'running',
      currentNodeId: null,
      phase: { kind: 'executing' },
      pendingDecision: null
    } as RunBreakpoint)
    const bp = await createEngine(deps(wf([engineNode('create-branch')]), { store })).resume('legacy-1').settled
    expect(bp.state).toBe('done')
  })

  it('resume 重新派生每成员上下文保持一致(same-input → same-derive)', async () => {
    const a = trash.track(initRepo())
    const b = trash.track(initRepo())
    const store = createMemoryRunStore()
    const def = wf([engineNode('create-branch', [{ kind: 'manual', actions: [] }])])
    const engine = createEngine(deps(def, { store }))
    const first = await engine.start({
      workflowId: 'wf',
      repoPath: a,
      branch: 'feat/x',
      repos: [
        { memberId: 'A', repoPath: a },
        { memberId: 'B', repoPath: b }
      ]
    }).settled
    expect(first.state).toBe('waiting-decision')
    const before = first.members
    const resumed = await engine.resume(first.runId).settled
    expect(resumed.members).toEqual(before)
    expect(resumed.members?.A.baseBranch).toBe('main')
    expect(resumed.members?.B.baseBranch).toBe('main')
  })
})

describe('external 外部门（等平台合并 / 开始收尾 / 打回回退）', () => {
  const EXT: WorkflowNode['gate'] = [{ kind: 'external', verify: 'pr-merged' }]
  function seedFeature(repo: string): void {
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(repo, 'f.txt'), 'feature\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'feature work')
    git(repo, 'checkout', '-q', 'main')
  }

  it('平台已合并 → 外部门过门 → done', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    seedFeature(repo)
    git(repo, 'merge', '-q', '--no-edit', 'feature') // 模拟平台已合并
    git(repo, 'push', '-q', 'origin', 'main')
    const def = wf([engineNode('create-branch', EXT)])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('done')
  })

  it('尚未合并 → waiting-decision，source `:external-gate`，含前进式「开始收尾」(recheck)', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    seedFeature(repo)
    git(repo, 'push', '-q', 'origin', 'feature') // 推上但未合并
    const def = wf([engineNode('create-branch', EXT)])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('waiting-decision')
    const d = bp.pendingDecision!
    expect(d.source.endsWith(':external-gate')).toBe(true)
    expect(d.sourceKind).toBe('engine')
    const ids = d.options.map((o) => o.id)
    expect(ids).not.toContain('abort')
    expect(ids).toContain('recheck')
    expect(d.input).toBeTruthy() // 打回入口（自由输入框）
  })

  it('开始收尾以核查为准：未合并时点 recheck → 再次挂起（不盲信）；合并后 → 过门 done', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    seedFeature(repo)
    git(repo, 'push', '-q', 'origin', 'feature')
    const def = wf([engineNode('create-branch', EXT)])
    const engine = createEngine(deps(def))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('waiting-decision')
    // 还没合并就点「开始收尾」→ 再核查判未达成 → 再次挂起（不放行），且标题换成「检测到尚未合并」反馈
    const again = await engine.decide(bp.runId, { optionId: 'recheck' }).settled
    expect(again.state).toBe('waiting-decision')
    expect(again.pendingDecision!.source.endsWith(':external-gate')).toBe(true)
    expect(again.pendingDecision!.titleKey).toBe('engineDecision.prStillNotMerged')
    // 现在平台合并 → 点「开始收尾」→ 过门 done
    git(repo, 'merge', '-q', '--no-edit', 'feature')
    git(repo, 'push', '-q', 'origin', 'main')
    const done = await engine.decide(again.runId, { optionId: 'recheck' }).settled
    expect(done.state).toBe('done')
  })

  it('open-pr 回报 PR 链接 → 持久化 + 外部门决策带可点击 links', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    seedFeature(repo)
    git(repo, 'push', '-q', 'origin', 'feature') // 推上但未合并 → 外部门会挂起
    const def = wf([engineNode('open-pr', EXT)])
    const engine = createEngine(
      deps(def, {
        runAgent: stubAgentRunner(),
        prepareAgent: () => ({ prompt: 'X', toolId: 'claude-code' }),
        readHandshake: () => ({ status: 'done' as const, prs: [{ repo: 'app', url: 'https://github.com/me/app/pull/7' }] })
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('waiting-decision')
    // open-pr 回报的链接被持久化
    const anyLinks = Object.values(bp.prLinks ?? {}).flat()
    expect(anyLinks).toContainEqual({ repo: 'app', url: 'https://github.com/me/app/pull/7' })
    // 外部门决策把它呈现成可点击 links（label=仓名、url=网址）
    expect(bp.pendingDecision?.links).toEqual([{ label: 'app', url: 'https://github.com/me/app/pull/7' }])
  })

  it('兜底：agent 把 PR 链接写进 note（非 prs）也能捞出并呈现', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    seedFeature(repo)
    git(repo, 'push', '-q', 'origin', 'feature')
    const def = wf([engineNode('open-pr', EXT)])
    const engine = createEngine(
      deps(def, {
        runAgent: stubAgentRunner(),
        prepareAgent: () => ({ prompt: 'X', toolId: 'claude-code' }),
        // 没有结构化 prs，链接藏在 note 散文里
        readHandshake: () => ({ status: 'done' as const, note: '已开 PR：https://github.com/o/app/pull/1（待合并）' })
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.pendingDecision?.links).toEqual([{ label: '查看 PR', url: 'https://github.com/o/app/pull/1' }])
  })

  it('open-pr 不产生代码提交：agent 留下的 worktree 改动被丢弃、HEAD 不变（免得多出没进 PR 的本地提交）', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(repo, 'f.txt'), 'feature\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'feature work')
    git(repo, 'push', '-q', 'origin', 'feature')
    const tipBefore = git(repo, 'rev-parse', 'HEAD')
    // agent 在 worktree（cwd）里乱改文件，模拟 open-pr agent 留下改动
    const dirtyRunner: AgentRunner = {
      supportsResume: () => true,
      start: (spec) => {
        writeFileSync(join(spec.cwd, 'f.txt'), 'dirtied by open-pr agent\n')
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
    }
    const def = wf([engineNode('open-pr', EXT)])
    const engine = createEngine(
      deps(def, {
        runAgent: dirtyRunner,
        prepareAgent: () => ({ prompt: 'X', toolId: 'claude-code' }),
        readHandshake: () => ({ status: 'done' as const })
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tipBefore) // 没多出提交
    expect(git(repo, 'status', '--porcelain')).toBe('') // agent 改动被丢弃、worktree 干净
    expect(bp.state).toBe('waiting-decision') // 外部门（feature 未合并）挂起
  })

  it('打回：外部门自由文本 → 内容驱动回退(判定 agent)，非就地处置', async () => {
    const repo = trash.track(initRepo())
    withOrigin(repo)
    git(repo, 'push', '-q', 'origin', 'main')
    seedFeature(repo)
    git(repo, 'push', '-q', 'origin', 'feature')
    // 固定 id 节点：prep（可被 judge 提名回退）+ 挂外部门的 gated。
    const prep: WorkflowNode = { id: 'prep', name: { zh: '准备' }, stageId: 's', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [] }
    const gated: WorkflowNode = { id: 'gated', name: { zh: '关口' }, stageId: 's', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [], gate: EXT }
    const judgeHs = { status: 'need-decision' as const, decision: { title: '根因在准备', options: [{ id: 'prep', label: '准备', recommended: true }] } }
    const engine = createEngine(
      deps(wf([prep, gated]), {
        runAgent: stubAgentRunner(),
        prepareHealAgent: () => ({ prompt: 'JUDGE', toolId: 'claude-code' }),
        readHandshake: () => judgeHs
      })
    )
    const atGate = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(atGate.pendingDecision?.source).toBe('gated:external-gate')
    // 在外部门自由输入写反馈 → 走内容驱动回退（判定 → 回退确认），而非就地处置
    const confirm = await engine.decide(atGate.runId, { text: '这段要改' }).settled
    expect(confirm.state).toBe('waiting-decision')
    expect(confirm.pendingDecision?.source).toBe('gated:rollback-confirm')
    expect(confirm.pendingDecision?.options.map((o) => o.id)).toContain('prep')
  })
})

describe('open-pr（平台预制节点，内部委派 agent）', () => {
  /** 最小 agent 运行器桩：记录被喂的 prompt，直接成功退出。 */
  function stubRunner(): AgentRunner & { calls: number } {
    const r = {
      calls: 0,
      supportsResume: () => true,
      start(): ReturnType<AgentRunner['start']> {
        r.calls++
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume(): ReturnType<AgentRunner['resume']> {
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      }
    }
    return r
  }

  it('委派 agent 开 PR：prepareAgent 收到 agent+inline 指令、跑到 done', async () => {
    const repo = trash.track(initRepo())
    let seen: WorkflowNode | null = null
    const runner = stubRunner()
    const def = wf([engineNode('open-pr')])
    const engine = createEngine(
      deps(def, {
        runAgent: runner,
        prepareAgent: (node) => {
          seen = node
          return { prompt: 'X', toolId: 'claude-code' }
        },
        readHandshake: () => ({ status: 'done' })
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('done')
    expect(runner.calls).toBe(1) // 确实委派了一个 agent
    expect(seen!.executor.kind).toBe('agent')
    const instr = (seen!.executor as { instruction?: { kind: string; text?: string } }).instruction
    expect(instr?.kind).toBe('inline')
    expect(instr?.text ?? '').toMatch(/PR|MR|合并请求/)
  })

  it('无可用 agent（未注入 prepareAgent）→ 终局失败抛决策，不静默跳过', async () => {
    const repo = trash.track(initRepo())
    const events: EngineProgressEvent[] = []
    const def = wf([engineNode('open-pr')])
    const engine = createEngine(deps(def, { emit: (e) => events.push(e) }))
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision?.sourceKind).toBe('engine')
    // 不是被当作「未落地执行器」静默跳过
    expect(events.some((e) => e.kind === 'skip')).toBe(false)
  })
})

describe('archive-docs（平台预制节点，内部委派 agent 按节点自带分类配置归档并提交）', () => {
  const reg = (over: Partial<DocRegistry> = {}): DocRegistry => ({
    memberId: '<single>',
    docs: [{ id: 'DOC.md', location: 'DOC.md', kind: 'dynamic', habitPrompt: '', approved: false }],
    conventionPreamble: '',
    conventionApproved: false,
    ...over
  })
  /** 在 repo 上建 feature 分支并切过去（归档 agent 在其上写文档 → scopeGuard 提交）。 */
  function onFeature(repo: string): void {
    git(repo, 'checkout', '-q', '-b', 'feature')
  }
  /** agent 运行器桩：在 cwd 里把 `path` 写成 `content`（模拟归档 agent 落文档），记录调用次数与被喂 prompt。 */
  function archivingRunner(path: string, content: string): AgentRunner & { calls: number; prompts: string[] } {
    const r = {
      calls: 0,
      prompts: [] as string[],
      supportsResume: () => true,
      start(spec: Parameters<AgentRunner['start']>[0]): ReturnType<AgentRunner['start']> {
        r.calls++
        if (spec.prompt) r.prompts.push(spec.prompt)
        writeFileSync(join(spec.cwd, path), content)
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume(): ReturnType<AgentRunner['resume']> {
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      }
    }
    return r
  }

  it('节点带配置但无可用 agent（未注入 prepareAgent）→ no-agent 挂起，不静默跳过', async () => {
    const repo = trash.track(initRepo())
    onFeature(repo)
    const events: EngineProgressEvent[] = []
    const node = engineNode('archive-docs')
    ;(node.executor as { archiveDocs?: ArchiveDocEntry[] }).archiveDocs = [{ path: 'README.md', kind: 'dynamic' }]
    const engine = createEngine(
      deps(wf([node]), {
        emit: (e) => events.push(e)
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision?.sourceKind).toBe('engine')
    expect(bp.pendingDecision?.titleKey).toBe('engineDecision.archiveNoAgent')
    expect(events.some((e) => e.kind === 'skip')).toBe(false)
  })

  it('节点无配置（无 executor.archiveDocs）→ no-op：不读扫描登记表、不委派 agent、不提交、过节点', async () => {
    const repo = trash.track(initRepo())
    onFeature(repo)
    const tipBefore = git(repo, 'rev-parse', 'HEAD')
    const runner = archivingRunner('DOC.md', 'x')
    let registryConsulted = false
    const engine = createEngine(
      deps(wf([engineNode('archive-docs')]), {
        runAgent: runner,
        getDocRegistry: () => {
          registryConsulted = true
          return reg()
        },
        prepareAgent: () => ({ prompt: 'X', toolId: 'claude-code' }),
        readHandshake: () => ({ status: 'done' as const })
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('done')
    // 不回落读扫描登记表（no-op，不再依赖登记表）
    expect(registryConsulted).toBe(false)
    // 不委派 agent、不提交
    expect(runner.calls).toBe(0)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tipBefore)
  })

  it('节点带空清单（executor.archiveDocs=[]）→ no-op：不读登记表、不委派、过节点', async () => {
    const repo = trash.track(initRepo())
    onFeature(repo)
    const runner = archivingRunner('DOC.md', 'x')
    let registryConsulted = false
    const node = engineNode('archive-docs')
    ;(node.executor as { archiveDocs?: ArchiveDocEntry[] }).archiveDocs = []
    const engine = createEngine(
      deps(wf([node]), {
        runAgent: runner,
        getDocRegistry: () => {
          registryConsulted = true
          return reg()
        },
        prepareAgent: () => ({ prompt: 'X', toolId: 'claude-code' }),
        readHandshake: () => ({ status: 'done' as const })
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('done')
    expect(registryConsulted).toBe(false)
    expect(runner.calls).toBe(0)
  })

  it('节点自带分类文档配置（executor.archiveDocs）→ 按 kind 归档、不读扫描登记表', async () => {
    const repo = trash.track(initRepo())
    onFeature(repo)
    const tipBefore = git(repo, 'rev-parse', 'HEAD')
    let seen: WorkflowNode | null = null
    let registryConsulted = false
    const node = engineNode('archive-docs')
    ;(node.executor as { archiveDocs?: ArchiveDocEntry[] }).archiveDocs = [
      { path: 'README.md', kind: 'dynamic' },
      { path: 'docs/adr.md', kind: 'snapshot' }
    ]
    const engine = createEngine(
      deps(wf([node]), {
        runAgent: archivingRunner('README.md', '# 最新现状\n'),
        getDocRegistry: () => {
          registryConsulted = true
          return reg()
        },
        prepareAgent: (n) => {
          seen = n
          return { prompt: 'X', toolId: 'claude-code' }
        },
        readHandshake: () => ({ status: 'done' as const })
      })
    )
    const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
    expect(bp.state).toBe('done')
    // 不读扫描登记表（不触发文档扫描）
    expect(registryConsulted).toBe(false)
    // 委派的是 agent+inline 节点，指令由配置合成（含 author 列的两条路径）
    expect(seen!.executor.kind).toBe('agent')
    const instr = (seen!.executor as { instruction?: { kind: string; text?: string } }).instruction
    expect(instr?.kind).toBe('inline')
    const text = instr?.text ?? ''
    expect(text).toContain('README.md')
    expect(text).toContain('docs/adr.md')
    // 按 kind 路由：README 动态就地更新、docs/adr.md 快照追加冻结
    const readmeIdx = text.indexOf('README.md')
    const adrIdx = text.indexOf('docs/adr.md')
    const readmeSeg = text.slice(readmeIdx, adrIdx)
    const adrSeg = text.slice(adrIdx)
    expect(readmeSeg).toMatch(/就地更新|最新现状/)
    expect(adrSeg).toMatch(/追加|冻结/)
    // writableScope 收窄到配置里的两条路径
    expect(new Set(seen!.writableScope ?? [])).toEqual(new Set(['README.md', 'docs/adr.md']))
    // 文档改动被提交（配置里被写的那条进版本历史）
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(tipBefore)
    expect(git(repo, 'show', 'HEAD:README.md')).toContain('最新现状')
  })

  it('节点自带配置 → 委派指令按子 agent 能力给并行/串行提示', async () => {
    const run = async (subagents: boolean): Promise<string> => {
      const repo = trash.track(initRepo())
      onFeature(repo)
      let text = ''
      const node = engineNode('archive-docs')
      ;(node.executor as { archiveDocs?: ArchiveDocEntry[] }).archiveDocs = [{ path: 'README.md', kind: 'dynamic' }]
      const engine = createEngine(
        deps(wf([node]), {
          runAgent: archivingRunner('README.md', 'x'),
          getDocRegistry: () => reg(),
          supportsSubagents: () => subagents,
          prepareAgent: (n) => {
            text = (n.executor as { instruction?: { text?: string } }).instruction?.text ?? ''
            return { prompt: 'X', toolId: 'claude-code' }
          },
          readHandshake: () => ({ status: 'done' as const })
        })
      )
      const bp = await engine.start({ workflowId: 'wf', repoPath: repo, branch: 'feature', baseBranch: 'main' }).settled
      expect(bp.state).toBe('done')
      return text
    }
    expect(await run(true)).toMatch(/并行|子 ?agent/)
    expect(await run(false)).toMatch(/顺次|逐条|串行/)
  })

})
