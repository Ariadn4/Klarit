import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandResult } from '../command-run'
import type { EngineProgressEvent, WorkflowDefinition, WorkflowGateItem, WorkflowNode } from '../../shared/types'
import { createEngine, type EngineDeps } from './engine'
import { createMemoryRunStore } from './run-store'

let nid = 0
function commandNode(
  command: string,
  opts: { check?: string; timeoutSec?: number; gate?: WorkflowGateItem[] } = {}
): WorkflowNode {
  return {
    id: `n${nid++}-cmd`,
    name: { zh: 'cmd' },
    stageId: 's',
    executor: {
      kind: 'command',
      commands: [{ command, ...(opts.check ? { check: opts.check } : {}), ...(opts.timeoutSec ? { timeoutSec: opts.timeoutSec } : {}) }]
    },
    outputs: [],
    ...(opts.gate ? { gate: opts.gate } : {})
  }
}
/** 多命令节点:一节点多条命令(各可带 label)。 */
function multiCommandNode(cmds: Array<{ command: string; label?: string; check?: string; timeoutSec?: number }>, gate?: WorkflowGateItem[]): WorkflowNode {
  return {
    id: `n${nid++}-multi`,
    name: { zh: 'multi' },
    stageId: 's',
    executor: { kind: 'command', commands: cmds },
    outputs: [],
    ...(gate ? { gate } : {})
  }
}
function engineNode(operation: string, gate?: WorkflowGateItem[]): WorkflowNode {
  return { id: `n${nid++}-${operation}`, name: { zh: operation }, stageId: 's', executor: { kind: 'engine', operation }, outputs: [], ...(gate ? { gate } : {}) }
}
function wf(nodes: WorkflowNode[]): WorkflowDefinition {
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes }
}
function res(code: number, extra: Partial<CommandResult> = {}): CommandResult {
  return { code, stdout: '', stderr: '', killed: false, ...extra }
}
/** 构造引擎:注入假 runner（按命令串返回 canned 结果）+ 可选 getObjectiveCheck。 */
function makeEngine(
  def: WorkflowDefinition,
  runCommand: EngineDeps['runCommand'],
  extra: Partial<EngineDeps> = {}
): { engine: ReturnType<typeof createEngine>; events: EngineProgressEvent[] } {
  const events: EngineProgressEvent[] = []
  const engine = createEngine({
    getWorkflow: (id) => (id === def.id ? def : null),
    store: createMemoryRunStore(),
    emit: (e) => events.push(e),
    runCommand,
    ...extra
  })
  return { engine, events }
}
const REQ = { workflowId: 'wf', repoPath: '/tmp/x', branch: 'feature', baseBranch: 'main', worktreePath: '/tmp/wt' }
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))

const trash: string[] = []
afterEach(() => {
  for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('command 节点执行', () => {
  it('命令成功(code 0)→ 节点完成、运行 done,cwd 为(存在的)worktree', async () => {
    const wtDir = mkdtempSync(join(tmpdir(), 'klarit-wt-'))
    trash.push(wtDir)
    let seenCwd = ''
    const { engine } = makeEngine(wf([commandNode('npm test')]), async (cmd, opts) => {
      seenCwd = opts.cwd
      return res(cmd === 'npm test' ? 0 : 1)
    })
    const bp = await engine.start({ ...REQ, worktreePath: wtDir }).settled
    expect(bp.state).toBe('done')
    expect(seenCwd).toBe(wtDir) // worktree 存在 → 用它
  })

  it('非零退出 → commandFailed 前进式决策(retry/skip),不自动重试', async () => {
    let calls = 0
    const { engine } = makeEngine(wf([commandNode('npm test')]), async () => {
      calls++
      return res(2, { stderr: 'fail' })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision!.source.endsWith(':command-failed')).toBe(true)
    expect(bp.pendingDecision!.options.map((o) => o.id)).toEqual(['retry', 'skip'])
    expect(bp.pendingDecision!.titleParams).toMatchObject({ command: 'npm test' })
    expect(bp.pendingDecision!.reason).toBe('fail') // 可读原因=命令输出
    expect(JSON.stringify(bp.pendingDecision!.titleParams ?? {})).not.toContain('2') // 不向用户显示退出码
    expect(calls).toBe(1) // 没有自动重试
  })

  it('决策 skip → 跳过节点续跑;retry → 重跑命令', async () => {
    let calls = 0
    const { engine } = makeEngine(wf([commandNode('build'), engineNode('create-branch')]), async () => {
      calls++
      return calls >= 2 ? res(0) : res(1)
    })
    // 第一次失败 → 决策
    let bp = await engine.start({ ...REQ, repoPath: '/tmp/x' }).settled
    expect(bp.state).toBe('waiting-decision')
    // retry → 第二次成功 → 推进(后续 engine 节点会因无真 git 失败,但命令节点已过)
    bp = await engine.decide(bp.runId, { optionId: 'retry' }).settled
    expect(calls).toBe(2)
    // 命令节点已离开（进入下一节点或其决策），不再停在 command-failed
    expect(bp.pendingDecision?.source.endsWith(':command-failed') ?? false).toBe(false)
  })

  it('decide skip 直接跳过命令节点', async () => {
    const { engine } = makeEngine(wf([commandNode('flaky')]), async () => res(1))
    let bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    bp = await engine.decide(bp.runId, { optionId: 'skip' }).settled
    expect(bp.state).toBe('done')
  })
})

describe('command 前置检查护栏', () => {
  it('check 退 0 → 跳过主命令、不重复执行', async () => {
    const ran: string[] = []
    const { engine, events } = makeEngine(wf([commandNode('deploy', { check: 'is-deployed' })]), async (cmd) => {
      ran.push(cmd)
      return res(cmd === 'is-deployed' ? 0 : 1)
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(ran).toEqual(['is-deployed']) // 主命令 deploy 没跑
    expect(events.some((e) => e.kind === 'op-output' && e.outcome === 'noop')).toBe(true)
  })

  it('check 退非零 → 跑主命令', async () => {
    const ran: string[] = []
    const { engine } = makeEngine(wf([commandNode('deploy', { check: 'is-deployed' })]), async (cmd) => {
      ran.push(cmd)
      return res(cmd === 'is-deployed' ? 7 : 0)
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(ran).toEqual(['is-deployed', 'deploy'])
  })

  it('无 check → 直接跑主命令', async () => {
    const ran: string[] = []
    const { engine } = makeEngine(wf([commandNode('npm test')]), async (cmd) => {
      ran.push(cmd)
      return res(0)
    })
    await engine.start(REQ).settled
    expect(ran).toEqual(['npm test'])
  })
})

describe('command 超时', () => {
  it('主命令超时 → 杀进程树并抛「命令超时」决策,不落 paused', async () => {
    const { engine } = makeEngine(wf([commandNode('hang', { timeoutSec: 0.05 })]), async (_cmd, opts) => {
      // 模拟长命令:只在被取消(超时)时返回 killed。
      return await new Promise<CommandResult>((resolve) => {
        if (opts.signal?.aborted) resolve(res(-1, { killed: true }))
        else opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision!.source.endsWith(':command-timeout')).toBe(true)
    expect(bp.pendingDecision!.options.map((o) => o.id)).toEqual(['retry', 'skip'])
  })
})

describe('pause 杀在跑命令 + 恢复重跑', () => {
  it('pause 打断 executing 中的命令 → paused(phase 仍 executing);resume 重跑 → done', async () => {
    let calls = 0
    const { engine } = makeEngine(wf([commandNode('long')]), async (_cmd, opts) => {
      calls++
      if (calls === 1) {
        return await new Promise<CommandResult>((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
        })
      }
      return res(0)
    })
    const { runId } = engine.start(REQ)
    await tick() // 让命令进入在跑态
    const paused = await engine.pause(runId)
    expect(paused.state).toBe('paused')
    expect(paused.phase).toEqual({ kind: 'executing' })
    const resumed = await engine.resume(runId).settled
    expect(resumed.state).toBe('done')
    expect(calls).toBe(2) // 恢复后重跑了一次
  })
})

describe('客观门真跑(inline + ref)', () => {
  const autoGate = (check: WorkflowGateItem extends { kind: 'auto' } ? never : { kind: 'auto'; check: { kind: 'inline'; command: string } | { kind: 'ref'; ref: { packId: string; itemId: string } }; timeoutSec?: number }): WorkflowGateItem =>
    check as WorkflowGateItem

  it('inline 门通过(code 0)→ 节点完成', async () => {
    const def = wf([commandNode('build', { gate: [{ kind: 'auto', check: { kind: 'inline', command: 'lint' } }] })])
    const { engine } = makeEngine(def, async (cmd) => res(cmd === 'build' || cmd === 'lint' ? 0 : 1))
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
  })

  it('命令节点门报错 → 立即交用户(不自动重跑),reason 带检查输出、不显示退出码', async () => {
    let buildRuns = 0
    const def = wf([commandNode('build', { gate: [{ kind: 'auto', check: { kind: 'inline', command: 'lint' } }] })])
    const { engine, events } = makeEngine(def, async (cmd) => {
      if (cmd === 'build') buildRuns++
      return cmd === 'lint' ? res(2, { stderr: 'lint 发现 3 处问题' }) : res(0)
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision!.source.endsWith(':gate-failed')).toBe(true) // 立即交用户,非 escalated
    expect(bp.pendingDecision!.options.map((o) => o.id)).toEqual(['retry', 'rerun-node', 'skip'])
    expect(bp.pendingDecision!.reason).toBe('lint 发现 3 处问题') // 可读原因=检查输出
    expect(JSON.stringify(bp.pendingDecision!.titleParams ?? {})).not.toContain('2') // 不带退出码
    expect(buildRuns).toBe(1) // 命令没被自动重跑
    expect(events.filter((e) => e.kind === 'gate-retry')).toHaveLength(0)
  })

  it('门超时失败 → 只自动重跑门 3 次后升级,历史全为 超时/门', async () => {
    let buildRuns = 0
    const def = wf([commandNode('build', { gate: [{ kind: 'auto', check: { kind: 'inline', command: 'slow' }, timeoutSec: 0.05 }] })])
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd === 'build') {
        buildRuns++
        return res(0)
      }
      // slow:只在超时取消时返回
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision!.source.endsWith(':gate-escalated')).toBe(true)
    expect(bp.pendingDecision!.gateHistory!.every((h) => h.cause === 'timeout' && h.rerun === 'gate')).toBe(true)
    expect(buildRuns).toBe(1) // 超时只重跑门,命令不重跑
  })

  it('超时门抖动:超时 2 次后通过 → 自动收敛、运行 done、不打扰人', async () => {
    let lintRuns = 0
    const def = wf([commandNode('build', { gate: [{ kind: 'auto', check: { kind: 'inline', command: 'lint' }, timeoutSec: 0.05 }] })])
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd !== 'lint') return res(0)
      lintRuns++
      if (lintRuns >= 3) return res(0) // 第三次秒过
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(lintRuns).toBe(3)
    expect(Object.values(bp.gateLog ?? {}).some((l) => l.length > 0)).toBe(false) // 通过后该门历史已清
  })

  it('命令节点门报错决策:rerun-node → 重跑节点;skip → 推进', async () => {
    const def = wf([commandNode('build', { gate: [{ kind: 'auto', check: { kind: 'inline', command: 'lint' } }] }), commandNode('after')])
    let lintRuns = 0
    const { engine } = makeEngine(def, async (cmd) => {
      if (cmd === 'lint') {
        lintRuns++
        return res(1) // 恒失败
      }
      return res(0)
    })
    let bp = await engine.start(REQ).settled
    expect(bp.pendingDecision!.source.endsWith(':gate-failed')).toBe(true) // 命令节点:立即交用户
    const beforeRerun = lintRuns
    bp = await engine.decide(bp.runId, { optionId: 'rerun-node' }).settled
    expect(lintRuns).toBeGreaterThan(beforeRerun) // 重跑了节点(命令+门)
    expect(bp.pendingDecision!.source.endsWith(':gate-failed')).toBe(true) // 仍失败 → 再次立即交用户
    bp = await engine.decide(bp.runId, { optionId: 'skip' }).settled
    expect(bp.state).toBe('done') // 跳过检查 → 进 after → done
  })

  it('ref 门解析规则库条目后执行', async () => {
    const def = wf([commandNode('build', { gate: [{ kind: 'auto', check: { kind: 'ref', ref: { packId: 'p', itemId: 'c' } } }] })])
    let ranRef = false
    const { engine } = makeEngine(def, async (cmd) => {
      if (cmd === 'pnpm typecheck') ranRef = true
      return res(0)
    }, { getObjectiveCheck: (ref) => (ref.itemId === 'c' ? 'pnpm typecheck' : null) })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(ranRef).toBe(true)
  })

  it('ref 条目缺失 → 跳过该检查、上报、不崩', async () => {
    const def = wf([commandNode('build', { gate: [{ kind: 'auto', check: { kind: 'ref', ref: { packId: 'p', itemId: 'gone' } } }] })])
    const { engine, events } = makeEngine(def, async () => res(0), { getObjectiveCheck: () => null })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(events.some((e) => e.kind === 'skip')).toBe(true)
    void autoGate
  })
})

describe('多命令节点（并发 + 各自分桶）', () => {
  it('两条前台命令并发跑、各进 node:<id>:0 / :1 桶、全 0 退出→节点完成', async () => {
    const nodeM = multiCommandNode([{ command: 'serve-a' }, { command: 'serve-b' }])
    const def = wf([nodeM])
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd === 'serve-a') opts.onChunk?.('stdout', 'A-line\n')
      if (cmd === 'serve-b') opts.onChunk?.('stdout', 'B-line\n')
      return res(0)
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
    expect(engine.readOutput(bp.runId, `node:${nodeM.id}:0`)).toBe('A-line\n')
    expect(engine.readOutput(bp.runId, `node:${nodeM.id}:1`)).toBe('B-line\n')
    expect(engine.readOutput(bp.runId, `node:${nodeM.id}:0`)).not.toContain('B-line')
  })

  it('某条命令非零退出→杀其余、抛该命令的失败决策', async () => {
    const nodeM = multiCommandNode([{ command: 'ok-cmd' }, { command: 'bad-cmd' }])
    const def = wf([nodeM])
    let okKilled = false
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd === 'bad-cmd') return res(2, { stderr: 'boom' })
      // ok-cmd 长驻,只在被连带取消时返回
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => { okKilled = true; resolve(res(-1, { killed: true })) }, { once: true })
      })
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision!.source.endsWith(':command-failed')).toBe(true)
    expect(bp.pendingDecision!.titleParams).toMatchObject({ command: 'bad-cmd' })
    expect(bp.pendingDecision!.reason).toBe('boom')
    expect(okKilled).toBe(true) // 兄弟命令被连带杀掉
  })

  it('detach 把节点里两条在跑命令各自转后台(各自 bgId)', async () => {
    const nodeM = multiCommandNode([{ command: 'serve-a' }, { command: 'serve-b' }])
    const def = wf([nodeM, commandNode('q', { gate: [{ kind: 'manual', actions: [] }] })])
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd === 'q') return res(0)
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const { runId, settled } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach')
    const bp = await settled
    expect(bp.state).toBe('waiting-decision') // 停在 q 人工门
    expect(engine.listBackground(runId)).toHaveLength(2) // 两条各成一条后台命令
    engine.killAllBackground()
  })
})

describe('命令输出按桶缓冲（可回看）', () => {
  it('前台命令输出进 node:<id>:<i> 桶，可经 readOutput / listOutputBuckets 回看', async () => {
    const node = commandNode('build')
    const def = wf([node])
    const { engine } = makeEngine(def, async (_cmd, opts) => {
      opts.onChunk?.('stdout', 'compiling...\n')
      opts.onChunk?.('stdout', 'done\n')
      return res(0)
    })
    const { runId, settled } = engine.start(REQ)
    await settled
    expect(engine.readOutput(runId, `node:${node.id}:0`)).toBe('compiling...\ndone\n')
    expect(engine.listOutputBuckets(runId)).toContain(`node:${node.id}:0`)
  })
})

describe('人工门动作按钮（登记为后台命令）', () => {
  it('runGateAction 起独立后台进程、输出进 bg 桶、返回 bgId、不推进运行', async () => {
    const def = wf([
      commandNode('main', { gate: [{ kind: 'manual', actions: [{ label: '启动 app', command: 'npm start' }] }] })
    ])
    const { engine, events } = makeEngine(def, async (cmd, opts) => {
      if (cmd === 'npm start') {
        opts.onChunk?.('stdout', 'serving...')
        return res(0, { stdout: 'serving...' })
      }
      return res(0)
    })
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('waiting-decision')
    expect(bp.pendingDecision!.actions).toEqual([{ label: '启动 app', index: 0 }])
    const { bgId } = await engine.runGateAction(bp.runId, 0)
    expect(bgId).toBeTruthy()
    await tick()
    // 输出进该动作的 bg 桶(不进前台节点桶)
    expect(engine.readOutput(bp.runId, `bg:${bgId}`)).toContain('serving...')
    expect(events.some((e) => e.kind === 'background' && e.bgId === bgId && e.status === 'started')).toBe(true)
    // 运行没被推进(仍停在该门)
    expect(engine.getRunState(bp.runId)!.state).toBe('waiting-decision')
  })

  it('两个动作各进各自 bg 桶、各自可分别中止,互不影响', async () => {
    const def = wf([
      commandNode('main', { gate: [{ kind: 'manual', actions: [{ label: '后端', command: 'serve-a' }, { label: '前端', command: 'serve-b' }] }] })
    ])
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd === 'serve-a') opts.onChunk?.('stdout', 'A-out')
      if (cmd === 'serve-b') opts.onChunk?.('stdout', 'B-out')
      if (cmd !== 'serve-a' && cmd !== 'serve-b') return res(0)
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const bp = await engine.start(REQ).settled
    const a = await engine.runGateAction(bp.runId, 0)
    const b = await engine.runGateAction(bp.runId, 1)
    await tick()
    expect(a.bgId).not.toBe(b.bgId)
    expect(engine.readOutput(bp.runId, `bg:${a.bgId}`)).toBe('A-out')
    expect(engine.readOutput(bp.runId, `bg:${b.bgId}`)).toBe('B-out')
    expect(engine.readOutput(bp.runId, `bg:${a.bgId}`)).not.toContain('B-out')
    // 停 A(按 bgId),不影响 B:B 的输出桶仍在、B 未被杀。
    engine.stopBackground(bp.runId, a.bgId)
    await tick()
    expect(engine.readOutput(bp.runId, `bg:${b.bgId}`)).toBe('B-out')
    engine.stopGateAction(bp.runId) // 收尾 B
  })

  it('同一动作重复触发=先停旧再起新、复用同一 bgId、清掉旧输出(不攒新窗口)', async () => {
    let starts = 0
    const def = wf([commandNode('main', { gate: [{ kind: 'manual', actions: [{ label: '启动', command: 'serve' }] }] })])
    const { engine, events } = makeEngine(def, async (cmd, opts) => {
      if (cmd !== 'serve') return res(0)
      starts++
      opts.onChunk?.('stdout', `run-${starts} `)
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const bp = await engine.start(REQ).settled
    const first = await engine.runGateAction(bp.runId, 0)
    await tick()
    const second = await engine.runGateAction(bp.runId, 0)
    await tick()
    expect(starts).toBe(2)
    // 复用同一格:bgId 按按钮身份稳定
    expect(first.bgId).toBe(second.bgId)
    // 旧进程被停(发过 stopped 事件)
    expect(events.some((e) => e.kind === 'background' && e.bgId === first.bgId && e.status === 'stopped')).toBe(true)
    // 桶被清后重跑:只含第二次输出,不含第一次
    expect(engine.readOutput(bp.runId, `bg:${second.bgId}`)).toContain('run-2')
    expect(engine.readOutput(bp.runId, `bg:${second.bgId}`)).not.toContain('run-1')
    engine.stopGateAction(bp.runId)
  })

  it('stopGateAction 终止全部动作进程', async () => {
    const def = wf([
      commandNode('main', { gate: [{ kind: 'manual', actions: [{ label: '启动', command: 'serve' }] }] })
    ])
    let wasKilled = false
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd !== 'serve') return res(0)
      return await new Promise<CommandResult>((resolve) => {
        opts.onStart?.({ kill: () => { wasKilled = true; resolve(res(-1, { killed: true })) } })
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const bp = await engine.start(REQ).settled
    await engine.runGateAction(bp.runId, 0)
    await tick()
    engine.stopGateAction(bp.runId)
    await tick()
    expect(wasKilled).toBe(true)
  })
})

describe('命令节点手动推进 + 后台化', () => {
  /** 首节点长命令 + 自定义次节点;长命令只在被取消时返回;onStart 暴露 kill 标志、记录拉起次数。 */
  function bgFixture(second: WorkflowNode): {
    engine: ReturnType<typeof createEngine>
    events: EngineProgressEvent[]
    killed: () => boolean
    serveStarts: () => number
  } {
    let wasKilled = false
    let starts = 0
    const def = wf([commandNode('serve-long'), second])
    const m = makeEngine(def, async (cmd, opts) => {
      if (cmd !== 'serve-long') return res(0)
      starts++
      opts.onStart?.({ kill: () => (wasKilled = true) })
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    return { ...m, killed: () => wasKilled, serveStarts: () => starts }
  }
  const manualNode = (): WorkflowNode => commandNode('q', { gate: [{ kind: 'manual', actions: [] }] })

  it('长命令执行中 getRunState 反映当前节点与阶段(非过期断点)', async () => {
    const def = wf([commandNode('quick'), commandNode('serve-long')])
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd === 'quick') return res(0)
      return await new Promise<CommandResult>((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const { runId } = engine.start(REQ)
    await tick()
    const st = engine.getRunState(runId)!
    expect(st.state).toBe('running')
    expect(st.phase).toEqual({ kind: 'executing' })
    expect(st.currentNodeId).toBe(def.nodes[1].id) // 停在第二个(长命令)节点,而非过期在首节点
    engine.advanceCommand(runId, 'abort') // 收尾
  })

  it('转后台把命令转后台前的前台输出也带进 bg 桶(完整输出,非只转后台后)', async () => {
    const def = wf([commandNode('serve'), manualNode()])
    const { engine } = makeEngine(def, async (cmd, opts) => {
      if (cmd !== 'serve') return res(0)
      opts.onChunk?.('stdout', 'pre-detach-line\n') // 转后台前就产出的前台输出
      return await new Promise<CommandResult>((resolve) => {
        opts.onStart?.({ kill: () => resolve(res(-1, { killed: true })) })
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const { runId } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach')
    await tick(30)
    const bg = engine.listBackground(runId)[0]
    expect(bg).toBeTruthy()
    // 后台桶含转后台前的前台输出。
    expect(engine.readOutput(runId, `bg:${bg.bgId}`)).toContain('pre-detach-line')
    engine.advanceCommand(runId, 'abort') // 收尾(其实已在人工门,后台随终局收)
  })

  it('后台命令超时结束不回退主流程断点(跨 decide 边界,修 stale-save 覆盖)', async () => {
    // serve-long(0.3s 超时)转后台 → 过 n1 人工门(decide 加载新断点)→ 停 n2 人工门;
    // 期间 serve-long 后台超时被杀,其完成回调**不得**把断点覆盖回转后台时捕获的旧节点。
    const def = wf([commandNode('serve-long', { timeoutSec: 0.3 }), manualNode(), manualNode()])
    const { engine, events } = makeEngine(def, async (cmd, opts) => {
      if (cmd !== 'serve-long') return res(0)
      return await new Promise<CommandResult>((resolve) => {
        opts.onStart?.({ kill: () => resolve(res(-1, { killed: true })) })
        opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
      })
    })
    const { runId } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach') // serve-long 转后台(0.3s 超时)→ 推进到 n1 人工门
    await tick(40)
    const n1 = engine.getRunState(runId)!
    expect(n1.currentNodeId).toBe(def.nodes[1].id)
    // 过 n1 门(decide 加载**新**断点并推进到 n2)——这一步造出「捕获的旧 bp」与「当前 bp」分叉。
    engine.decide(runId, { optionId: n1.pendingDecision!.options[0].id })
    await tick(40)
    expect(engine.getRunState(runId)!.currentNodeId).toBe(def.nodes[2].id) // 已在 n2
    await tick(400) // 等 serve-long 后台超时(0.3s)被杀 + 其完成回调
    const st = engine.getRunState(runId)!
    expect(st.currentNodeId).toBe(def.nodes[2].id) // 断点未被后台超时回写覆盖回旧节点
    expect(st.state).toBe('waiting-decision')
    expect(engine.listBackground(runId)).toHaveLength(0)
    expect(events.some((e) => e.kind === 'background' && e.status === 'timeout')).toBe(true)
  })

  it('中止并进入下一节点:杀命令、跳过门把、推进', async () => {
    const { engine } = bgFixture(commandNode('after'))
    const { runId, settled } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'abort')
    const bp = await settled
    expect(bp.state).toBe('done') // 进到 after 并跑完
    expect(engine.listBackground(runId)).toHaveLength(0) // abort 不留后台
  })

  it('转后台:运行未完成时命令仍在后台、可列出与中止', async () => {
    const { engine, events } = bgFixture(manualNode())
    const { runId, settled } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach')
    const bp = await settled
    expect(bp.state).toBe('waiting-decision') // 停在 q 的人工门(运行未完成)
    const bg = engine.listBackground(runId)
    expect(bg).toHaveLength(1)
    expect(events.some((e) => e.kind === 'background' && e.status === 'started')).toBe(true)
    engine.stopBackground(runId, bg[0].bgId)
    expect(engine.listBackground(runId)).toHaveLength(0)
    expect(events.some((e) => e.kind === 'background' && e.status === 'stopped')).toBe(true)
  })

  it('显式中止的后台命令不再补发迟到的 exited 终态(防「消失→又出现」)', async () => {
    const { engine, events } = bgFixture(manualNode())
    const { runId, settled } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach')
    await settled
    const bg = engine.listBackground(runId)[0]
    engine.stopBackground(runId, bg.bgId) // 显式中止 → 发 stopped,并触发进程真死
    await tick(30) // 等进程死、runP.then 回调跑完
    const evts = events.filter((e) => e.kind === 'background' && e.bgId === bg.bgId)
    // 只应有 started + stopped;不应再有进程真死补发的 exited(会导致渲染层复活条目)。
    expect(evts.map((e) => (e.kind === 'background' ? e.status : ''))).toEqual(['started', 'stopped'])
  })

  it('工作流完成时后台命令被同步中止 + 清记录(末节点转后台即完成即收尾)', async () => {
    const { engine, killed } = bgFixture(commandNode('after'))
    const { runId, settled } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach') // serve-long 转后台 → after 跑完 → 完成
    const bp = await settled
    expect(bp.state).toBe('done')
    expect(engine.listBackground(runId)).toHaveLength(0) // 完成即收尾、清记录
    expect(killed()).toBe(true) // 后台命令被真的杀掉
  })

  it('暂停=一切静止(杀后台、留记录);恢复=后台按记录重启', async () => {
    // [serve-long, serve2] 均长驻:detach serve-long → 进 serve2(长驻,运行不完成),便于 pause。
    const def = wf([commandNode('serve-long'), commandNode('serve2')])
    let starts = 0
    let wasKilled = false
    const eng = createEngine({
      getWorkflow: (id) => (id === def.id ? def : null),
      store: createMemoryRunStore(),
      runCommand: async (cmd, opts) => {
        if (cmd === 'serve-long') {
          starts++
          opts.onStart?.({ kill: () => (wasKilled = true) })
        }
        return await new Promise<CommandResult>((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
        })
      }
    })
    const { runId } = eng.start(REQ)
    await tick()
    eng.advanceCommand(runId, 'detach') // serve-long 转后台
    await tick()
    expect(eng.listBackground(runId)).toHaveLength(1)
    expect(starts).toBe(1)
    const paused = await eng.pause(runId)
    expect(paused.state).toBe('paused')
    expect(wasKilled).toBe(true) // 暂停杀了后台活进程
    expect(eng.listBackground(runId)).toHaveLength(1) // 但记录保留(待恢复重启)
    eng.resume(runId)
    await tick()
    expect(starts).toBe(2) // 恢复把后台命令重新拉起
    eng.killAllBackground() // 收尾
  })

  it('在人工门(waiting-decision)暂停 → 恢复也重启后台命令', async () => {
    const def = wf([commandNode('serve-long'), commandNode('q', { gate: [{ kind: 'manual', actions: [] }] })])
    let starts = 0
    let wasKilled = false
    const eng = createEngine({
      getWorkflow: (id) => (id === def.id ? def : null),
      store: createMemoryRunStore(),
      runCommand: async (cmd, opts) => {
        if (cmd === 'q') return res(0)
        starts++
        opts.onStart?.({ kill: () => (wasKilled = true) })
        return await new Promise<CommandResult>((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
        })
      }
    })
    const { runId, settled } = eng.start(REQ)
    await tick()
    eng.advanceCommand(runId, 'detach') // serve-long 转后台 → 进 q → 停在人工门
    const bp = await settled
    expect(bp.state).toBe('waiting-decision')
    expect(starts).toBe(1)
    await eng.pause(runId)
    expect(wasKilled).toBe(true) // 人工门处暂停也杀后台
    expect(eng.listBackground(runId)).toHaveLength(1) // 记录保留
    eng.resume(runId)
    await tick()
    expect(starts).toBe(2) // 在 waiting-decision 处恢复也重启了后台
    expect(eng.getRunState(runId)!.state).toBe('waiting-decision') // 仍待决策
    eng.killAllBackground()
  })

  it('后台命令带超时:到点自动杀掉并摘记录(超时跟随到后台)', async () => {
    const def = wf([commandNode('serve-long', { timeoutSec: 0.05 }), commandNode('q', { gate: [{ kind: 'manual', actions: [] }] })])
    let wasKilled = false
    const eng = createEngine({
      getWorkflow: (id) => (id === def.id ? def : null),
      store: createMemoryRunStore(),
      runCommand: async (cmd, opts) => {
        if (cmd === 'q') return res(0)
        return await new Promise<CommandResult>((resolve) => {
          // 真实 kill 会让进程退出→promise resolve;此处 onStart kill 同时记标志并 resolve。
          opts.onStart?.({
            kill: () => {
              wasKilled = true
              resolve(res(-1, { killed: true }))
            }
          })
          opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
        })
      }
    })
    const { runId, settled } = eng.start(REQ)
    await tick()
    eng.advanceCommand(runId, 'detach') // serve-long 转后台(带 0.05s 超时)
    await settled // 停在 q 人工门
    expect(eng.listBackground(runId)).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 120)) // 等后台超时触发
    expect(wasKilled).toBe(true) // 后台命令被超时杀掉
    expect(eng.listBackground(runId)).toHaveLength(0) // 记录被摘掉
  })

  it(
    '集成(真 runCommand):后台命令到超时被真的杀掉、记录摘除',
    async () => {
      const NODE = `"${process.execPath}"`
      const wtDir = mkdtempSync(join(tmpdir(), 'klarit-bgto-'))
      trash.push(wtDir)
      const def = wf([
        commandNode(`${NODE} -e "setInterval(()=>{},100)"`, { timeoutSec: 0.6 }),
        commandNode(`${NODE} -e "0"`, { gate: [{ kind: 'manual', actions: [] }] })
      ])
      const eng = createEngine({ getWorkflow: (id) => (id === def.id ? def : null), store: createMemoryRunStore() })
      const { runId, settled } = eng.start({ ...REQ, worktreePath: wtDir })
      await tick(200) // 让长命令真起来
      eng.advanceCommand(runId, 'detach')
      await settled // 停在第二节点人工门
      expect(eng.listBackground(runId)).toHaveLength(1)
      await new Promise((r) => setTimeout(r, 1800)) // 等过 0.6s 超时 + 杀进程
      expect(eng.listBackground(runId)).toHaveLength(0) // 后台被超时杀掉、记录摘除
    },
    15000
  )

  it('killAllBackground 杀活进程但保留记录(关软件=自动暂停,重开据记录恢复)', async () => {
    const { engine, killed } = bgFixture(manualNode())
    const { runId } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach')
    await tick()
    expect(engine.listBackground(runId)).toHaveLength(1)
    engine.killAllBackground()
    expect(killed()).toBe(true) // 活进程被杀(不留孤儿)
    expect(engine.listBackground(runId)).toHaveLength(1) // 记录保留供重开恢复
  })
})
