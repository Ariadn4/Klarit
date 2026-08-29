import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EngineProgressEvent, RunJournalEntry, WorkflowNode } from '@shared/types'
import { RunTimeline } from './RunTimeline'
import { useCardsStore } from '../stores/cards'

let clock = 0
function entry(event: Exclude<EngineProgressEvent, { kind: 'op-chunk' }>, at?: number): RunJournalEntry {
  return { ...event, at: at ?? ++clock }
}
const nodes: WorkflowNode[] = [
  { id: 'n1', name: { zh: '实现功能' }, stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } }, outputs: [] },
  { id: 'n2', name: { zh: '跑测试' }, stageId: 's', executor: { kind: 'command', commands: [{ command: 'npm test' }] }, outputs: [] }
]

/** 装 window.klarit 并回传进度事件推送器（模拟引擎实时事件）。 */
function installKlarit(journal: RunJournalEntry[], buckets: string[] = []) {
  let push: ((evt: EngineProgressEvent) => void) | null = null
  const api = {
    readRunJournal: vi.fn(async () => journal),
    listRunOutputBuckets: vi.fn(async () => buckets),
    readRunOutput: vi.fn(async () => ''),
    copyText: vi.fn(async () => {}),
    onEngineProgress: vi.fn((handler: (evt: EngineProgressEvent) => void) => {
      push = handler
      return () => {
        push = null
      }
    })
  }
  ;(window as unknown as { klarit: unknown }).klarit = api
  return { api, emit: (evt: EngineProgressEvent) => act(() => push?.(evt)) }
}

beforeEach(() => {
  useCardsStore.setState({ outputs: {} })
})

describe('RunTimeline · 分段渲染', () => {
  it('按段渲染节点名、耗时、终局、门重试与后台任务', async () => {
    installKlarit([
      entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 0),
      entry({ kind: 'gate-retry', runId: 'r1', nodeId: 'n1', gateIndex: -1, attempt: { cause: 'error', rerun: 'node' }, count: 1 }, 1000),
      entry({ kind: 'gate-retry', runId: 'r1', nodeId: 'n1', gateIndex: 0, attempt: { cause: 'timeout', rerun: 'gate' }, count: 2 }, 2000),
      entry({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b1', label: '起后端', status: 'started' }, 3000),
      entry({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'b1', label: '起后端', status: 'timeout' }, 4000),
      entry({ kind: 'node-exit', runId: 'r1', nodeId: 'n1' }, 12000),
      entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n2' }, 12000),
      entry({ kind: 'skip', runId: 'r1', nodeId: 'n2', reason: '中止,进入下一节点' }, 13000),
      entry({ kind: 'node-exit', runId: 'r1', nodeId: 'n2' }, 15000)
    ])
    render(<RunTimeline runId="r1" nodes={nodes} />)

    // 节点名按工作流定义解析（不是裸 nodeId）。
    expect(await screen.findByText('实现功能')).toBeInTheDocument()
    expect(screen.getByText('跑测试')).toBeInTheDocument()
    // 耗时。
    expect(screen.getByText('12 秒')).toBeInTheDocument()
    expect(screen.getByText('3 秒')).toBeInTheDocument()
    // 终局：完成 / 跳过 + 原因。
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('已跳过')).toBeInTheDocument()
    expect(screen.getByText(/中止,进入下一节点/)).toBeInTheDocument()
    // 门重试次数 + 各次原因/粒度。
    expect(screen.getByText(/门重试 2 次/)).toBeInTheDocument()
    expect(screen.getByText(/报错·重跑节点/)).toBeInTheDocument()
    expect(screen.getByText(/超时·重跑门/)).toBeInTheDocument()
    // 后台任务及其结局。
    expect(screen.getByText('起后端')).toBeInTheDocument()
    expect(screen.getByText('已超时中止')).toBeInTheDocument()
  })

  it('未结束的段（停在决策 / 进程中断）有明确标识，且不被丢弃', async () => {
    installKlarit([
      entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 0),
      entry({ kind: 'node-exit', runId: 'r1', nodeId: 'n1' }, 1000),
      entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n2' }, 1000),
      entry(
        { kind: 'decision', runId: 'r1', decision: { source: 'n2:manual-gate', sourceKind: 'engine', titleKey: 'k', options: [] } },
        6000
      )
    ])
    render(<RunTimeline runId="r1" nodes={nodes} />)
    expect(await screen.findByText('跑测试')).toBeInTheDocument()
    expect(screen.getByText('停在决策')).toBeInTheDocument()
    expect(screen.getByText('未结束')).toBeInTheDocument()
  })

  it('回退重入同一节点 → 两段（第二段标出「第 2 次进入」）', async () => {
    installKlarit([
      entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 0),
      entry({ kind: 'node-exit', runId: 'r1', nodeId: 'n1' }, 1000),
      entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n2' }, 1000),
      entry({ kind: 'node-exit', runId: 'r1', nodeId: 'n2' }, 2000),
      entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 3000),
      entry({ kind: 'node-exit', runId: 'r1', nodeId: 'n1' }, 4000)
    ])
    render(<RunTimeline runId="r1" nodes={nodes} />)
    expect(await screen.findAllByText('实现功能')).toHaveLength(2)
    expect(screen.getByText('第 2 次进入')).toBeInTheDocument()
  })

  it('无运行日志（本能力上线前的运行）→ 「无记录」空态，不报错', async () => {
    installKlarit([])
    render(<RunTimeline runId="r1" nodes={nodes} />)
    expect(await screen.findByText('这次运行没有记录')).toBeInTheDocument()
  })
})

describe('RunTimeline · 展开看输出', () => {
  it('展开段 → 用既有输出分桶组件渲染该节点的前台桶与后台桶（不另写输出渲染）', async () => {
    const { api } = installKlarit(
      [
        entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n2' }, 0),
        entry({ kind: 'background', runId: 'r1', nodeId: 'n2', bgId: 'b1', label: '起后端', status: 'started' }, 500),
        entry({ kind: 'node-exit', runId: 'r1', nodeId: 'n2' }, 1000)
      ],
      ['node:n2:0', 'bg:b1']
    )
    render(<RunTimeline runId="r1" nodes={nodes} />)
    const toggle = await screen.findByRole('button', { name: /跑测试/ })
    expect(api.readRunOutput).not.toHaveBeenCalled() // 未展开不读输出

    await userEvent.click(toggle)
    // 既有 CommandOutputView 挂载即从引擎缓冲 seed（按桶读）——据此断言复用的是它。
    await waitFor(() => expect(api.readRunOutput).toHaveBeenCalledWith('r1', 'node:n2:0'))
    expect(api.readRunOutput).toHaveBeenCalledWith('r1', 'bg:b1')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('RunTimeline · 运行中实时追加', () => {
  it('新事件到达 → 时间线自动追加新段，无需手动刷新', async () => {
    const { emit } = installKlarit([entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 0)])
    render(<RunTimeline runId="r1" nodes={nodes} />)
    expect(await screen.findByText('实现功能')).toBeInTheDocument()
    expect(screen.queryByText('跑测试')).not.toBeInTheDocument()

    emit({ kind: 'node-exit', runId: 'r1', nodeId: 'n1' })
    emit({ kind: 'node-enter', runId: 'r1', nodeId: 'n2' })
    expect(await screen.findByText('跑测试')).toBeInTheDocument()
  })

  it('别的运行的事件不串进本运行的时间线；op-chunk 不产生条目', async () => {
    const { emit } = installKlarit([entry({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 0)])
    render(<RunTimeline runId="r1" nodes={nodes} />)
    expect(await screen.findByText('实现功能')).toBeInTheDocument()

    emit({ kind: 'node-enter', runId: 'r-other', nodeId: 'n2' })
    emit({ kind: 'op-chunk', runId: 'r1', nodeId: 'n2', stream: 'stdout', chunk: '不该建段\n' })
    expect(screen.queryByText('跑测试')).not.toBeInTheDocument()
    expect(screen.queryByText('不该建段')).not.toBeInTheDocument()
  })
})
