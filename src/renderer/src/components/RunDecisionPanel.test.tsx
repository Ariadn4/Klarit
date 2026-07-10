import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EngineDecision } from '@shared/types'
import { RunDecisionPanel } from './RunDecisionPanel'

/** 最小人工评审决策(两个动作按钮 + 通过选项 + 自由输入)。 */
function decision(over: Partial<EngineDecision> = {}): EngineDecision {
  return {
    source: 'n1:manual-gate',
    sourceKind: 'engine',
    titleKey: 'engineDecision.manualReview',
    options: [{ id: 'pass', labelKey: 'engineDecision.optPass', recommended: true }],
    input: { labelKey: 'engineDecision.rejectReason' },
    actions: [
      { label: '启动后端', index: 0 },
      { label: '启动前端', index: 1 }
    ],
    ...over
  } as unknown as EngineDecision
}

function renderPanel(d: EngineDecision, onDecide = vi.fn()): { onDecide: ReturnType<typeof vi.fn> } {
  render(
    <RunDecisionPanel
      decision={d}
      onDecide={onDecide}
      onAction={vi.fn()}
      onStopActionProc={vi.fn()}
      runningActionBg={() => null}
    />
  )
  return { onDecide }
}

describe('RunDecisionPanel 统一「选中 + 提交」交互', () => {
  it('选项不即点即生效：点选项后需再点「提交」才回调 onDecide(optionId)', async () => {
    const { onDecide } = renderPanel(decision())
    await userEvent.click(screen.getByRole('button', { name: /通过/ }))
    expect(onDecide).not.toHaveBeenCalled() // 选中不触发
    await userEvent.click(screen.getByRole('button', { name: /提交/ }))
    expect(onDecide).toHaveBeenCalledWith({ optionId: 'pass' })
  })

  it('只写自由输入、不选选项 → 提交回调 { text }', async () => {
    const { onDecide } = renderPanel(decision())
    await userEvent.type(screen.getByLabelText(/驳回原因|reject/i), '体验不对')
    await userEvent.click(screen.getByRole('button', { name: /提交/ }))
    expect(onDecide).toHaveBeenCalledWith({ text: '体验不对' })
  })

  it('未选未写 → 提交禁用', () => {
    renderPanel(decision())
    expect(screen.getByRole('button', { name: /提交/ })).toBeDisabled()
  })

  it('选项详情常显在选项下方（不藏悬浮）', () => {
    renderPanel(
      decision({
        input: undefined,
        actions: undefined,
        options: [
          { id: 'arch', label: '写方案', detail: '数据模型最早在此定型', recommended: true },
          { id: 'impl', label: '实现', detail: '只是忠实落地' }
        ]
      })
    )
    // detail 文本作为可见内容渲染出来（而非 title 悬浮）
    expect(screen.getByText('数据模型最早在此定型')).toBeTruthy()
    expect(screen.getByText('只是忠实落地')).toBeTruthy()
  })

  it('只有一个选项时不显示「推荐」标；多选项时才在推荐项上显示', () => {
    const { unmount } = render(
      <RunDecisionPanel decision={decision()} onDecide={vi.fn()} onAction={vi.fn()} onStopActionProc={vi.fn()} runningActionBg={() => null} />
    )
    // 单个「通过」（recommended）→ 无「推荐」标
    expect(screen.queryByText('推荐')).toBeNull()
    unmount()
    // 两个选项、其一 recommended → 显示「推荐」
    renderPanel(
      decision({
        input: undefined,
        actions: undefined,
        options: [
          { id: 'a', label: '拉取变基后重推', recommended: true },
          { id: 'b', label: '强推覆盖远端' }
        ]
      })
    )
    expect(screen.getByText('推荐')).toBeTruthy()
  })

  it('提交后进入「处理中」态：按钮变「处理中…」并禁用，不清空面板死等', async () => {
    let resolveFn: () => void = () => {}
    const onDecide = vi.fn(() => new Promise<void>((r) => { resolveFn = r }))
    renderPanel(decision({ actions: undefined }), onDecide)
    await userEvent.click(screen.getByRole('button', { name: /通过/ }))
    await userEvent.click(screen.getByRole('button', { name: /提交/ }))
    expect(onDecide).toHaveBeenCalledWith({ optionId: 'pass' })
    // 异步兑现前：提交按钮显示「处理中…」且禁用（不是空白可点的死态）
    const btn = screen.getByRole('button', { name: /处理中/ })
    expect(btn).toBeDisabled()
    resolveFn()
  })

  it('多选决策 → 提交回调 { optionIds }', async () => {
    const d = decision({
      multi: true,
      input: undefined,
      actions: undefined,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' }
      ]
    })
    const { onDecide } = renderPanel(d)
    await userEvent.click(screen.getByRole('button', { name: /A/ }))
    await userEvent.click(screen.getByRole('button', { name: /C/ }))
    await userEvent.click(screen.getByRole('button', { name: /提交/ }))
    expect(onDecide).toHaveBeenCalledWith({ optionIds: ['a', 'c'] })
  })
})

describe('RunDecisionPanel 动作按钮启动↔中止切换（旁路命令，与提交正交）', () => {
  it('无活进程时显示「启动」,点击触发 onAction', async () => {
    const onAction = vi.fn()
    render(
      <RunDecisionPanel
        decision={decision()}
        onDecide={vi.fn()}
        onAction={onAction}
        onStopActionProc={vi.fn()}
        runningActionBg={() => null}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /启动后端/ }))
    expect(onAction).toHaveBeenCalledWith(0)
  })

  it('某动作有活进程时其按钮变「中止」,点击按 bgId 停该进程、不影响另一个仍是「启动」', async () => {
    const onAction = vi.fn()
    const onStop = vi.fn()
    render(
      <RunDecisionPanel
        decision={decision()}
        onDecide={vi.fn()}
        onAction={onAction}
        onStopActionProc={onStop}
        runningActionBg={(label) => (label === '启动后端' ? 'bg-1' : null)}
      />
    )
    const stopBtn = screen.getByRole('button', { name: /中止.*启动后端|启动后端/ })
    expect(stopBtn.textContent).toContain('中止')
    await userEvent.click(stopBtn)
    expect(onStop).toHaveBeenCalledWith('bg-1')
    expect(onAction).not.toHaveBeenCalled()
    const frontBtn = screen.getByRole('button', { name: /启动前端/ })
    await userEvent.click(frontBtn)
    expect(onAction).toHaveBeenCalledWith(1)
  })
})
