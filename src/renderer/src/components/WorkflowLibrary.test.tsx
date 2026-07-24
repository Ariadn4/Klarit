import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkflowSummary } from '@shared/types'
import { WorkflowLibrary } from './WorkflowLibrary'

let items: WorkflowSummary[]

function installKlarit(): void {
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
    listWorkflows: vi.fn(async () => items),
    createWorkflow: vi.fn(async () => {
      items = [...items, { id: 'new-x', name: { zh: '默认工作流' } }]
      return { id: 'new-x', name: { zh: '默认工作流' }, stages: [] }
    }),
    cloneWorkflow: vi.fn(async () => {
      items = [...items, { id: 'a-copy', name: { zh: '流程A 副本' } }]
      return { id: 'a-copy', name: { zh: '流程A 副本' }, stages: [] }
    }),
    deleteWorkflow: vi.fn(async (id: string) => {
      items = items.filter((w) => w.id !== id)
      return items
    }),
    importWorkflow: vi.fn(async () => null),
    getWorkflow: vi.fn(async () => ({
      id: 'a',
      name: { zh: '流程A' },
      stages: [{ id: 's1', name: { zh: '开发' } }],
      nodes: [
        {
          id: 'n1',
          name: { zh: '写代码' },
          stageId: 's1',
          executor: { kind: 'agent', instruction: { kind: 'inline', text: '' } },
          outputs: []
        }
      ]
    }))
  }
}

beforeEach(() => {
  items = [
    { id: 'a', name: { zh: '流程A' } },
    { id: 'b', name: { zh: '流程B' } }
  ]
  installKlarit()
})

describe('WorkflowLibrary 工作流库（应用级）', () => {
  it('列出全部工作流', async () => {
    render(<WorkflowLibrary />)
    expect(await screen.findByText('流程A')).toBeInTheDocument()
    expect(screen.getByText('流程B')).toBeInTheDocument()
  })

  it('新建后列表刷新', async () => {
    render(<WorkflowLibrary />)
    await screen.findByText('流程A')
    await userEvent.click(screen.getByRole('button', { name: '新建' }))
    expect(window.klarit.createWorkflow).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('默认工作流')).toBeInTheDocument())
  })

  it('克隆后出现副本', async () => {
    render(<WorkflowLibrary />)
    await screen.findByText('流程A')
    await userEvent.click(screen.getByRole('button', { name: '克隆 流程A' }))
    expect(window.klarit.cloneWorkflow).toHaveBeenCalledWith('a')
    await waitFor(() => expect(screen.getByText('流程A 副本')).toBeInTheDocument())
  })

  it('删除后列表移除该工作流', async () => {
    render(<WorkflowLibrary />)
    await screen.findByText('流程B')
    await userEvent.click(screen.getByRole('button', { name: '删除 流程B' }))
    expect(window.klarit.deleteWorkflow).toHaveBeenCalledWith('b')
    await waitFor(() => expect(screen.queryByText('流程B')).not.toBeInTheDocument())
  })

  it('点击编辑进入编辑器', async () => {
    render(<WorkflowLibrary />)
    await screen.findByText('流程A')
    await userEvent.click(screen.getByRole('button', { name: '编辑 流程A' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument())
    expect(window.klarit.getWorkflow).toHaveBeenCalledWith('a')
  })

  it('带软校验告警的工作流：标「（建议）」但仍可编辑（非阻断）', async () => {
    items = [{ id: 'b', name: { zh: '流程B' }, warnings: ['固化步骤前缺人工验收'] }]
    installKlarit()
    render(<WorkflowLibrary />)
    await screen.findByText('流程B')
    expect(screen.getByText('（建议）')).toBeInTheDocument()
    // 无隐患 severity 不禁用任何入口
    expect(screen.getByRole('button', { name: '编辑 流程B' })).toBeEnabled()
    // 告警不是硬无效标记
    expect(screen.queryByText('（无效）')).not.toBeInTheDocument()
  })

  it('无效工作流标（无效），编辑/克隆/删除入口仍可用', async () => {
    items = [{ id: 'b', name: { zh: '流程B' }, invalidReason: '建了分支却没有删分支' }]
    installKlarit()
    render(<WorkflowLibrary />)
    await screen.findByText('流程B')
    expect(screen.getByText('（无效）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑 流程B' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '克隆 流程B' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '删除 流程B' })).toBeEnabled()
  })
})
