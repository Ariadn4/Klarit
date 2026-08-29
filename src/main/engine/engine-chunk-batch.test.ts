/**
 * 流式输出的三条独立口径（`agent-execution`「流式输出推送合批与回看窗口」）：
 *
 * - **落盘保真且逐行即时**——不被合批延迟或丢弃（崩溃半路的可重建性优先于界面流畅）；
 * - **推送合批**——按时间窗把同一输出桶的相邻增量合并再发（结构化流式输出可达每 token 一行）；
 * - **不设输出上限杀进程**——长会话必然触达任何此类上限，那不是护栏是定时炸弹。
 */
import { describe, it, expect } from 'vitest'
import type { EngineProgressEvent, RunRequest, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type AgentPrep } from './engine'
import { createMemoryRunStore } from './run-store'
import { createMemoryOutputBuffer, type OutputBuffer } from './output-buffer'
import type { AgentRunner } from '../agent/runner'

const RUN_ID = 'r-fixed'
function agentNode(): WorkflowNode {
  return {
    id: 'n1',
    name: { zh: 'implement' },
    stageId: 's',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: '实现' } },
    outputs: []
  }
}
const DEF: WorkflowDefinition = {
  id: 'wf',
  name: { zh: 'wf' },
  stages: [{ id: 's', name: { zh: 'S' } }],
  nodes: [agentNode()]
}
const PREP: AgentPrep = { prompt: 'P', toolId: 'claude-code' }
const REQ: RunRequest = {
  workflowId: 'wf',
  repoPath: '/no/repo',
  branch: 'card-x',
  worktreePath: '/no/wt',
  baseBranch: 'main'
}

/** 一次运行的现场：事件流、输出缓冲、以及「突发刚结束那一刻」的快照（用来分辨落盘 vs 推送）。 */
interface Harness {
  events: EngineProgressEvent[]
  buffer: OutputBuffer
  killed: boolean
  /** 突发输出刚吐完、尚未让出事件循环那一刻：已落盘的字节 / 已推送的 op-chunk 条数。 */
  atBurst: { buffered: string; pushed: number }
  settled: Promise<{ state: string }>
}

/** 起一次运行：agent 同步吐 `lines` 行高频输出后正常退出。 */
function burst(lines: string[]): Harness {
  const events: EngineProgressEvent[] = []
  const buffer = createMemoryOutputBuffer()
  const h: Harness = {
    events,
    buffer,
    killed: false,
    atBurst: { buffered: '', pushed: 0 },
    settled: Promise.resolve({ state: '' })
  }
  const runner: AgentRunner = {
    supportsResume: () => false,
    start(spec) {
      for (const l of lines) spec.onChunk?.('stdout', l)
      // 突发刚吐完、还没让出事件循环：落盘该已经齐了，推送该还压着
      h.atBurst = {
        buffered: buffer.read(RUN_ID, 'node:n1'),
        pushed: events.filter((e) => e.kind === 'op-chunk').length
      }
      return {
        kill: () => {
          h.killed = true
        },
        done: Promise.resolve({ code: 0, killed: false })
      }
    },
    resume: () => null
  }
  const engine = createEngine({
    getWorkflow: () => DEF,
    store: createMemoryRunStore(),
    newRunId: () => RUN_ID,
    outputBuffer: buffer,
    emit: (e) => events.push(e),
    runAgent: runner,
    prepareAgent: () => PREP,
    readHandshake: () => ({ status: 'done' })
  })
  h.settled = engine.start(REQ).settled as unknown as Promise<{ state: string }>
  return h
}

const lines = (n: number, text = '进度'): string[] => Array.from({ length: n }, (_, i) => `${text}-${i}\n`)

describe('流式推送合批', () => {
  it('高频流式输出 → 渲染层收到的事件数远少于输出行数', async () => {
    const all = lines(400)
    const h = burst(all)
    await h.settled
    const chunks = h.events.filter((e) => e.kind === 'op-chunk')
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.length).toBeLessThan(20) // 400 行 → 个位数量级的合并事件
  })

  it('合并不丢字节也不改序：合批后的增量拼起来 = 原始输出', async () => {
    const all = lines(400)
    const h = burst(all)
    await h.settled
    const merged = h.events
      .filter((e): e is Extract<EngineProgressEvent, { kind: 'op-chunk' }> => e.kind === 'op-chunk')
      .map((e) => e.chunk)
      .join('')
    expect(merged).toBe(all.join(''))
  })

  it('结构性事件之前先把在途增量放出去，次序不倒置', async () => {
    const h = burst(lines(50))
    await h.settled
    const lastChunk = h.events.map((e) => e.kind).lastIndexOf('op-chunk')
    const opOutput = h.events.map((e) => e.kind).indexOf('op-output')
    expect(lastChunk).toBeGreaterThanOrEqual(0)
    expect(opOutput).toBeGreaterThan(lastChunk)
  })
})

describe('合批不影响落盘', () => {
  it('落盘逐行即时：突发刚吐完就已在缓冲里齐了，此时推送还压着', async () => {
    const all = lines(400)
    const h = burst(all)
    await h.settled
    expect(h.atBurst.buffered).toBe(all.join('')) // 落盘绕过合批，一行不缺
    expect(h.atBurst.pushed).toBe(0) // 推送还在时间窗里攒着
  })

  it('中断（关软件）时落盘内容无尾部缺失', async () => {
    const all = lines(120)
    const h = burst(all)
    // 不等 flush，直接看缓冲：尾行也在
    expect(h.atBurst.buffered.endsWith('进度-119\n')).toBe(true)
    await h.settled
    expect(h.buffer.read(RUN_ID, 'node:n1')).toBe(all.join(''))
  })
})

describe('不以输出量作护栏', () => {
  it('长时间大量输出的运行不被系统终止（无输出上限杀进程）', async () => {
    const all = lines(5000, 'x'.repeat(200))
    const h = burst(all)
    const bp = await h.settled
    expect(bp.state).toBe('done') // 跑到自己结束
    expect(h.killed).toBe(false) // 没有任何一处因为输出量去杀它
    expect(h.buffer.read(RUN_ID, 'node:n1').length).toBe(all.join('').length) // 也没为了省内存丢字节
  })
})
