import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkflowSummary } from '@shared/types'
import { WorkflowPicker } from './WorkflowPicker'

let items: WorkflowSummary[]
let active: string | null

function installKlarit(): void {
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
    listWorkflows: vi.fn(async () => items),
    getActiveWorkflow: vi.fn(async () => active),
    setActiveWorkflow: vi.fn(async (id: string | null) => {
      active = id
    })
  }
}

beforeEach(() => {
  items = [
    { id: 'a', name: { zh: '流程A' } },
    { id: 'b', name: { zh: '流程B' } }
  ]
  active = 'a'
  installKlarit()
})

describe('WorkflowPicker 项目激活工作流', () => {
  it('列出工作流并标示当前激活', async () => {
    render(<WorkflowPicker />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /流程A/ })).toBeInTheDocument())
    expect(screen.getByRole('radio', { name: /流程A/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /流程B/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('切换激活即时持久化并更新选中态', async () => {
    render(<WorkflowPicker />)
    await screen.findByRole('radio', { name: /流程B/ })
    await userEvent.click(screen.getByRole('radio', { name: /流程B/ }))
    expect(window.klarit.setActiveWorkflow).toHaveBeenCalledWith('b')
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /流程B/ })).toHaveAttribute('aria-checked', 'true')
    )
  })

  it('空库时提示去应用设置新建', async () => {
    items = []
    active = null
    installKlarit()
    render(<WorkflowPicker />)
    await waitFor(() => expect(screen.getByText(/还没有工作流/)).toBeInTheDocument())
  })

  it('无效工作流标（无效）、禁用、点击不激活', async () => {
    items = [
      { id: 'a', name: { zh: '流程A' } },
      { id: 'b', name: { zh: '流程B' }, invalidReason: '建了分支却没有删分支' }
    ]
    active = 'a'
    installKlarit()
    render(<WorkflowPicker />)
    const invalid = await screen.findByRole('radio', { name: /流程B/ })
    expect(invalid).toBeDisabled()
    expect(within(invalid).getByText(/无效/)).toBeInTheDocument()
    await userEvent.click(invalid)
    expect(window.klarit.setActiveWorkflow).not.toHaveBeenCalled()
    expect(invalid).toHaveAttribute('aria-checked', 'false')
  })

  it('激活某工作流后回调 onActiveChange(id)', async () => {
    const onActiveChange = vi.fn()
    render(<WorkflowPicker onActiveChange={onActiveChange} />)
    await screen.findByRole('radio', { name: /流程B/ })
    await userEvent.click(screen.getByRole('radio', { name: /流程B/ }))
    await waitFor(() => expect(onActiveChange).toHaveBeenCalledWith('b'))
  })

  it('有效工作流仍可点击激活并持久化', async () => {
    items = [
      { id: 'a', name: { zh: '流程A' } },
      { id: 'b', name: { zh: '流程B' }, invalidReason: '无效' }
    ]
    active = 'a'
    installKlarit()
    render(<WorkflowPicker />)
    const valid = await screen.findByRole('radio', { name: /流程A/ })
    await userEvent.click(valid)
    expect(window.klarit.setActiveWorkflow).toHaveBeenCalledWith('a')
  })
})
