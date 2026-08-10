import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DecisionInboxEntry } from '@shared/decision-inbox'
import { DecisionInbox } from './DecisionInbox'
import { useDecisionInboxStore } from '../stores/decisionInbox'
import { useCardsStore } from '../stores/cards'

const HOUR = 3_600_000

const entry = (over: Partial<DecisionInboxEntry> = {}): DecisionInboxEntry => ({
  runId: 'r1',
  cardId: 'add-login',
  cardName: '加登录',
  source: 'impl:manual-gate',
  titleKey: 'engineDecision.manualReview',
  titleParams: { node: '实现' },
  pendingSince: Date.now() - 2 * HOUR,
  gateKind: 'review',
  ...over
})

function open(entries: DecisionInboxEntry[]): void {
  useDecisionInboxStore.setState({ entries, open: true })
}

beforeEach(() => {
  useDecisionInboxStore.setState({ entries: [], open: false })
  useCardsStore.setState({ detailSlug: null, detailFocus: null })
})

describe('DecisionInbox 面板', () => {
  it('未展开时不渲染任何面板', () => {
    useDecisionInboxStore.setState({ entries: [entry()], open: false })
    const { container } = render(<DecisionInbox />)
    expect(container).toBeEmptyDOMElement()
  })

  it('按传入顺序渲染条目：卡名、类型标识、翻译后的决策标题、已等待时长', () => {
    open([
      entry({ runId: 'r1', cardId: 'a', cardName: '加登录', pendingSince: Date.now() - 2 * HOUR }),
      entry({
        runId: 'r2',
        cardId: 'b',
        cardName: '修 bug',
        source: 'build:command-failed',
        gateKind: 'failure',
        titleKey: 'engineDecision.commandFailed',
        titleParams: { command: 'npm test' },
        pendingSince: Date.now() - 5 * 60_000
      })
    ])
    render(<DecisionInbox />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)

    expect(within(items[0]).getByText('加登录')).toBeInTheDocument()
    expect(within(items[0]).getByText('等你验收')).toBeInTheDocument()
    expect(within(items[0]).getByText(/实现/)).toBeInTheDocument()
    expect(within(items[0]).getByText('已等 2 小时')).toBeInTheDocument()

    expect(within(items[1]).getByText('修 bug')).toBeInTheDocument()
    expect(within(items[1]).getByText('要你决定')).toBeInTheDocument()
    expect(within(items[1]).getByText(/npm test/)).toBeInTheDocument()
    expect(within(items[1]).getByText('已等 5 分钟')).toBeInTheDocument()
  })

  it('无条目时给空态提示，而非空白面板', () => {
    useDecisionInboxStore.setState({ entries: [], open: true })
    render(<DecisionInbox />)
    expect(screen.getByText('没有等你拍板的事')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('条目上不存在回应决策的选项/填空/动作按钮（回应只在卡详情的决策面板）', () => {
    open([
      entry({
        titleKey: 'engineDecision.manualReview',
        source: 'impl:manual-gate'
      })
    ])
    render(<DecisionInbox />)
    const panel = screen.getByRole('dialog')
    // 无填空、无单/多选
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument()
    // 面板里可点的东西**只有**每条条目自身（跳转），没有任何额外的选项/动作按钮
    expect(within(panel).getAllByRole('button')).toHaveLength(1)
    expect(within(panel).getByRole('button')).toBe(
      within(screen.getByRole('listitem')).getByRole('button')
    )
  })

  it('点条目 → 打开对应卡详情并聚焦决策面板，同时收起收件箱', async () => {
    open([entry({ cardId: 'add-login', cardName: '加登录' })])
    render(<DecisionInbox />)
    await userEvent.click(screen.getByRole('button', { name: /加登录/ }))
    expect(useCardsStore.getState().detailSlug).toBe('add-login')
    expect(useCardsStore.getState().detailFocus).toBe('decision')
    expect(useDecisionInboxStore.getState().open).toBe(false)
  })

  it('点面板外收起', async () => {
    open([entry()])
    render(<DecisionInbox />)
    await userEvent.click(screen.getByTestId('decision-inbox-scrim'))
    expect(useDecisionInboxStore.getState().open).toBe(false)
  })

  it('按 Esc 收起', async () => {
    open([entry()])
    render(<DecisionInbox />)
    await userEvent.keyboard('{Escape}')
    expect(useDecisionInboxStore.getState().open).toBe(false)
  })

  it('英文界面下文案随语言翻译', async () => {
    const i18n = (await import('../i18n')).default
    await i18n.changeLanguage('en')
    open([entry({ pendingSince: Date.now() - 2 * HOUR })])
    render(<DecisionInbox />)
    expect(screen.getByText('Waiting for review')).toBeInTheDocument()
    expect(screen.getByText('Waiting 2h')).toBeInTheDocument()
  })
})

describe('DecisionInbox 只导航不回应', () => {
  it('面板不含任何提交决策的 IPC 调用入口（不调 decideRun）', async () => {
    const decideRun = vi.fn()
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = { decideRun }
    open([entry()])
    render(<DecisionInbox />)
    await userEvent.click(screen.getByRole('button', { name: /加登录/ }))
    expect(decideRun).not.toHaveBeenCalled()
  })
})
