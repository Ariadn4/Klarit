import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'

beforeEach(() => {
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
    listWorkflows: vi.fn(async () => []),
    getActiveWorkflow: vi.fn(async () => null),
    getNotifyOnDecision: vi.fn(async () => true),
    setNotifyOnDecision: vi.fn(async (on: boolean) => on)
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
      defaultEffort={null}
      onChangeDefaultAgent={() => {}}
      onChangeDefaultModel={() => {}}
      onChangeDefaultEffort={() => {}}
      project={null}
      {...over}
    />
  )
}

const TWO_AGENTS = [
  {
    id: 'claude-code' as const,
    name: 'Claude Code',
    executablePath: 'C:\bin\claude.exe',
    models: [
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }
    ]
  },
  {
    id: 'codex' as const,
    name: 'Codex',
    executablePath: 'C:\bin\codex.exe',
    models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }]
  }
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

  it('通用→默认 agent/模型：检测到 agent 时列出、当前值选中、模型建议随 agent 联动', async () => {
    renderSettings({ detectedAgents: TWO_AGENTS, defaultAgent: 'claude-code', defaultModel: 'claude-opus-4-8' })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const agentSelect = screen.getByRole('combobox', { name: '默认 agent' })
    expect(agentSelect).toHaveValue('claude-code')
    expect(screen.getByRole('option', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument()
    // 模型为 combobox（可输可选）：当前值回显；聚焦弹出**完整**建议清单，不因已有值被过滤
    const modelInput = screen.getByRole('combobox', { name: '默认模型' })
    expect(modelInput).toHaveValue('claude-opus-4-8')
    await userEvent.click(modelInput)
    const listbox = screen.getByRole('listbox', { name: '默认模型' })
    const ids = within(listbox)
      .getAllByRole('option')
      .map((o) => o.getAttribute('data-model-id'))
    expect(ids).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6'])
  })

  it('通用→模型建议弹层点选条目即提交', async () => {
    const onChange = vi.fn()
    renderSettings({
      detectedAgents: TWO_AGENTS,
      defaultAgent: 'claude-code',
      defaultModel: 'claude-opus-4-8',
      onChangeDefaultModel: onChange
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.click(screen.getByRole('combobox', { name: '默认模型' }))
    await userEvent.click(screen.getByRole('option', { name: /claude-sonnet-4-6/ }))
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-4-6')
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

  it('通用→改默认模型（清单内值）失焦提交触发回调', async () => {
    const onChange = vi.fn()
    renderSettings({
      detectedAgents: TWO_AGENTS,
      defaultAgent: 'claude-code',
      defaultModel: 'claude-opus-4-8',
      onChangeDefaultModel: onChange
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const input = screen.getByRole('combobox', { name: '默认模型' })
    await userEvent.clear(input)
    await userEvent.type(input, 'claude-sonnet-4-6')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-4-6')
  })

  it('通用→手输建议清单外的模型 id 回车提交触发回调（不被拒绝）', async () => {
    const onChange = vi.fn()
    renderSettings({
      detectedAgents: TWO_AGENTS,
      defaultAgent: 'claude-code',
      defaultModel: 'claude-opus-4-8',
      onChangeDefaultModel: onChange
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const input = screen.getByRole('combobox', { name: '默认模型' })
    await userEvent.clear(input)
    await userEvent.type(input, 'claude-fable-6-preview{Enter}')
    expect(onChange).toHaveBeenCalledWith('claude-fable-6-preview')
  })

  it('通用→默认 effort：含 xhigh/max 全档与跟随默认、切换触发回调', async () => {
    const onChange = vi.fn()
    renderSettings({
      detectedAgents: TWO_AGENTS,
      defaultAgent: 'claude-code',
      defaultEffort: null,
      onChangeDefaultEffort: onChange
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const select = screen.getByRole('combobox', { name: /默认 effort/ })
    expect(select).toHaveValue('')
    expect(screen.getByRole('option', { name: /跟随 agent 默认/ })).toBeInTheDocument()
    // claude 完整档位可选（xhigh/max 不再被砍掉），档位显示 CLI 原文不翻译；含关键词档 ultracode
    expect(within(select).getByRole('option', { name: 'xhigh' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'ultracode' })).toBeInTheDocument()
    await userEvent.selectOptions(select, 'max')
    expect(onChange).toHaveBeenCalledWith('max')
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

  it('项目设置组含「文档」项，点选展示当前成员仓的登记表编辑器', async () => {
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
      listWorkflows: vi.fn(async () => []),
      getActiveWorkflow: vi.fn(async () => null),
      getNotifyOnDecision: vi.fn(async () => true),
      setNotifyOnDecision: vi.fn(async (on: boolean) => on),
      getDocuments: vi.fn(async () => ({
        memberId: 'm1',
        docs: [
          { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }
        ],
        conventionPreamble: '',
        conventionApproved: false
      })),
      scanDocuments: vi.fn(async () => null),
      saveDocuments: vi.fn(async () => undefined),
      redraftDocuments: vi.fn(async () => null)
    }
    renderSettings({
      project: {
        id: 'p1',
        displayName: 'proj',
        derivedName: 'proj',
        members: [
          {
            id: 'm1',
            idKind: 'uuid',
            derivedName: 'web',
            rootPath: '/repo/web',
            worktreePaths: ['/repo/web'],
            git: null,
            gitless: true
          }
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.click(screen.getByRole('button', { name: '文档' }))
    expect(await screen.findByRole('region', { name: '动态文档' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '快照文档' })).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('项目设置→文档：未绑定项目时显示空态、不报错', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.click(screen.getByRole('button', { name: '文档' }))
    expect(screen.getByText(/未绑定项目/)).toBeInTheDocument()
  })

  it('项目设置组含「巡检」项，点选展示巡检管理（默认零条 → 空态与新建入口）', async () => {
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
      listWorkflows: vi.fn(async () => []),
      getActiveWorkflow: vi.fn(async () => null),
      getNotifyOnDecision: vi.fn(async () => true),
      setNotifyOnDecision: vi.fn(async (on: boolean) => on),
      listPatrols: vi.fn(async () => [])
    }
    renderSettings({
      project: {
        id: 'p1',
        displayName: 'proj',
        derivedName: 'proj',
        members: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    })
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.click(screen.getByRole('button', { name: '巡检' }))
    expect(await screen.findByText(/还没有巡检/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建巡检' })).toBeInTheDocument()
  })

  it('项目设置→巡检：未绑定项目时显示空态、不报错', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    await userEvent.click(screen.getByRole('button', { name: '巡检' }))
    expect(screen.getByText(/未绑定项目/)).toBeInTheDocument()
  })
})

describe('通用设置里的决策通知开关', () => {
  it('默认按主进程读到的值呈开启态', async () => {
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const box = await screen.findByRole('checkbox', { name: '有新待决策时发桌面通知' })
    expect(box).toBeChecked()
  })

  it('关掉后经 IPC 持久化，且界面立即反映', async () => {
    const api = (globalThis as unknown as { window: { klarit: Record<string, ReturnType<typeof vi.fn>> } })
      .window.klarit
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const box = await screen.findByRole('checkbox', { name: '有新待决策时发桌面通知' })
    await userEvent.click(box)
    expect(api.setNotifyOnDecision).toHaveBeenCalledWith(false)
    expect(box).not.toBeChecked()
  })

  it('主进程读到关 → 呈关闭态', async () => {
    const api = (globalThis as unknown as { window: { klarit: Record<string, unknown> } }).window.klarit
    api.getNotifyOnDecision = vi.fn(async () => false)
    renderSettings()
    await userEvent.click(screen.getByRole('button', { name: /设置/ }))
    const box = await screen.findByRole('checkbox', { name: '有新待决策时发桌面通知' })
    await waitFor(() => expect(box).not.toBeChecked())
  })
})
