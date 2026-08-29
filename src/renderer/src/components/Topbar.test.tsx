import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DecisionInboxEntry } from '@shared/decision-inbox'
import { Topbar } from './Topbar'
import { useDecisionInboxStore } from '../stores/decisionInbox'

const entry = (runId: string): DecisionInboxEntry => ({
  runId,
  cardId: `card-${runId}`,
  cardName: `卡 ${runId}`,
  source: 'impl:manual-gate',
  titleKey: 'engineDecision.manualReview',
  titleParams: { node: '实现' },
  pendingSince: Date.now(),
  gateKind: 'review'
})

beforeEach(() => {
  useDecisionInboxStore.setState({ entries: [], open: false })
})

function renderTopbar(over: Partial<React.ComponentProps<typeof Topbar>> = {}): void {
  render(<Topbar collapsed={false} onToggleSidebar={() => {}} hasProject={true} {...over} />)
}

describe('Topbar 侧边栏开关', () => {
  it('展开态显示「折叠侧边栏」按钮', () => {
    renderTopbar()
    expect(screen.getByRole('button', { name: '折叠侧边栏' })).toBeInTheDocument()
  })

  it('折叠态显示「展开侧边栏」按钮且 aria-pressed=true', () => {
    renderTopbar({ collapsed: true })
    const btn = screen.getByRole('button', { name: '展开侧边栏' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('点击触发切换回调', async () => {
    const onToggle = vi.fn()
    renderTopbar({ onToggleSidebar: onToggle })
    await userEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

describe('Topbar 决策收件箱入口', () => {
  it('有 2 个待决策 → 入口带计数徽标「2」', () => {
    useDecisionInboxStore.setState({ entries: [entry('r1'), entry('r2')] })
    renderTopbar()
    const btn = screen.getByRole('button', { name: /决策收件箱/ })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('2')
  })

  it('无待决策 → 入口存在但不显示徽标（不显示「0」）', () => {
    renderTopbar()
    const btn = screen.getByRole('button', { name: /决策收件箱/ })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toHaveTextContent('0')
  })

  it('点击展开收件箱并呈选中态，再次点击收起', async () => {
    useDecisionInboxStore.setState({ entries: [entry('r1')] })
    renderTopbar()
    const btn = screen.getByRole('button', { name: /决策收件箱/ })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(btn)
    expect(useDecisionInboxStore.getState().open).toBe(true)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: '等你拍板' })).toBeInTheDocument()
    await userEvent.click(btn)
    expect(useDecisionInboxStore.getState().open).toBe(false)
    expect(screen.queryByRole('dialog', { name: '等你拍板' })).not.toBeInTheDocument()
  })

  it('未绑定项目的窗口不渲染入口（无项目即无运行、无决策）', () => {
    useDecisionInboxStore.setState({ entries: [entry('r1')] })
    renderTopbar({ hasProject: false })
    expect(screen.queryByRole('button', { name: /决策收件箱/ })).not.toBeInTheDocument()
  })
})
