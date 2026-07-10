import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyButton } from './CopyButton'

function installKlarit(): { copyText: ReturnType<typeof vi.fn> } {
  const api = { copyText: vi.fn(async () => {}) }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api
}

beforeEach(() => {
  installKlarit()
})

describe('CopyButton', () => {
  it('有文本 → 渲染复制按钮；点击调 copyText(text) 并显示「已复制」', async () => {
    const api = installKlarit()
    render(<CopyButton text="hello world" />)
    const btn = screen.getByRole('button', { name: /复制/ })
    await userEvent.click(btn)
    expect(api.copyText).toHaveBeenCalledWith('hello world')
    await waitFor(() => expect(screen.getByRole('button', { name: /已复制/ })).toBeTruthy())
  })

  it('空文本 → 不渲染按钮', () => {
    const { container } = render(<CopyButton text="" />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('「已复制」反馈在计时后复原', async () => {
    vi.useFakeTimers()
    try {
      render(<CopyButton text="x" />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button'))
      })
      expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy()
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})
