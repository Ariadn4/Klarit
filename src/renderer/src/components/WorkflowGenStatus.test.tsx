import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useWorkflowGenStore, WORKFLOW_GEN_FAILED_NOTICE_MS } from '../stores/workflowGen'
import { WorkflowGenStatus } from './WorkflowGenStatus'

beforeEach(() => {
  useWorkflowGenStore.setState({ generating: false, failedNotice: false })
})

describe('WorkflowGenStatus · 底栏工作流生成状态（只告知、不可交互）', () => {
  it('未生成时什么也不渲染（底栏不占位）', () => {
    const { container } = render(<WorkflowGenStatus />)
    expect(container).toBeEmptyDOMElement()
  })

  it('generating 状态事件后显示指示，且不含任何可交互元素', () => {
    useWorkflowGenStore.getState().setStatus('generating')
    render(<WorkflowGenStatus />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/工作流/)
    expect(screen.queryByRole('button')).toBeNull()
    expect(status.querySelector('button, a, input, select, textarea')).toBeNull()
  })

  it('done 状态后指示消失', () => {
    useWorkflowGenStore.getState().setStatus('generating')
    const { rerender } = render(<WorkflowGenStatus />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    useWorkflowGenStore.getState().setStatus('done')
    rerender(<WorkflowGenStatus />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('WorkflowGenStatus · failed 轻提示（自动消失、不打断）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('failed 状态后显示「已用默认工作流」轻提示（非阻断、不可交互）', () => {
    act(() => useWorkflowGenStore.getState().setStatus('failed'))
    render(<WorkflowGenStatus />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/默认工作流/)
    // 不复用转圈指示的措辞（区别于 generating）
    expect(status).not.toHaveTextContent('正在为本项目生成工作流')
    // 非阻断、不可交互
    expect(status.className).toContain('pointer-events-none')
    expect(status.querySelector('button, a, input, select, textarea')).toBeNull()
  })

  it('failed 轻提示在超时后自动消失（底栏归空）', () => {
    act(() => useWorkflowGenStore.getState().setStatus('failed'))
    const { rerender } = render(<WorkflowGenStatus />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(WORKFLOW_GEN_FAILED_NOTICE_MS)
    })
    rerender(<WorkflowGenStatus />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('failed 后紧接 generating 事件应取消待清计时、直接显示生成中', () => {
    act(() => useWorkflowGenStore.getState().setStatus('failed'))
    act(() => useWorkflowGenStore.getState().setStatus('generating'))
    const { rerender } = render(<WorkflowGenStatus />)
    expect(screen.getByRole('status')).toHaveTextContent(/工作流/)
    // 旧的 failed 计时不应把 generating 指示清掉
    act(() => {
      vi.advanceTimersByTime(WORKFLOW_GEN_FAILED_NOTICE_MS)
    })
    rerender(<WorkflowGenStatus />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
