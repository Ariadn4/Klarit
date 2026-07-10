import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { git, initRepo, initBare, makeTrash } from '../git-test-helpers'
import { makeGitRunner } from '../git'
import type { EngineProgressEvent, RunBreakpoint, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type EngineDeps } from './engine'
import { createMemoryRunStore } from './run-store'

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
