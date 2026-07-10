import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FileNode } from '@shared/types'
import { FileTree } from './FileTree'

const dir = (name: string, path: string): FileNode => ({ name, path, kind: 'directory' })
const file = (name: string, path: string): FileNode => ({ name, path, kind: 'file' })

describe('FileTree', () => {
  it('展示根目录顶层项', async () => {
    const listDir = vi.fn(async () => [dir('src', '/p/src'), file('README.md', '/p/README.md')])
    render(<FileTree rootPath="/p" listDir={listDir} />)
    expect(await screen.findByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('展开文件夹列出其子项', async () => {
    const listDir = vi.fn(async (p: string) => {
      if (p === '/p') return [dir('src', '/p/src')]
      if (p === '/p/src') return [file('index.ts', '/p/src/index.ts')]
      return []
    })
    render(<FileTree rootPath="/p" listDir={listDir} />)
    await userEvent.click(await screen.findByText('src'))
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
  })

  it('点击文件项调用 onOpenFile 传入其路径', async () => {
    const listDir = vi.fn(async () => [file('README.md', '/p/README.md')])
    const onOpenFile = vi.fn()
    render(<FileTree rootPath="/p" listDir={listDir} onOpenFile={onOpenFile} />)
    await userEvent.click(await screen.findByText('README.md'))
    expect(onOpenFile).toHaveBeenCalledWith('/p/README.md')
  })

  it('点击文件夹项只展开折叠、不调用 onOpenFile', async () => {
    const listDir = vi.fn(async (p: string) => {
      if (p === '/p') return [dir('src', '/p/src')]
      return [file('index.ts', '/p/src/index.ts')]
    })
    const onOpenFile = vi.fn()
    render(<FileTree rootPath="/p" listDir={listDir} onOpenFile={onOpenFile} />)
    await userEvent.click(await screen.findByText('src'))
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('refreshKey 变化后重新拉取根目录以反映磁盘变更', async () => {
    let snapshot: FileNode[] = [file('a.txt', '/p/a.txt')]
    const listDir = vi.fn(async () => snapshot)
    const { rerender } = render(<FileTree rootPath="/p" listDir={listDir} refreshKey={0} />)
    expect(await screen.findByText('a.txt')).toBeInTheDocument()

    snapshot = [file('a.txt', '/p/a.txt'), file('b.txt', '/p/b.txt')]
    rerender(<FileTree rootPath="/p" listDir={listDir} refreshKey={1} />)
    await waitFor(() => expect(screen.getByText('b.txt')).toBeInTheDocument())
  })
})
