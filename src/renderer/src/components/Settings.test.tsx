import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'

beforeEach(() => {
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
    listWorkflows: vi.fn(async () => []),
    getActiveWorkflow: vi.fn(async () => null)
  }
})

function renderSettings(over: Partial<React.ComponentProps<typeof Settings>> = {}): void {
  render(
    <Settings
      language="zh"
      onChangeLanguage={() => {}}
      appearance="system"
      onChangeAppearance={() => {}}
      detectedAgents={[]}
      defaultAgent={null}
      defaultModel={null}
      onChangeDefaultAgent={() => {}}
      onChangeDefaultModel={() => {}}
      project={null}
      {...over}
    />
  )
}

const TWO_AGENTS = [
  {
    id: 'claude-code' as const,
    name: 'Claude Code',
    models: [
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }
    ]
  },
  { id: 'codex' as const, name: 'Codex', models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }] }
]

describe('Settings 设置入口', () => {
  it('默认仅显示齿轮按钮，面板未打开', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('点击齿轮打开设置面板，左侧含应用设置与项目设置分组', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByText('应用设置')).toBeInTheDocument()
    expect(screen.getByText('项目设置')).toBeInTheDocument()
    // 默认进入「通用」，语言为下拉
    expect(screen.getByRole('combobox', { name: '语言' })).toBeInTheDocument()
  })

  it('右侧内容区顶部不再渲染「设置」标题（仅 dialog 可访问名与关闭按钮）', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(screen.queryByRole('heading', { name: '设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭设置' })).toBeInTheDocument()
  })

  it('语言为下拉：当前语言选中、可切换触发回调', async () => {
    const onChange = vi.fn()
    renderSettings({ onChangeLanguage: onChange })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const select = screen.getByRole('combobox', { name: '语言' })
    expect(select).toHaveValue('zh')
    await userEvent.selectOptions(select, 'en')
    expect(onChange).toHaveBeenCalledWith('en')
  })

  it('外观为下拉：三选项、默认跟随系统、可切换触发回调', async () => {
    const onChange = vi.fn()
    renderSettings({ appearance: 'system', onChangeAppearance: onChange })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const select = screen.getByRole('combobox', { name: '外观' })
    expect(select).toHaveValue('system')
    // 三个可选项
    expect(screen.getByRole('option', { name: '深色' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '浅色' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '跟随系统' })).toBeInTheDocument()
    await userEvent.selectOptions(select, 'dark')
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('通用→默认 agent/模型：检测到 agent 时列出、当前值选中、模型随 agent 联动', async () => {
    renderSettings({ detectedAgents: TWO_AGENTS, defaultAgent: 'claude-code', defaultModel: 'claude-opus-4-8' })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const agentSelect = screen.getByRole('combobox', { name: '默认 agent' })
    expect(agentSelect).toHaveValue('claude-code')
    expect(screen.getByRole('option', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument()
    const modelSelect = screen.getByRole('combobox', { name: '默认模型' })
    expect(modelSelect).toHaveValue('claude-opus-4-8')
    // 模型清单为当前 agent（claude-code）的两个模型
    expect(screen.getByRole('option', { name: 'Opus 4.8' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sonnet 4.6' })).toBeInTheDocument()
  })

  it('通用→切换默认 agent 触发回调', async () => {
    const onChange = vi.fn()
    renderSettings({
      detectedAgents: TWO_AGENTS,
      defaultAgent: 'claude-code',
      defaultModel: 'claude-opus-4-8',
      onChangeDefaultAgent: onChange
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '默认 agent' }), 'codex')
    expect(onChange).toHaveBeenCalledWith('codex')
  })

  it('通用→切换默认模型触发回调', async () => {
    const onChange = vi.fn()
    renderSettings({
      detectedAgents: TWO_AGENTS,
      defaultAgent: 'claude-code',
      defaultModel: 'claude-opus-4-8',
      onChangeDefaultModel: onChange
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '默认模型' }), 'claude-sonnet-4-6')
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-4-6')
  })

  it('通用→未检测到 agent 时显示空态、不渲染下拉、不报错', async () => {
    renderSettings({ detectedAgents: [] })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(screen.queryByRole('combobox', { name: '默认 agent' })).not.toBeInTheDocument()
    expect(screen.getByText(/未检测到本机安装的 agent/)).toBeInTheDocument()
  })

  it('项目设置→工作流：未绑定项目时显示空态、不报错', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    // 第二个「工作流」导航项属于项目设置组
    const workflowNavs = screen.getAllByRole('button', { name: '工作流' })
    await userEvent.click(workflowNavs[workflowNavs.length - 1])
    expect(screen.getByText(/未绑定项目/)).toBeInTheDocument()
  })

  it('点击关闭按钮关闭面板', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.click(screen.getByRole('button', { name: '关闭设置' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
