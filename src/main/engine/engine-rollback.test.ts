import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHandshake, RunRequest, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type EngineDeps, type AgentPrep } from './engine'
import { createMemoryRunStore } from './run-store'
import { memberWorktreePath } from './branch-naming'
import type { AgentRunner } from '../agent/runner'

const trash: string[] = []
function track(d: string): string {
  trash.push(d)
  return d
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

function agentNode(id: string, name: string, gate?: WorkflowNode['gate']): WorkflowNode {
  return {
    id,
    name: { zh: name },
    stageId: 's',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: name } },
    outputs: [],
    ...(gate ? { gate } : {})
  }
}
function wf(nodes: WorkflowNode[]): WorkflowDefinition {
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes }
}

const nodePrep: AgentPrep = { prompt: 'NODE', toolId: 'claude-code' }
const judgePrep: AgentPrep = { prompt: 'JUDGE', toolId: 'claude-code' }

/** 记录所有喂给 runAgent 的 prompt（start）与 inject（resume），供断言修复前向注入。 */
function recordingRunner(onStart?: (cwd: string) => void): AgentRunner & { prompts: string[]; injects: string[] } {
  const r = {
    prompts: [] as string[],
    injects: [] as string[],
    supportsResume: () => true,
    start(spec: Parameters<AgentRunner['start']>[0]): ReturnType<AgentRunner['start']> {
      r.prompts.push(spec.prompt)
      onStart?.(spec.cwd)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    },
    resume(spec: Parameters<AgentRunner['resume']>[0]): ReturnType<AgentRunner['resume']> {
      r.injects.push(spec.inject)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    }
  }
  return r
}

const MANUAL: WorkflowNode['gate'] = [{ kind: 'manual' }]

describe('评审门驳回 → 内容驱动回退（重入模型）', () => {
  it('驳回 → 只读判定 agent → 回退确认 → 确认目标节点 → 重入前向修复回评审门', async () => {
    const def = wf([agentNode('impl', '实现'), agentNode('review', '验收', MANUAL)])
    const runner = recordingRunner()
    // 判定 agent 的握手（rollback 路径）：need-decision，提名回退到 impl。
    const judgeHs: AgentHandshake = {
      status: 'need-decision',
      decision: { title: '根因在实现', options: [{ id: 'impl', label: '实现', recommended: true }] }
    }
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => nodePrep,
      prepareHealAgent: () => judgePrep,
      readHandshake: (p) => (p.includes('rollback') ? judgeHs : { status: 'done' })
    })
    const req: RunRequest = { workflowId: 'wf', repoPath: '/no/repo', branch: 'card-x', worktreePath: '/no/wt', baseBranch: 'main' }

    // 跑到 review 的人工评审门
    const atGate = await engine.start(req).settled
    expect(atGate.state).toBe('waiting-decision')
    expect(atGate.pendingDecision?.source).toBe('review:manual-gate')
    expect(atGate.furthestNodeId).toBe('review')

    // 驳回（框里写意见提交）→ 只读判定 agent → 回退确认决策
    const confirm = await engine.decide(atGate.runId, { text: '体验不对' }).settled
    expect(confirm.state).toBe('waiting-decision')
    expect(confirm.pendingDecision?.source).toBe('review:rollback-confirm')
    expect(confirm.pendingDecision?.options.map((o) => o.id)).toEqual(['impl', 'cancel-rollback'])
    // 判定 agent 有独立记账键
    expect(confirm.healRuns?.['review:rollback-judge']).toBeDefined()

    // 确认回退到 impl → 重入前向修复 → 前向重流回评审门
    const backAtGate = await engine.decide(confirm.runId, { optionId: 'impl' }).settled
    expect(backAtGate.state).toBe('waiting-decision')
    expect(backAtGate.pendingDecision?.source).toBe('review:manual-gate')
    // 最远进展节点保留（回退未覆盖）
    expect(backAtGate.furthestNodeId).toBe('review')
    // impl 续接时注入了「修复前向」上下文（含驳回意见 + 最远节点 + 前向修复）
    const injected = [...runner.prompts, ...runner.injects].join('\n')
    expect(injected).toContain('体验不对')
    expect(injected).toContain('前向修复')
    expect(injected).toContain('验收') // 最远进展节点名
  })

  it('取消回退 → 退回评审门（门不丢失）', async () => {
    const def = wf([agentNode('review', '验收', MANUAL)])
    const judgeHs: AgentHandshake = {
      status: 'need-decision',
      decision: { options: [{ id: 'review', label: '验收', recommended: true }] }
    }
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: recordingRunner(),
      prepareAgent: () => nodePrep,
      prepareHealAgent: () => judgePrep,
      readHandshake: (p) => (p.includes('rollback') ? judgeHs : { status: 'done' })
    })
    const req: RunRequest = { workflowId: 'wf', repoPath: '/no/repo', branch: 'c', worktreePath: '/no/wt', baseBranch: 'main' }
    const atGate = await engine.start(req).settled
    const confirm = await engine.decide(atGate.runId, { text: '不满意' }).settled
    expect(confirm.pendingDecision?.source).toBe('review:rollback-confirm')
    // 取消 → 回到评审门
    const back = await engine.decide(confirm.runId, { optionId: 'cancel-rollback' }).settled
    expect(back.state).toBe('waiting-decision')
    expect(back.pendingDecision?.source).toBe('review:manual-gate')
  })

  it('判定 agent 无果（未给真实节点）→ 退回评审门', async () => {
    const def = wf([agentNode('review', '验收', MANUAL)])
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: recordingRunner(),
      prepareAgent: () => nodePrep,
      prepareHealAgent: () => judgePrep,
      // 判定给了不存在的节点 id → 被过滤 → 无候选
      readHandshake: (p) => (p.includes('rollback') ? { status: 'need-decision', decision: { options: [{ id: 'ghost', label: '幽灵' }] } } : { status: 'done' })
    })
    const req: RunRequest = { workflowId: 'wf', repoPath: '/no/repo', branch: 'c', worktreePath: '/no/wt', baseBranch: 'main' }
    const atGate = await engine.start(req).settled
    const back = await engine.decide(atGate.runId, { text: '不满意' }).settled
    expect(back.pendingDecision?.source).toBe('review:manual-gate')
  })

  it('无判定能力（无 prepareHealAgent）→ 驳回直接退回评审门', async () => {
    const def = wf([agentNode('review', '验收', MANUAL)])
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: recordingRunner(),
      prepareAgent: () => nodePrep,
      readHandshake: () => ({ status: 'done' })
    })
    const req: RunRequest = { workflowId: 'wf', repoPath: '/no/repo', branch: 'c', worktreePath: '/no/wt', baseBranch: 'main' }
    const atGate = await engine.start(req).settled
    const back = await engine.decide(atGate.runId, { text: '不满意' }).settled
    expect(back.pendingDecision?.source).toBe('review:manual-gate')
  })

  it('跨重启：回退确认待决策持久化，另起引擎（同 store）仍可确认续跑', async () => {
    const def = wf([agentNode('impl', '实现'), agentNode('review', '验收', MANUAL)])
    const store = createMemoryRunStore()
    const judgeHs: AgentHandshake = { status: 'need-decision', decision: { options: [{ id: 'impl', label: '实现', recommended: true }] } }
    const deps: Partial<EngineDeps> = {
      runAgent: recordingRunner(),
      prepareAgent: () => nodePrep,
      prepareHealAgent: () => judgePrep,
      readHandshake: (p) => (p.includes('rollback') ? judgeHs : { status: 'done' })
    }
    const e1 = createEngine({ getWorkflow: () => def, store, ...deps })
    const req: RunRequest = { workflowId: 'wf', repoPath: '/no/repo', branch: 'c', worktreePath: '/no/wt', baseBranch: 'main' }
    const atGate = await e1.start(req).settled
    const confirm = await e1.decide(atGate.runId, { text: '不对' }).settled
    expect(confirm.pendingDecision?.source).toBe('review:rollback-confirm')

    // 另起引擎实例（模拟重开软件），从 store 读到同一待决策
    const e2 = createEngine({ getWorkflow: () => def, store, ...deps })
    const seen = e2.getRunState(confirm.runId)
    expect(seen?.pendingDecision?.source).toBe('review:rollback-confirm')
    expect(seen?.furthestNodeId).toBe('review')
    const back = await e2.decide(confirm.runId, { optionId: 'impl' }).settled
    expect(back.pendingDecision?.source).toBe('review:manual-gate')
  })
})

describe('重入不重置（真实仓）+ 判定 agent 只读不提交', () => {
  function initRepo(dir: string): void {
    const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@k.dev')
    git('config', 'user.name', 'K')
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
  }

  it('确认回退不 git reset：判定前的提交仍可达；判定 agent 不新增提交', async () => {
    const repo = track(mkdtempSync(join(tmpdir(), 'rb-')))
    initRepo(repo)
    const git = (...a: string[]): string => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim()
    const gitWt = (wt: string, ...a: string[]): string => execFileSync('git', a, { cwd: wt, encoding: 'utf8' }).trim()
    git('branch', 'card-x')
    const wt = memberWorktreePath(repo, 'card-x')
    git('worktree', 'add', '-q', wt, 'card-x')

    const def = wf([agentNode('impl', '实现', MANUAL)])
    // impl agent：往 worktree 写文件（产生本节点提交）。判定 agent：不写任何东西（只读）。
    const runner = recordingRunner((cwd) => {
      // 只有 impl 节点（cwd=worktree）写文件；判定 agent 的 cwd 也是同一 worktree，但它不该写——
      // 用 prompt 区分：node prep 写、judge prep 不写。这里无法拿 prompt，故用文件存在与否近似：
      // impl 首跑写 impl.ts；后续调用若已存在则不重复写（幂等），保证判定 agent 不改动内容。
      const f = join(cwd, 'impl.ts')
      try {
        writeFileSync(f, 'export const v = 1\n', { flag: 'wx' })
      } catch {
        /* 已存在，不改（模拟判定 agent 只读 / impl 重入无新变更）*/
      }
    })
    const judgeHs: AgentHandshake = { status: 'need-decision', decision: { options: [{ id: 'impl', label: '实现', recommended: true }] } }
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      runAgent: runner,
      prepareAgent: () => nodePrep,
      prepareHealAgent: () => judgePrep,
      readHandshake: (p) => (p.includes('rollback') ? judgeHs : { status: 'done' }),
      handshakeDir: track(mkdtempSync(join(tmpdir(), 'hs-')))
    })
    const req: RunRequest = { workflowId: 'wf', repoPath: repo, branch: 'card-x', worktreePath: wt, baseBranch: 'main' }

    const atGate = await engine.start(req).settled
    expect(atGate.pendingDecision?.source).toBe('impl:manual-gate')
    // impl 节点已产出提交（每节点提交锚点）
    const implSha = atGate.agentRuns?.['impl']?.commitSha?.['<single>']
    expect(implSha).toBeTruthy()
    const headAfterImpl = gitWt(wt, 'rev-parse', 'HEAD')

    // 驳回 → 判定（只读，不提交）→ 回退确认
    const confirm = await engine.decide(atGate.runId, { text: '实现不对' }).settled
    expect(confirm.pendingDecision?.source).toBe('impl:rollback-confirm')
    // 判定 agent 只读：HEAD 未因判定移动（未新增提交）
    expect(gitWt(wt, 'rev-parse', 'HEAD')).toBe(headAfterImpl)

    // 确认回退 impl → 重入。断言：无 git reset —— 判定前的提交 headAfterImpl 仍可达。
    const back = await engine.decide(confirm.runId, { optionId: 'impl' }).settled
    expect(back.pendingDecision?.source).toBe('impl:manual-gate')
    // 旧提交仍是当前 HEAD 的祖先（或相等）——没有被 reset 掉。
    expect(() => gitWt(wt, 'merge-base', '--is-ancestor', headAfterImpl, 'HEAD')).not.toThrow()
  })
})
