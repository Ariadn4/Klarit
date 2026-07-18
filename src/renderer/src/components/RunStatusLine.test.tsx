import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { NodeExecutor, RunBreakpoint, WorkflowDefinition, WorkflowNode } from '@shared/types'
import { RunStatusLine } from './RunStatusLine'

const commandExec: NodeExecutor = { kind: 'command', commands: [{ command: 'npm test' }] }
const agentExec: NodeExecutor = { kind: 'agent', instruction: { kind: 'inline', text: 'do it' } }

function node(id: string, executor: NodeExecutor, name = id): WorkflowNode {
  return { id, name: { zh: name }, stageId: 's1', executor, outputs: [] }
}

function wf(): WorkflowDefinition {
  return {
    id: 'w',
    name: { zh: 'W' },
    stages: [{ id: 's1', name: { zh: '开发' } }],
    nodes: [node('n1', commandExec, '跑测试'), node('n2', agentExec, '写代码')]
  }
}

function bp(over: Partial<RunBreakpoint> = {}): RunBreakpoint {
  return {
    runId: 'r1',
    request: { workflowId: 'w', repoPath: '/repo' },
    state: 'running',
    currentNodeId: 'n1',
    phase: { kind: 'executing' },
    pendingDecision: null,
    ...over
  }
}

describe('RunStatusLine', () => {
  it('命令执行中 → 呼吸蓝点 + 节点名 + 「工作中」细状态', () => {
    const { container } = render(<RunStatusLine breakpoint={bp()} workflow={wf()} fallbackStatus="进行中" />)
    expect(screen.getByText('跑测试（工作中）')).toBeInTheDocument()
    const d = container.querySelector('span.rounded-full')
    expect(d?.className).toContain('bg-cobalt-500')
    expect(d?.className).toContain('dot-breathe')
  })

  it('等待决策 → 静止红点 + 「等待决策」细状态', () => {
    const { container } = render(
      <RunStatusLine breakpoint={bp({ state: 'waiting-decision' })} workflow={wf()} fallbackStatus="进行中" />
    )
    expect(screen.getByText('跑测试（等待决策）')).toBeInTheDocument()
    const d = container.querySelector('span.rounded-full')
    expect(d?.className).toContain('bg-danger')
    expect(d?.className).not.toContain('dot-breathe')
  })

  it('暂停 → 圆点静止 + 出现暂停图标', () => {
    const { container } = render(
      <RunStatusLine breakpoint={bp({ state: 'paused' })} workflow={wf()} fallbackStatus="进行中" />
    )
    const d = container.querySelector('span.rounded-full')
    expect(d?.className).not.toContain('dot-breathe')
    expect(screen.getByLabelText('已暂停')).toBeInTheDocument()
  })

  it('无断点 → 回落生命周期状态文案，不渲染圆点', () => {
    const { container } = render(<RunStatusLine breakpoint={null} workflow={wf()} fallbackStatus="已完成" />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(container.querySelector('span.rounded-full')).toBeNull()
  })

  it('运行已 done → 无圆点，回落状态文案', () => {
    const { container } = render(
      <RunStatusLine breakpoint={bp({ state: 'done' })} workflow={wf()} fallbackStatus="已完成" />
    )
    expect(container.querySelector('span.rounded-full')).toBeNull()
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })
})
