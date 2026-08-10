/**
 * 引擎旁挂运行日志（run-timeline「运行日志由既有事件流派生，不新增埋点」）：
 * 引擎在既有 emit 处把事件交给 journal（单点），故一次真实运行的结构性事件全数落册、`op-chunk` 一条不落；
 * 且 journal 是**旁路**——写失败不得阻断运行推进。
 */

import { describe, it, expect } from 'vitest'
import type { CommandResult } from '../command-run'
import type { EngineProgressEvent, WorkflowDefinition, WorkflowGateItem, WorkflowNode } from '../../shared/types'
import { createEngine, type EngineDeps } from './engine'
import { createMemoryRunStore } from './run-store'
import { createMemoryRunJournal, type RunJournal } from './run-journal'

let nid = 0
function commandNode(commands: string[], gate?: WorkflowGateItem[]): WorkflowNode {
  return {
    id: `n${nid++}-cmd`,
    name: { zh: 'cmd' },
    stageId: 's',
    executor: { kind: 'command', commands: commands.map((command) => ({ command })) },
    outputs: [],
    ...(gate ? { gate } : {})
  }
}
function wf(nodes: WorkflowNode[]): WorkflowDefinition {
  return { id: 'wf', name: { zh: 'wf' }, stages: [{ id: 's', name: { zh: 'S' } }], nodes }
}
const res = (code: number, extra: Partial<CommandResult> = {}): CommandResult => ({
  code,
  stdout: '',
  stderr: '',
  killed: false,
  ...extra
})
const REQ = { workflowId: 'wf', repoPath: '/tmp/x', branch: 'feature', baseBranch: 'main' }
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))

function makeEngine(def: WorkflowDefinition, runCommand: EngineDeps['runCommand'], journal: RunJournal) {
  const events: EngineProgressEvent[] = []
  const engine = createEngine({
    getWorkflow: (id) => (id === def.id ? def : null),
    store: createMemoryRunStore(),
    emit: (e) => events.push(e),
    runCommand,
    journal
  })
  return { engine, events }
}

describe('引擎旁挂运行日志', () => {
  it('一次含跳过 + 门重试 + 后台命令 + 决策的运行 → 结构性事件全数入册，且无 op-chunk 条目', async () => {
    // n0：两条长驻命令 → 手动转后台（background started ×2 + skip）；
    // n1：命令成功后客观门恒超时 → gate-retry 直到升级为决策。
    const serve = commandNode(['serve-a', 'serve-b'])
    const gated = commandNode(['build'], [{ kind: 'auto', check: { kind: 'inline', command: 'slow' }, timeoutSec: 0.05 }])
    const journal = createMemoryRunJournal()
    const { engine, events } = makeEngine(
      wf([serve, gated]),
      async (cmd, opts) => {
        if (cmd === 'build') {
          opts.onChunk?.('stdout', '编译输出-不该进日志\n')
          return res(0)
        }
        // serve-*/slow：只在被取消时返回（长驻）。
        return await new Promise<CommandResult>((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(res(-1, { killed: true })), { once: true })
        })
      },
      journal
    )
    const { runId, settled } = engine.start(REQ)
    await tick()
    engine.advanceCommand(runId, 'detach')
    const bp = await settled
    engine.killAllBackground()
    expect(bp.state).toBe('waiting-decision')

    const entries = journal.read(runId)
    const kinds = new Set(entries.map((e) => e.kind))
    for (const k of ['state', 'node-enter', 'node-exit', 'phase', 'skip', 'gate-retry', 'background', 'decision']) {
      expect(kinds).toContain(k)
    }
    // op-chunk 一条不入，输出字节不被复制。
    expect(entries.some((e) => (e.kind as string) === 'op-chunk')).toBe(false)
    expect(JSON.stringify(entries)).not.toContain('编译输出-不该进日志')
    // 日志 = 事件流去掉 op-chunk 的忠实副本（同序、同内容），不多不少。
    const structural = events.filter((e) => e.kind !== 'op-chunk')
    expect(entries.map((e) => e.kind)).toEqual(structural.map((e) => e.kind))
    expect(entries.every((e) => e.runId === runId && typeof e.at === 'number')).toBe(true)
    // 时刻单调不减。
    expect(entries.every((e, i) => i === 0 || e.at >= entries[i - 1].at)).toBe(true)
  })

  it('journal 写入失败不阻断运行推进（旁路永不拖垮引擎）', async () => {
    const boom: RunJournal = {
      append: () => {
        throw new Error('磁盘满了')
      },
      read: () => [],
      remove: () => {}
    }
    const { engine } = makeEngine(wf([commandNode(['build'])]), async () => res(0), boom)
    const bp = await engine.start(REQ).settled
    expect(bp.state).toBe('done')
  })
})
