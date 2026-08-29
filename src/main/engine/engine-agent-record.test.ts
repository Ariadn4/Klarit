/**
 * agent 运行的**两份记录**在引擎侧的接线，以及续接兜底改从原始流派生：
 *
 * - 引擎为每次 agent 运行分配原始流记录路径（`historyPath`），与展示分桶同目录、同生共死；
 * - 走兜底层重建时喂回的历史由**原始流记录**派生——不再吃「展示转写丢 tool_result / 截 80 字」的二次损失；
 * - 本能力上线前的运行没有原始记录 → 回落既有展示转写，不报错、不阻断续接。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHandshake, RunRequest, WorkflowDefinition, WorkflowNode } from '../../shared/types'
import { createEngine, type AgentPrep } from './engine'
import { createMemoryRunStore } from './run-store'
import { createOutputBuffer, createMemoryOutputBuffer, type OutputBuffer } from './output-buffer'
import { claudeAdapter } from '../agent/adapter'
import type { AgentRunner, AgentRunSpec } from '../agent/runner'

const LONG_PATH = 'src/main/engine/engine-with-a-really-long-file-name-that-blows-past-eighty-characters.ts'

/** 一段真实形状的 claude stream-json：系统事件 + 工具调用（长路径）+ 工具结果 + 文本。 */
const STREAM_LINES = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-1' }),
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: LONG_PATH } }] }
  }),
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '写入成功：新增 handleLine 分支' }] }
  }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '改完了，跑测试。' }] } })
]

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
const PREP: AgentPrep = { prompt: '完整任务 prompt', toolId: 'claude-code' }
const REQ: RunRequest = {
  workflowId: 'wf',
  repoPath: '/no/repo',
  branch: 'card-x',
  worktreePath: '/no/wt',
  baseBranch: 'main'
}

/**
 * 假 agent：真按 claude 的口径把流吐出来——原始行进 `historyPath`（逐行原样），
 * 展示文本走 `onChunk`（经既有展示转写，丢 tool_result、截 80 字），与真实 runner 一致。
 */
function streamingRunner(): AgentRunner & { specs: AgentRunSpec[]; prompts: string[] } {
  const r = {
    specs: [] as AgentRunSpec[],
    prompts: [] as string[],
    supportsResume: () => false, // 逼续接走兜底层（喂回历史重建），本文件测的就是这一层
    start(spec: AgentRunSpec & { prompt: string }): ReturnType<AgentRunner['start']> {
      r.specs.push(spec)
      r.prompts.push(spec.prompt)
      for (const line of STREAM_LINES) {
        if (spec.historyPath) appendFileSync(spec.historyPath, `${line}\n`)
        const shown = claudeAdapter.displayFromStreamLine?.(line)
        if (shown) spec.onChunk?.('stdout', `${shown}\n`)
      }
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    },
    resume: () => null
  }
  return r
}

/** 第一次握手 failed（逼引擎自愈续接一轮），之后 done。 */
function failThenDone(): () => AgentHandshake {
  let n = 0
  return () => (n++ === 0 ? { status: 'failed', detail: '测试没过' } : { status: 'done' })
}

const dirs: string[] = []
function tmpBuffer(): OutputBuffer {
  const d = mkdtempSync(join(tmpdir(), 'klarit-engrec-'))
  dirs.push(d)
  return createOutputBuffer(d)
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function run(buffer: OutputBuffer, runner: AgentRunner): { runId: string; settled: Promise<unknown> } {
  const engine = createEngine({
    getWorkflow: () => DEF,
    store: createMemoryRunStore(),
    outputBuffer: buffer,
    runAgent: runner,
    prepareAgent: () => PREP,
    readHandshake: failThenDone()
  })
  const launched = engine.start(REQ)
  return { runId: launched.runId, settled: launched.settled }
}

describe('原始流记录：引擎接线', () => {
  it('agent 运行 → 原始流记录逐行原样落盘，含展示转写会折叠的事件', async () => {
    const buf = tmpBuffer()
    const runner = streamingRunner()
    const { runId, settled } = run(buf, runner)
    await settled

    expect(typeof runner.specs[0].historyPath).toBe('string') // 引擎确实传了（该字段过去从没接过线）
    const raw = buf.readRaw(runId, 'node:n1')
    expect(raw).toContain('"type":"system"') // 展示整类丢弃的系统事件
    expect(raw).toContain('tool_result') // 展示整类丢弃的工具结果
    expect(raw).toContain(LONG_PATH) // 完整路径，未被 80 字截断削过
  })

  it('两份记录并存且互不覆盖：展示照旧压缩，原始照旧保真', async () => {
    const buf = tmpBuffer()
    const { runId, settled } = run(buf, streamingRunner())
    await settled

    const display = buf.read(runId, 'node:n1')
    expect(display).toContain('[工具] Edit')
    expect(display).not.toContain('tool_result')
    expect(display).not.toContain(LONG_PATH) // 展示把目标截到 80 字
    expect(buf.readRaw(runId, 'node:n1')).toContain(LONG_PATH)
  })

  it('保留/清理口径一致：清掉该运行，两份记录一起没', async () => {
    const buf = tmpBuffer()
    const { runId, settled } = run(buf, streamingRunner())
    await settled
    buf.remove(runId)
    expect(buf.read(runId, 'node:n1')).toBe('')
    expect(buf.readRaw(runId, 'node:n1')).toBe('')
  })
})

describe('续接兜底：喂回的历史由原始记录派生', () => {
  it('展示转写已折叠工具结果、截断工具目标时，重建 prompt 仍含完整目标与结果要点', async () => {
    const runner = streamingRunner()
    const { settled } = run(tmpBuffer(), runner)
    await settled

    expect(runner.prompts).toHaveLength(2) // 第一轮 failed → 自愈续接（无 resume）走兜底重建
    const rebuilt = runner.prompts[1]
    expect(rebuilt).toContain('完整任务 prompt') // 完整任务照旧垫底
    expect(rebuilt).toContain(LONG_PATH) // 完整工具目标（展示里是被截的）
    expect(rebuilt).toContain('写入成功：新增 handleLine 分支') // 工具结果要点（展示里根本没有）
    expect(rebuilt).toContain('测试没过') // 续接说明照旧
  })

  it('无原始记录（本能力上线前的运行）→ 回落既有展示转写，不报错、不阻断续接', async () => {
    const runner = streamingRunner()
    // 内存缓冲无盘 → 引擎拿不到原始记录路径，假 agent 只留下展示转写
    const { settled } = run(createMemoryOutputBuffer(), runner)
    const bp = (await settled) as { state: string }

    expect(bp.state).toBe('done') // 续接照常走完，没被卡住
    expect(runner.specs[0].historyPath).toBeUndefined()
    expect(runner.prompts).toHaveLength(2)
    expect(runner.prompts[1]).toContain('[工具] Edit') // 回落到展示转写
    expect(runner.prompts[1]).toContain('完整任务 prompt')
  })
})
