import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentOnboardingDialog } from './AgentOnboardingDialog'
import type { DetectedAgent } from '@shared/types'

const AGENTS: DetectedAgent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    executablePath: 'C:\bin\claude.exe',
    models: [
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }
    ]
  },
  {
    id: 'codex',
    name: 'Codex',
    executablePath: 'C:\bin\codex.exe',
    models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }]
  }
]

describe('AgentOnboardingDialog', () => {
  it('agent 列表为空时不渲染任何内容', () => {
    const { container } = render(
      <AgentOnboardingDialog agents={[]} onConfirm={vi.fn()} onSkip={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('列出检测到的 agent 与首个 agent 的模型，默认选中首项', () => {
    render(<AgentOnboardingDialog agents={AGENTS} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    const agentSelect = screen.getByRole('combobox', { name: '默认 agent' })
    expect(agentSelect).toHaveValue('claude-code')
    expect(screen.getByRole('option', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument()
    const modelSelect = screen.getByRole('combobox', { name: '默认模型' })
    expect(modelSelect).toHaveValue('claude-opus-4-8')
  })

  it('切换 agent 后模型联动为新 agent 的模型', async () => {
    render(<AgentOnboardingDialog agents={AGENTS} onConfirm={vi.fn()} onSkip={vi.fn()} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '默认 agent' }), 'codex')
    const modelSelect = screen.getByRole('combobox', { name: '默认模型' })
    expect(modelSelect).toHaveValue('gpt-5-codex')
    expect(screen.getByRole('option', { name: 'GPT-5 Codex' })).toBeInTheDocument()
  })

  it('确认回调带所选 agent 与模型', async () => {
    const onConfirm = vi.fn()
    render(<AgentOnboardingDialog agents={AGENTS} onConfirm={onConfirm} onSkip={vi.fn()} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '默认模型' }), 'claude-sonnet-4-6')
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledWith('claude-code', 'claude-sonnet-4-6')
  })

  it('跳过回调不带任何选择', async () => {
    const onSkip = vi.fn()
    render(<AgentOnboardingDialog agents={AGENTS} onConfirm={vi.fn()} onSkip={onSkip} />)
    await userEvent.click(screen.getByRole('button', { name: '跳过' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
})
