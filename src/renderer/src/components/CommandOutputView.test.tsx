import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommandOutputView } from './CommandOutputView'
import { useCardsStore } from '../stores/cards'

function installKlarit(): { copyText: ReturnType<typeof vi.fn>; readRunOutput: ReturnType<typeof vi.fn> } {
  const api = { copyText: vi.fn(async () => {}), readRunOutput: vi.fn(async () => '') }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api
}

beforeEach(() => {
  installKlarit()
  useCardsStore.setState({ outputs: {} })
})

describe('CommandOutputView — 可选中 + 一键复制', () => {
  it('有内容 → 渲染复制按钮，且输出 <pre> 可选中（select-text）', () => {
    useCardsStore.getState().seedOutput('r1', 'node:n1', 'line A\nline B')
    const { container } = render(<CommandOutputView runId="r1" bucket="node:n1" />)
    expect(screen.getByText(/line A/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /复制/ })).toBeTruthy()
    const pre = container.querySelector('pre')
    expect(pre?.className).toContain('select-text')
  })

  it('空输出 → 不渲染复制按钮（无内容可复制）', () => {
    render(<CommandOutputView runId="r2" bucket="node:empty" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
