import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHandshake, RunRequest, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type EngineDeps, type AgentPrep } from './engine'
import { createMemoryRunStore } from './run-store'
import { memberWorktreePath } from './branch-naming'
import type { AgentRunner, AgentRunSpec } from '../agent/runner'

let nid = 0
function agentNode(gate?: WorkflowNode['gate']): WorkflowNode {
  return {
    id: `a${nid++}`,
    name: { zh: 'implement' },
    stageId: 's',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: '实现' } },
    outputs: [],
    ...(gate ? { gate } : {})
  }
}
function wf(nodes: WorkflowNode[]): WorkflowDefinition {
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes }
}

/** 假 agent 运行器：不真拉进程，退出码可控；记录 start/resume 调用。 */
function fakeRunner(exit: { code: number; killed?: boolean } = { code: 0 }): AgentRunner & {
  starts: number
  resumes: number
} {
  const r = {
    starts: 0,
    resumes: 0,
    supportsResume: () => true,
    start(): ReturnType<AgentRunner['start']> {
      r.starts++
      return { kill: () => {}, done: Promise.resolve({ code: exit.code, killed: exit.killed ?? false }) }
    },
    resume(): ReturnType<AgentRunner['resume']> {
      r.resumes++
      return { kill: () => {}, done: Promise.resolve({ code: exit.code, killed: exit.killed ?? false }) }
    }
  }
  return r
}

const prep: AgentPrep = { prompt: 'P', toolId: 'claude-code' }
const REQ: RunRequest = {
  workflowId: 'wf',
  repoPath: '/no/repo',
  branch: 'card-x',
  worktreePath: '/no/wt',
  baseBranch: 'main'
}

function engineWith(def: WorkflowDefinition, extra: Partial<EngineDeps>): ReturnType<typeof createEngine> {
  return createEngine({
    getWorkflow: (id) => (id === def.id ? def : null),
    store: createMemoryRunStore(),
    runAgent: fakeRunner(),
    prepareAgent: () => prep,
    ...extra
  })
}

describe('agent 节点执行 — 握手分流', () => {
  it('握手 done → 节点完成、运行到 done', async () => {
    const def = wf([agentNode()])
    const runner = fakeRunner()
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => prep,
      readHandshake: () => ({ status: 'done', note: '搞定' })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(runner.starts).toBe(1)
    expect(runner.resumes).toBe(0)
  })

  it('握手缺失（乐观 done）→ 节点完成', async () => {
    const def = wf([agentNode()])
    const engine = engineWith(def, { readHandshake: () => ({ status: 'done' }) })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
  })

  it('握手 need-decision → 停在 waiting-decision，sourceKind=agent', async () => {
    const def = wf([agentNode()])
    const engine = engineWith(def, {
      readHandshake: (): AgentHandshake => ({
        status: 'need-decision',
        decision: { title: '用 REST 还是 GraphQL？', options: [{ id: 'rest', label: '用 REST' }], freeInput: true }
      })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision?.sourceKind).toBe('agent')
    expect(bp.pendingDecision?.reason).toBe('用 REST 还是 GraphQL？')
  })

  it('prep 解析出的 model/effort 原样转发给运行器（级联在 prepare 侧完成）', async () => {
    const def = wf([agentNode()])
    const specs: AgentRunSpec[] = []
    const runner: AgentRunner = {
      supportsResume: () => true,
      start(spec) {
        specs.push(spec)
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume: () => null
    }
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => ({ prompt: 'P', toolId: 'claude-code', model: 'opus', effort: 'high' }),
      readHandshake: () => ({ status: 'done' })
    })
    await engine.start(REQ).settled
    expect(specs[0]?.model).toBe('opus')
    expect(specs[0]?.effort).toBe('high')
  })

  it('握手 repos → 填 upstreamOutputs 供下游收窄', async () => {
    const node = agentNode()
    const def = wf([node])
    const engine = engineWith(def, { readHandshake: () => ({ status: 'done', repos: ['<single>'] }) })
    const bp = await engine.start(REQ).settled
    // 单仓退化成员 id 为 <single>；取交后保留
    expect(bp.upstreamOutputs?.[node.id]?.repos).toEqual(['<single>'])
  })
})

describe('agent 节点自愈 — 失败限次续接、超限升级', () => {
  it('failed 两次后 done → 续接自愈修复（start 1 次、resume 2 次），运行到 done', async () => {
    const def = wf([agentNode()])
    const runner = fakeRunner()
    let calls = 0
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => prep,
      readHandshake: (): AgentHandshake =>
        ++calls <= 2 ? { status: 'failed', detail: `第 ${calls} 次失败` } : { status: 'done' }
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(runner.starts).toBe(3) // 首跑 + 两次自愈续接（均以完整任务全新拉起）
    expect(runner.resumes).toBe(0) // native resume 暂停用
  })

  it('抓到 session id 后自愈 → 走 --resume（精确续接），不重新 start', async () => {
    const def = wf([agentNode()])
    let hs = 0
    const runner = {
      starts: 0,
      resumes: 0,
      supportsResume: (): boolean => true,
      start(spec: Parameters<AgentRunner['start']>[0]) {
        runner.starts++
        spec.onSession?.('sess-x') // 首跑抓到 session id
        return { kill: (): void => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume() {
        runner.resumes++
        return { kill: (): void => {}, done: Promise.resolve({ code: 0, killed: false }) }
      }
    }
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => prep,
      readHandshake: (): AgentHandshake => (++hs === 1 ? { status: 'failed', detail: 'x' } : { status: 'done' })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(bp.agentRuns?.[def.nodes[0].id]?.session).toBe('sess-x') // session 存进断点
    expect(runner.starts).toBe(1) // 首跑 start
    expect(runner.resumes).toBe(1) // 自愈走 --resume（不再 start）
  })

  it('failed 超过上限 → 升级为 sourceKind=agent 决策', async () => {
    const def = wf([agentNode()])
    const engine = engineWith(def, { readHandshake: () => ({ status: 'failed', detail: '一直不过' }) })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision?.sourceKind).toBe('agent')
  })
})

describe('agent 决策答复经续接注入原 agent', () => {
  it('need-decision → 用户选项回答 → 续接注入 → 完成', async () => {
    const def = wf([agentNode()])
    const runner = fakeRunner()
    let call = 0
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => prep,
      readHandshake: (): AgentHandshake =>
        ++call === 1
          ? { status: 'need-decision', decision: { title: 'REST 还是 GraphQL？', options: [{ id: 'rest', label: '用 REST' }] } }
          : { status: 'done' }
    })
    const first = await engine.start(REQ).settled
    expect(first.state).toBe('waiting-decision')
    const done = await engine.decide(first.runId, { optionId: 'rest' }).settled
    expect(done.state).toBe('done')
    expect(runner.starts).toBe(2) // 答复经续接（完整任务 + 决策答复）拉起
  })
})

describe('多仓：一个 agent 跨仓（extraDirs 带其余目标仓）', () => {
  const tmps: string[] = []
  afterEach(() => {
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('target=all 两成员仓 → 一个 agent，主仓作 cwd、另一仓进 extraDirs', async () => {
    const base = mkdtempSync(join(tmpdir(), 'multi-'))
    tmps.push(base)
    const webRepo = join(base, 'web')
    const apiRepo = join(base, 'api')
    mkdirSync(webRepo)
    mkdirSync(apiRepo)
    // 预建引擎将派生出的 worktree 目录（repo 同级 basename--wt--branch），使 existsSync 通过
    const wtWeb = memberWorktreePath(webRepo, 'card-x')
    const wtApi = memberWorktreePath(apiRepo, 'card-x')
    mkdirSync(wtWeb)
    mkdirSync(wtApi)

    const def = wf([agentNode()])
    let captured: AgentRunSpec | undefined
    const runner: AgentRunner = {
      supportsResume: () => true,
      start: (spec) => {
        captured = spec
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
    }
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => prep,
      readHandshake: () => ({ status: 'done' })
    })
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: webRepo,
      branch: 'card-x',
      baseBranch: 'main',
      repos: [
        { memberId: 'web', repoPath: webRepo },
        { memberId: 'api', repoPath: apiRepo }
      ]
    }).settled
    expect(bp.state).toBe('done')
    expect(captured?.cwd).toBe(wtWeb) // 主目标仓作 cwd
    expect(captured?.extraDirs).toContain(wtApi) // 另一仓进 extraDirs（一个 agent 跨仓；另含握手目录）
    expect(captured?.extraDirs).not.toContain(wtWeb)
  })

  it('上游 agent 判定 repos=[api] → 下游 target=fromUpstream 只作用 api', async () => {
    const base = mkdtempSync(join(tmpdir(), 'fu-'))
    tmps.push(base)
    const webRepo = join(base, 'web')
    const apiRepo = join(base, 'api')
    mkdirSync(webRepo)
    mkdirSync(apiRepo)
    mkdirSync(memberWorktreePath(webRepo, 'card-x'))
    const wtApi = memberWorktreePath(apiRepo, 'card-x')
    mkdirSync(wtApi)

    const upstream = agentNode()
    const downstream: WorkflowNode = { ...agentNode(), target: { kind: 'fromUpstream', nodeId: upstream.id } }
    const def = wf([upstream, downstream])
    const specs: AgentRunSpec[] = []
    const runner: AgentRunner = {
      supportsResume: () => true,
      start: (spec) => {
        specs.push(spec)
        return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
      },
      resume: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
    }
    let hsCalls = 0
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => prep,
      // 上游（第一个 agent）握手声明只涉及 api；下游 done
      readHandshake: () => (hsCalls++ === 0 ? { status: 'done', repos: ['api'] } : { status: 'done' })
    })
    const bp = await engine.start({
      workflowId: 'wf',
      repoPath: webRepo,
      branch: 'card-x',
      baseBranch: 'main',
      repos: [
        { memberId: 'web', repoPath: webRepo },
        { memberId: 'api', repoPath: apiRepo }
      ]
    }).settled
    expect(bp.state).toBe('done')
    expect(bp.upstreamOutputs?.[upstream.id]?.repos).toEqual(['api'])
    // 下游（第二个 start）被收窄到 api：cwd = api worktree
    expect(specs[1]?.cwd).toBe(wtApi)
  })
})

describe('崩溃/关软件后恢复 → agent 节点走续接', () => {
  it('已开始（startSha 已记）、running、停在 executing 的 agent 节点，恢复走续接而非从头', async () => {
    const def = wf([agentNode()])
    const nodeId = def.nodes[0].id
    const store = createMemoryRunStore()
    const runner = fakeRunner()
    const engine = createEngine({
      getWorkflow: () => def,
      store,
      runAgent: runner,
      prepareAgent: () => prep,
      readHandshake: () => ({ status: 'done' })
    })
    // 预置「已开始（基线已记）、running、停在 executing」断点，模拟崩溃半路
    store.save({
      runId: 'r-crash',
      request: { ...REQ },
      state: 'running',
      currentNodeId: nodeId,
      phase: { kind: 'executing' },
      pendingDecision: null,
      agentRuns: { [nodeId]: { startSha: { '<single>': 'abc123' } } }
    })
    const bp = await engine.resume('r-crash').settled
    expect(bp.state).toBe('done')
    expect(runner.starts).toBe(1) // 崩溃恢复走续接（完整任务全新拉起）
    expect(runner.resumes).toBe(0)
  })
})

describe('agent 门失败 → 续接重做（带门原因）', () => {
  it('客观门首过失败 → 续接重做 → 门再过 → done', async () => {
    const gate: WorkflowNode['gate'] = [{ kind: 'auto', check: { kind: 'inline', command: 'check' } }]
    const def = wf([agentNode(gate)])
    const runner = fakeRunner()
    let gateCalls = 0
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => prep,
      readHandshake: () => ({ status: 'done' }),
      runCommand: async () => ({ code: ++gateCalls === 1 ? 1 : 0, stdout: '', stderr: '测试失败', killed: false })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(runner.starts).toBe(2) // 门失败后续接（完整任务 + 门原因）重做
  })
})
