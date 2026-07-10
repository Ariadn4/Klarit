import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CandidateCard } from '@shared/types'
import { CreateRequirementEntry } from './CreateRequirementEntry'
import { useNewRequirementStore } from '../stores/newRequirement'

const card = (over: Partial<CandidateCard> = {}): CandidateCard => ({
  proposedName: 'add-dark-mode',
  title: 't',
  description: 'd',
  typeId: 'feature',
  relations: [],
  ...over
})

function reset(state: Partial<ReturnType<typeof useNewRequirementStore.getState>> = {}): void {
  useNewRequirementStore.setState({
    phase: 'idle',
    windowOpen: false,
    description: '',
    reviewCards: [],
    issues: [],
    notice: null,
    ...state
  })
}

beforeEach(() => reset())

describe('CreateRequirementEntry 承载新建需求全程状态', () => {
  it('idle → 「+ 创建」，点击经 openEntry 开描述窗', async () => {
    const getDecomposePrompt = vi.fn(async () => ({ prompt: 'P' }))
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = { getDecomposePrompt }
    render(<CreateRequirementEntry />)
    const btn = screen.getByRole('button', { name: '新建需求' })
    expect(btn).toHaveTextContent('创建')
    await userEvent.click(btn)
    expect(getDecomposePrompt).toHaveBeenCalledTimes(1)
  })

  it('processing → 转圈「建卡中」，点击重开浮窗、不发起第二次分解', async () => {
    const decomposeRequirement = vi.fn()
    ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
      decomposeRequirement,
      getDecomposePrompt: vi.fn()
    }
    reset({ phase: 'processing', windowOpen: false })
    render(<CreateRequirementEntry />)
    const btn = screen.getByRole('button', { name: '建卡中' })
    expect(btn).toBeInTheDocument()
    // 处理中图标转圈
    expect(btn.querySelector('.animate-spin')).toBeTruthy()
    await userEvent.click(btn)
    expect(useNewRequirementStore.getState().windowOpen).toBe(true)
    expect(decomposeRequirement).not.toHaveBeenCalled()
  })

  it('reviewing 且收起 → 「N 张候选待审阅」，点击重开审阅窗', async () => {
    reset({ phase: 'reviewing', windowOpen: false, reviewCards: [card(), card({ proposedName: 'b' })] })
    render(<CreateRequirementEntry />)
    const btn = screen.getByRole('button', { name: /待审阅/ })
    expect(btn).toHaveTextContent('2')
    await userEvent.click(btn)
    expect(useNewRequirementStore.getState().windowOpen).toBe(true)
  })

  it('describing 且收起 → 「编辑中」', () => {
    reset({ phase: 'describing', windowOpen: false })
    render(<CreateRequirementEntry />)
    expect(screen.getByRole('button', { name: '编辑中' })).toBeInTheDocument()
  })

  it('浮窗开着的 describing/reviewing → 按钮回落「+ 创建」外观', () => {
    reset({ phase: 'reviewing', windowOpen: true, reviewCards: [card()] })
    render(<CreateRequirementEntry />)
    expect(screen.getByRole('button', { name: '新建需求' })).toHaveTextContent('创建')
  })
})
