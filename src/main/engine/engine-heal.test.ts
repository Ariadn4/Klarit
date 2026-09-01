import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunRequest, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type EngineDeps, type AgentPrep } from './engine'
import { createMemoryRunStore } from './run-store'
import { memberWorktreePath } from './branch-naming'
import { buildFailureDecision, buildCommandFailedDecision, buildManualGateDecision, buildGateDecision } from './decisions'
import type { AgentRunner } from '../agent/runner'
import { testTmpDir } from '../test-tmp'

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
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

/** 初始化一个仓库（main，含 a.txt="base"）。 */
function initRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@k.dev')
  git(dir, 'config', 'user.name', 'K')
  writeFileSync(join(dir, 'a.txt'), 'base\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
}

/** 造一个「卡分支合并回 main 必冲突」的场景：card 与 main 都改了 a.txt 同一行。返回卡 worktree 路径。 */
function makeConflict(repo: string, branch: string): string {
  git(repo, 'branch', branch)
  const wt = memberWorktreePath(repo, branch)
  git(repo, 'worktree', 'add', '-q', wt, branch)
  writeFileSync(join(wt, 'a.txt'), 'card-side\n')
  git(wt, 'commit', '-q', '-am', 'card edit')
  writeFileSync(join(repo, 'a.txt'), 'main-side\n')
  git(repo, 'commit', '-q', '-am', 'main edit')
  return wt
}

/** 造一个「卡分支干净合并（无冲突）」场景：card 改 b.txt，main 不动。返回卡 worktree 路径。 */
function makeClean(repo: string, branch: string): string {
  git(repo, 'branch', branch)
  const wt = memberWorktreePath(repo, branch)
  git(repo, 'worktree', 'add', '-q', wt, branch)
  writeFileSync(join(wt, 'b.txt'), 'card new\n')
  git(wt, 'add', '-A')
  git(wt, 'commit', '-q', '-m', 'card add b')
  return wt
}

const prep: AgentPrep = { prompt: 'HEAL PROMPT', toolId: 'claude-code' }

/** 假 heal agent：start/resume 时对 cwd 里的 a.txt 写入解决态（清掉冲突标记）。resolve=false 则什么都不做（留冲突）。 */
function healRunner(resolve: boolean): AgentRunner {
  const act = (cwd: string): void => {
    if (resolve) writeFileSync(join(cwd, 'a.txt'), 'resolved\n')
  }
  return {
    supportsResume: () => true,
    start: (spec) => {
      act(spec.cwd)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    },
    resume: (spec) => {
      act(spec.cwd)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    }
  }
}

function mergeWf(): WorkflowDefinition {
  const node: WorkflowNode = {
    id: 'merge',
    name: { zh: '合并' },
    stageId: 's',
    executor: { kind: 'engine', operation: 'merge-branch' },
    outputs: []
  }
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes: [node] }
}

function engineFor(def: WorkflowDefinition, extra: Partial<EngineDeps>): ReturnType<typeof createEngine> {
  return createEngine({
    getWorkflow: (id) => (id === def.id ? def : null),
    store: createMemoryRunStore(),
    readHandshake: () => ({ status: 'done' }),
    prepareHealAgent: () => prep,
    ...extra
  })
}

describe('合并冲突 heal（在卡分支上解、快进合回）', () => {
  it('冲突 → heal 解冲突 → 卡分支快进合回主线 → 运行 done', async () => {
    const repo = track(testTmpDir('heal-'))
    initRepo(repo)
    const wt = makeConflict(repo, 'card-x')
    const def = mergeWf()
    const req: RunRequest = { workflowId: 'wf', repoPath: repo, branch: 'card-x', worktreePath: wt, baseBranch: 'main' }
    const engine = engineFor(def, { runAgent: healRunner(true) })
    const bp = await engine.start(req).settled
    expect(bp.state).toBe('done')
    // 主线已含解决后的内容（card 分支已合并回 main）
    expect(git(repo, 'show', 'main:a.txt')).toBe('resolved')
    // card-x 现为 main 的祖先（已并入）
    expect(() => git(repo, 'merge-base', '--is-ancestor', 'card-x', 'main')).not.toThrow()
    // 观测：heal agent 的完整 prompt 随记录持久化
    expect(bp.healRuns?.['merge:<single>']?.prompt).toBe('HEAL PROMPT')
  })

  it('heal 连续失败超限 → 回落人工「放弃合并，跳过该节点」，计数=3 且工作区干净', async () => {
    const repo = track(testTmpDir('heal-'))
    initRepo(repo)
    const wt = makeConflict(repo, 'card-x')
    const def = mergeWf()
    const req: RunRequest = { workflowId: 'wf', repoPath: repo, branch: 'card-x', worktreePath: wt, baseBranch: 'main' }
    const engine = engineFor(def, { runAgent: healRunner(false) })
    const bp = await engine.start(req).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision?.titleKey).toBe('engineDecision.mergeConflict')
    expect(bp.healRuns?.['merge:<single>']?.attempts).toBe(3)
    // 超限后卡工作区干净（无残留在途合并）
    expect(git(wt, 'status', '--porcelain')).toBe('')
  })

  it('无 prepareHealAgent（heal 不可用）→ 直接回落人工，不尝试 heal', async () => {
    const repo = track(testTmpDir('heal-'))
    initRepo(repo)
    const wt = makeConflict(repo, 'card-x')
    const def = mergeWf()
    const req: RunRequest = { workflowId: 'wf', repoPath: repo, branch: 'card-x', worktreePath: wt, baseBranch: 'main' }
    const engine = createEngine({
      getWorkflow: () => def,
      store: createMemoryRunStore(),
      readHandshake: () => ({ status: 'done' })
      // 不注入 prepareHealAgent
    })
    const bp = await engine.start(req).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision?.titleKey).toBe('engineDecision.mergeConflict')
  })
})

describe('多仓逐仓 heal', () => {
  it('两成员仓仅一个冲突 → 只对冲突仓拉 heal，另一仓直接干净合并，运行 done', async () => {
    const baseDir = track(testTmpDir('heal-multi-'))
    const web = join(baseDir, 'web')
    const api = join(baseDir, 'api')
    mkdirSync(web)
    mkdirSync(api)
    initRepo(web)
    initRepo(api)
    const wtWeb = makeConflict(web, 'card-x') // web 冲突
    makeClean(api, 'card-x') // api 干净
    const def = mergeWf()
    const req: RunRequest = {
      workflowId: 'wf',
      repoPath: web,
      branch: 'card-x',
      baseBranch: 'main',
      repos: [
        { memberId: 'web', repoPath: web },
        { memberId: 'api', repoPath: api }
      ]
    }
    const engine = engineFor(def, { runAgent: healRunner(true) })
    const bp = await engine.start(req).settled
    expect(bp.state).toBe('done')
    // 只为 web 建了 heal 记录
    expect(bp.healRuns?.['merge:web']).toBeDefined()
    expect(bp.healRuns?.['merge:api']).toBeUndefined()
    expect(git(web, 'show', 'main:a.txt')).toBe('resolved')
    // api 也已合并（b.txt 进 main）
    expect(git(api, 'show', 'main:b.txt')).toBe('card new')
    void wtWeb
  })
})

describe('命令失败 heal', () => {
  function commandWf(): WorkflowDefinition {
    const node: WorkflowNode = {
      id: 'cmd',
      name: { zh: '测试' },
      stageId: 's',
      executor: { kind: 'command', commands: [{ command: 'run-tests' }] },
      outputs: []
    }
    return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes: [node] }
  }

  it('命令没过 → heal 改代码+引擎提交 → 重跑命令通过 → done', async () => {
    const repo = track(testTmpDir('heal-cmd-'))
    initRepo(repo)
    const wt = memberWorktreePath(repo, 'card-x')
    git(repo, 'branch', 'card-x')
    git(repo, 'worktree', 'add', '-q', wt, 'card-x')
    const def = commandWf()
    const req: RunRequest = { workflowId: 'wf', repoPath: repo, branch: 'card-x', worktreePath: wt, baseBranch: 'main' }
    let n = 0
    const engine = engineFor(def, {
      runAgent: {
        supportsResume: () => true,
        start: (spec) => {
          writeFileSync(join(spec.cwd, 'fix.ts'), 'export const fixed = true\n')
          return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
        },
        resume: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
      },
      // 首跑失败，heal 后重跑通过
      runCommand: async () => ({ code: n++ === 0 ? 1 : 0, stdout: '', stderr: 'FAIL', killed: false })
    })
    const bp = await engine.start(req).settled
    expect(bp.state).toBe('done')
    expect(bp.healRuns?.['cmd']?.attempts).toBe(0) // 收敛后清零
  })

  it('命令 heal 连续失败超限 → 回落人工「命令执行失败」决策', async () => {
    const repo = track(testTmpDir('heal-cmd-'))
    initRepo(repo)
    const wt = memberWorktreePath(repo, 'card-x')
    git(repo, 'branch', 'card-x')
    git(repo, 'worktree', 'add', '-q', wt, 'card-x')
    const def = commandWf()
    const req: RunRequest = { workflowId: 'wf', repoPath: repo, branch: 'card-x', worktreePath: wt, baseBranch: 'main' }
    const engine = engineFor(def, {
      runAgent: healRunner(false),
      runCommand: async () => ({ code: 1, stdout: '', stderr: 'FAIL', killed: false })
    })
    const bp = await engine.start(req).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision?.titleKey).toBe('engineDecision.commandFailed')
  })
})

describe('决策自由输入（结构层）', () => {
  it('失败决策恒带自由输入框；人工评审门不带', () => {
    const merge = buildFailureDecision('n', 'N', 'merge-branch', 'conflict', 'x')
    expect(merge.input?.labelKey).toBe('engineDecision.freeInput')
    const cmd = buildCommandFailedDecision('n', 'npm test', 1, 'FAIL')
    expect(cmd.input?.labelKey).toBe('engineDecision.freeInput')
    const gate = buildGateDecision('n', 'N', { reason: 'x' })
    expect(gate.input?.labelKey).toBe('engineDecision.freeInput')
    // 人工评审门：仅「通过」选项 + 驳回自由输入框（框即内容驱动回退入口，不另设驳回按钮）
    const manual = buildManualGateDecision('n', 'N')
    expect(manual.input?.labelKey).toBe('engineDecision.rejectReason')
    expect(manual.options.map((o) => o.id)).toEqual(['pass'])
  })

  it('push 无远端仍用专用「远端地址」填空（非通用自由输入）', () => {
    const push = buildFailureDecision('n', 'N', 'push-branch', 'no-remote', 'x')
    expect(push.input?.labelKey).toBe('engineDecision.inputRemoteAddress')
  })
})

describe('决策自由输入 → 无当前 agent 则新起读写处置 agent', () => {
  it('引擎失败决策收到自由文本 → 新起处置 agent（runAgent.start 被调用）', async () => {
    const repo = track(testTmpDir('heal-disp-'))
    initRepo(repo)
    // 造一个 feat 分支带未合并提交 → delete-branch 报 not-merged（无自动 heal 的失败）
    git(repo, 'checkout', '-q', '-b', 'feat')
    writeFileSync(join(repo, 'c.txt'), 'unmerged\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'feat commit')
    git(repo, 'checkout', '-q', 'main')
    const node: WorkflowNode = {
      id: 'del',
      name: { zh: '删分支' },
      stageId: 's',
      executor: { kind: 'engine', operation: 'delete-branch' },
      outputs: []
    }
    const def: WorkflowDefinition = { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes: [node] }
    const req: RunRequest = { workflowId: 'wf', repoPath: repo, branch: 'feat', worktreePath: join(repo, 'nowt'), baseBranch: 'main' }
    let starts = 0
    const engine = engineFor(def, {
      runAgent: {
        supportsResume: () => true,
        start: () => {
          starts++
          return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
        },
        resume: () => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
      }
    })
    const first = await engine.start(req).settled
    expect(first.state).toBe('waiting-decision')
    expect(first.pendingDecision?.titleKey).toBe('engineDecision.deleteNotMerged')
    expect(first.pendingDecision?.input?.labelKey).toBe('engineDecision.freeInput')
    // 自由文本提交 → 新起处置 agent
    await engine.decide(first.runId, { text: '这个分支的活先保住，帮我看看' }).settled
    expect(starts).toBe(1) // 处置 agent 被拉起
  })
})
