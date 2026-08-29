import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Patrol } from '@shared/patrol'
import { PatrolSettings } from './PatrolSettings'

const docScan = (over: Partial<Patrol> = {}): Patrol => ({
  id: 'pt-doc',
  name: '每天扫文档',
  trigger: { kind: 'daily', time: '03:00' },
  action: { kind: 'docScan' },
  enabled: true,
  ...over
})

const lint = (over: Partial<Patrol> = {}): Patrol => ({
  id: 'pt-lint',
  name: '周一跑 lint',
  trigger: { kind: 'weekly', weekday: 1, time: '09:00' },
  action: { kind: 'command', command: 'npm run lint' },
  enabled: false,
  ...over
})

function install(patrols: Patrol[], over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listPatrols: vi.fn(async () => patrols),
    savePatrol: vi.fn(async () => patrols),
    removePatrol: vi.fn(async () => []),
    setPatrolEnabled: vi.fn(async () => patrols),
    listWorkflows: vi.fn(async () => [{ id: 'wf-1', name: '夜间自检' }]),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api as Record<string, ReturnType<typeof vi.fn>>
}

beforeEach(() => {
  install([])
})

describe('PatrolSettings · 列表', () => {
  it('列出每条巡检的名字、触发人话描述、动作与开关', async () => {
    install([docScan(), lint()])
    render(<PatrolSettings />)
    expect(await screen.findByText('每天扫文档')).toBeInTheDocument()
    expect(screen.getByText('每天 03:00')).toBeInTheDocument()
    expect(screen.getByText('文档腐烂扫描')).toBeInTheDocument()
    expect(screen.getByText('周一跑 lint')).toBeInTheDocument()
    expect(screen.getByText('每周周一 09:00')).toBeInTheDocument()
    expect(screen.getByText(/npm run lint/)).toBeInTheDocument()
  })

  it('停用那条：开关为关且有明确的停用视觉', async () => {
    install([docScan(), lint()])
    render(<PatrolSettings />)
    await screen.findByText('每天扫文档')
    expect(screen.getByRole('checkbox', { name: '启用巡检 每天扫文档' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '启用巡检 周一跑 lint' })).not.toBeChecked()
    expect(screen.getByText('已停用')).toBeInTheDocument()
  })

  it('展示上次运行时刻；从未跑过给「从未运行」', async () => {
    const at = new Date(2026, 7, 9, 3, 0).getTime()
    install([docScan({ lastRunAt: at }), lint()])
    render(<PatrolSettings />)
    await screen.findByText('每天扫文档')
    expect(screen.getByText(new Date(at).toLocaleString())).toBeInTheDocument()
    expect(screen.getByText('从未运行')).toBeInTheDocument()
  })

  it('空态：给说明与新建入口，而非空白面板', async () => {
    install([])
    render(<PatrolSettings />)
    expect(await screen.findByText(/还没有巡检/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建巡检' })).toBeInTheDocument()
  })

  it('启停走 setPatrolEnabled（停用不删除）', async () => {
    const api = install([docScan()])
    render(<PatrolSettings />)
    await screen.findByText('每天扫文档')
    await userEvent.click(screen.getByRole('checkbox', { name: '启用巡检 每天扫文档' }))
    await waitFor(() => expect(api.setPatrolEnabled).toHaveBeenCalledWith('pt-doc', false))
    expect(api.removePatrol).not.toHaveBeenCalled()
  })

  it('删除走 removePatrol', async () => {
    const api = install([docScan()])
    render(<PatrolSettings />)
    await screen.findByText('每天扫文档')
    await userEvent.click(screen.getByRole('button', { name: '删除巡检 每天扫文档' }))
    await waitFor(() => expect(api.removePatrol).toHaveBeenCalledWith('pt-doc'))
  })
})

describe('PatrolSettings · 触发编辑（下拉 + 时刻选择器，绝不出现表达式输入框）', () => {
  it('展开编辑：触发是三选下拉，不出现任何表达式/cron 输入框', async () => {
    install([docScan()])
    render(<PatrolSettings />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑巡检 每天扫文档' }))
    const kind = screen.getByRole('combobox', { name: '触发' })
    expect(within(kind).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '每 n 小时',
      '每天',
      '每周'
    ])
    // 时刻用 time 选择器，不是自由文本
    expect(screen.getByLabelText('时刻')).toHaveAttribute('type', 'time')
    // 断言无表达式输入框
    expect(screen.queryByLabelText(/表达式/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/cron/i)
    for (const input of Array.from(document.querySelectorAll('input'))) {
      expect(input.getAttribute('placeholder') ?? '').not.toMatch(/\*/)
    }
  })

  it('切到「每 n 小时」→ 给小时数选择器、不给时刻；切到「每周」→ 多一个周几下拉', async () => {
    install([docScan()])
    render(<PatrolSettings />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑巡检 每天扫文档' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '触发' }), 'everyHours')
    expect(screen.getByRole('combobox', { name: '每几小时' })).toBeInTheDocument()
    expect(screen.queryByLabelText('时刻')).toBeNull()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '触发' }), 'weekly')
    expect(screen.getByRole('combobox', { name: '周几' })).toBeInTheDocument()
    expect(screen.getByLabelText('时刻')).toHaveAttribute('type', 'time')
  })

  it('动作三选一：工作流给工作流下拉、命令给命令输入、文档扫描无额外字段', async () => {
    install([docScan()])
    render(<PatrolSettings />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑巡检 每天扫文档' }))
    const action = screen.getByRole('combobox', { name: '动作' })
    expect(within(action).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '跑工作流',
      '跑命令',
      '文档腐烂扫描'
    ])
    await userEvent.selectOptions(action, 'workflow')
    expect(await screen.findByRole('combobox', { name: '工作流' })).toBeInTheDocument()
    await userEvent.selectOptions(action, 'command')
    expect(screen.getByLabelText('命令')).toBeInTheDocument()
  })

  it('新建一条并保存 → 经 savePatrol 落库（默认启用）', async () => {
    const api = install([])
    render(<PatrolSettings />)
    await userEvent.click(await screen.findByRole('button', { name: '新建巡检' }))
    await userEvent.type(screen.getByLabelText('名字'), '夜间文档巡检')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(api.savePatrol).toHaveBeenCalledTimes(1))
    const saved = api.savePatrol.mock.calls[0][0] as Patrol
    expect(saved).toMatchObject({
      name: '夜间文档巡检',
      enabled: true,
      action: { kind: 'docScan' }
    })
    expect(saved.id).toBeTruthy()
  })

  it('编辑既有巡检保存 → 沿用原 id 与 lastRunAt（不因编辑丢掉记时）', async () => {
    const api = install([docScan({ lastRunAt: 1700 })])
    render(<PatrolSettings />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑巡检 每天扫文档' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '触发' }), 'everyHours')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '每几小时' }), '6')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(api.savePatrol).toHaveBeenCalledTimes(1))
    expect(api.savePatrol.mock.calls[0][0]).toMatchObject({
      id: 'pt-doc',
      lastRunAt: 1700,
      trigger: { kind: 'everyHours', hours: 6 }
    })
  })
})
