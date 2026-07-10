import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReadFileResult } from '@shared/types'
import { FileViewer } from './FileViewer'
import { useFileViewerStore } from '../stores/fileViewer'

beforeEach(() => {
  useFileViewerStore.setState({ tabs: [], activePath: null, popupOpen: false })
})

/** 以文本内容为键的假 readFile：默认返回 text。 */
function fakeReadFile(map: Record<string, ReadFileResult> = {}): (p: string) => Promise<ReadFileResult> {
  return vi.fn(async (p: string) => map[p] ?? { kind: 'text', content: `内容:${p}` })
}

const renderText = (value: string): React.JSX.Element => <pre data-testid="text">{value}</pre>

function setup(readFile = fakeReadFile()): void {
  render(<FileViewer readFile={readFile} renderText={renderText} />)
}

describe('FileViewer', () => {
  it('无打开文件时只剩常驻底栏，不渲染蒙层与入口', () => {
    render(<FileViewer readFile={fakeReadFile()} renderText={renderText} />)
    // 底栏始终存在（任务栏），但无蒙层、无标签、无展开入口。
    expect(screen.queryByTestId('viewer-scrim')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /文件查看器/ })).not.toBeInTheDocument()
  })

  it('打开多个文件渲染多个标签，展示激活文件内容', async () => {
    setup()
    useFileViewerStore.getState().open('/p/a.ts')
    useFileViewerStore.getState().open('/p/b.ts')
    expect(await screen.findByRole('tab', { name: /a\.ts/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /b\.ts/ })).toBeInTheDocument()
    expect(await screen.findByTestId('text')).toHaveTextContent('内容:/p/b.ts')
  })

  it('点标签切换内容', async () => {
    setup()
    useFileViewerStore.getState().open('/p/a.ts')
    useFileViewerStore.getState().open('/p/b.ts')
    await screen.findByTestId('text')
    await userEvent.click(screen.getByRole('tab', { name: /a\.ts/ }))
    await waitFor(() => expect(screen.getByTestId('text')).toHaveTextContent('内容:/p/a.ts'))
  })

  it('关闭单个标签移除它、保留其余', async () => {
    setup()
    useFileViewerStore.getState().open('/p/a.ts')
    useFileViewerStore.getState().open('/p/b.ts')
    await screen.findByRole('tab', { name: /a\.ts/ })
    await userEvent.click(screen.getByRole('button', { name: '关闭 a.ts' }))
    expect(screen.queryByRole('tab', { name: /a\.ts/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /b\.ts/ })).toBeInTheDocument()
  })

  it('关闭最后一个标签：浮层与入口消失（底栏仍在）', async () => {
    setup()
    useFileViewerStore.getState().open('/p/a.ts')
    await screen.findByRole('tab', { name: /a\.ts/ })
    await userEvent.click(screen.getByRole('button', { name: '关闭 a.ts' }))
    await waitFor(() => expect(screen.queryByTestId('viewer-scrim')).not.toBeInTheDocument())
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /文件查看器/ })).not.toBeInTheDocument()
  })

  it('点蒙层空白处收起浮层（底栏入口保留）', async () => {
    setup()
    useFileViewerStore.getState().open('/p/a.ts')
    await screen.findByRole('tab', { name: /a\.ts/ })
    await userEvent.click(screen.getByTestId('viewer-scrim'))
    expect(screen.queryByRole('tab', { name: /a\.ts/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开文件查看器' })).toBeInTheDocument() // 底栏入口
  })

  it('点底栏入口在收起/展开间切换', async () => {
    setup()
    useFileViewerStore.getState().open('/p/a.ts')
    await screen.findByRole('tab', { name: /a\.ts/ })
    // 展开态下底栏入口为「收起」，点它收起浮层。
    await userEvent.click(screen.getByRole('button', { name: '收起文件查看器' }))
    expect(screen.queryByRole('tab', { name: /a\.ts/ })).not.toBeInTheDocument()
    // 收起态下底栏入口变「展开」，点它重新展开。
    await userEvent.click(await screen.findByRole('button', { name: '展开文件查看器' }))
    expect(await screen.findByRole('tab', { name: /a\.ts/ })).toBeInTheDocument()
  })

  it('整体关闭清空所有标签（底栏仍在、入口消失）', async () => {
    setup()
    useFileViewerStore.getState().open('/p/a.ts')
    useFileViewerStore.getState().open('/p/b.ts')
    await screen.findByRole('tab', { name: /a\.ts/ })
    await userEvent.click(screen.getByRole('button', { name: '关闭查看器' }))
    await waitFor(() => expect(screen.queryByTestId('viewer-scrim')).not.toBeInTheDocument())
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /文件查看器/ })).not.toBeInTheDocument()
  })

  it('二进制文件显示降级占位', async () => {
    setup(fakeReadFile({ '/p/x.png': { kind: 'binary' } }))
    useFileViewerStore.getState().open('/p/x.png')
    expect(await screen.findByText(/无法以文本预览/)).toBeInTheDocument()
  })

  it('超大文件显示降级占位', async () => {
    setup(fakeReadFile({ '/p/big.log': { kind: 'too-large', size: 9_000_000 } }))
    useFileViewerStore.getState().open('/p/big.log')
    expect(await screen.findByText(/文件过大/)).toBeInTheDocument()
  })

  it('读取失败显示错误占位', async () => {
    setup(fakeReadFile({ '/p/gone.txt': { kind: 'error', message: 'ENOENT' } }))
    useFileViewerStore.getState().open('/p/gone.txt')
    expect(await screen.findByText(/ENOENT/)).toBeInTheDocument()
  })
})
