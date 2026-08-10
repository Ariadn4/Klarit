import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandOutputView } from './CommandOutputView'
import { useCardsStore, outputKey } from '../stores/cards'

function installKlarit(readRunOutput = vi.fn(async () => '')): {
  copyText: ReturnType<typeof vi.fn>
  readRunOutput: ReturnType<typeof vi.fn>
} {
  const api = { copyText: vi.fn(async () => {}), readRunOutput }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api
}

beforeEach(() => {
  installKlarit()
  useCardsStore.setState({ outputs: {}, outputTruncated: {} })
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

/**
 * 常驻窗口有界，超出的历史不在内存里——想回看就走既有的「从引擎缓冲读该桶」路径把更早的部分取回来。
 */
describe('CommandOutputView — 超出常驻窗口的历史可回看', () => {
  it('该桶被截断过 → 给出回看入口，点了从引擎缓冲取回更早内容并与实时尾部拼上', async () => {
    const api = installKlarit(vi.fn(async () => '很早的开头\n最近的尾巴\n'))
    useCardsStore.setState({
      outputs: { [outputKey('r1', 'node:n1')]: '最近的尾巴\n' },
      outputTruncated: { [outputKey('r1', 'node:n1')]: true }
    })
    render(<CommandOutputView runId="r1" bucket="node:n1" />)
    expect(screen.queryByText(/很早的开头/)).toBeNull() // 常驻里没有

    await userEvent.click(screen.getByRole('button', { name: /更早/ }))
    await waitFor(() => expect(screen.getByText(/很早的开头/)).toBeTruthy())
    expect(api.readRunOutput).toHaveBeenCalledWith('r1', 'node:n1')
    expect(screen.getByText(/最近的尾巴/)).toBeTruthy() // 尾部照旧在，不重复
  })

  it('回看载入后实时输出继续追加，尾部跟着长', async () => {
    installKlarit(vi.fn(async () => '很早的开头\n当时的尾巴\n'))
    useCardsStore.setState({
      outputs: { [outputKey('r1', 'node:n1')]: '当时的尾巴\n' },
      outputTruncated: { [outputKey('r1', 'node:n1')]: true }
    })
    render(<CommandOutputView runId="r1" bucket="node:n1" />)
    await userEvent.click(screen.getByRole('button', { name: /更早/ }))
    await waitFor(() => expect(screen.getByText(/很早的开头/)).toBeTruthy())

    useCardsStore.getState().appendOutput('r1', 'node:n1', '新来的一行\n')
    await waitFor(() => expect(screen.getByText(/新来的一行/)).toBeTruthy())
    expect(screen.getByText(/很早的开头/)).toBeTruthy()
  })

  it('没被截断过 → 不出现回看入口（常驻的就是全部）', () => {
    useCardsStore.getState().seedOutput('r1', 'node:n1', '短短输出\n')
    render(<CommandOutputView runId="r1" bucket="node:n1" />)
    expect(screen.queryByRole('button', { name: /更早/ })).toBeNull()
  })
})
