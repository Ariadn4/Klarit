import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DocRegistry } from '@shared/types'
import { useDocumentsStore } from '../stores/documents'
import { DocumentRegistryEditor } from './DocumentRegistryEditor'

const registry = (over: Partial<DocRegistry> = {}): DocRegistry => ({
  memberId: 'm1',
  docs: [
    { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false },
    { id: 'docs/architecture.md', location: 'docs/architecture.md', kind: 'dynamic', habitPrompt: '', approved: false },
    {
      id: 'docs/adr',
      location: 'docs/adr',
      kind: 'snapshot',
      habitPrompt: 'Nygard 模板',
      approved: false,
      isFolder: true,
      coversFiles: ['docs/adr/0001-first.md', 'docs/adr/0002-second.md']
    },
    { id: 'CHANGELOG.md', location: 'CHANGELOG.md', kind: 'snapshot', habitPrompt: '', approved: false },
    { id: 'docs/meetings', location: 'docs/meetings', kind: 'snapshot', habitPrompt: '', approved: false, isFolder: true, coversFiles: ['docs/meetings/2024-01-05.md'] }
  ],
  conventionPreamble: '全项目用大白话',
  conventionApproved: false,
  ...over
})

function install(): void {
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
    saveDocuments: vi.fn(async () => undefined),
    analyzeDocuments: vi.fn(async () => ({ registry: registry(), error: null }))
  }
}

const dynamicColumn = (): HTMLElement => screen.getByRole('region', { name: '动态文档' })
const snapshotColumn = (): HTMLElement => screen.getByRole('region', { name: '快照文档' })

beforeEach(() => {
  install()
  useDocumentsStore.setState({ registry: registry(), analyzing: false, analyzeError: null })
})

describe('DocumentRegistryEditor · 两栏改判编辑器', () => {
  it('两栏各呈一桶（2 动态 / 3 快照），无第三栏', () => {
    render(<DocumentRegistryEditor />)
    const dyn = dynamicColumn()
    expect(within(dyn).getByText('README.md')).toBeInTheDocument()
    expect(within(dyn).getByText('docs/architecture.md')).toBeInTheDocument()
    const snap = snapshotColumn()
    expect(within(snap).getByText('docs/adr')).toBeInTheDocument()
    expect(within(snap).getByText('CHANGELOG.md')).toBeInTheDocument()
    expect(within(snap).getByText('docs/meetings')).toBeInTheDocument()
    // 不存在「不纳管」可见栏。
    expect(screen.queryByText('不纳管')).toBeNull()
    expect(screen.getAllByRole('region').filter((r) => r.getAttribute('data-doc-column'))).toHaveLength(2)
  })

  it('点 ⇄ 改判把行移到另一栏', async () => {
    render(<DocumentRegistryEditor />)
    await userEvent.click(screen.getByRole('button', { name: '改判 README.md' }))
    expect(within(snapshotColumn()).getByText('README.md')).toBeInTheDocument()
    expect(within(dynamicColumn()).queryByText('README.md')).toBeNull()
  })

  it('点 ✕ 移出后两栏均不显示该行', async () => {
    render(<DocumentRegistryEditor />)
    await userEvent.click(screen.getByRole('button', { name: '移出 CHANGELOG.md' }))
    expect(within(snapshotColumn()).queryByText('CHANGELOG.md')).toBeNull()
    expect(within(dynamicColumn()).queryByText('CHANGELOG.md')).toBeNull()
  })

  it('展开文件夹条目露覆盖计数（不列文件明细）+ 习惯 prompt 编辑 + 审批', async () => {
    render(<DocumentRegistryEditor />)
    await userEvent.click(screen.getByRole('button', { name: '文档 docs/adr' }))
    // 只显示覆盖计数，不逐个列文件路径（文件夹条目的重心是 prompt）。
    expect(screen.getByText('覆盖 2 个文件')).toBeInTheDocument()
    expect(screen.queryByText('docs/adr/0001-first.md')).toBeNull()
    expect(screen.queryByText('docs/adr/0002-second.md')).toBeNull()
    // prompt 可编辑；无逐条审批开关（审批=确认并保存）。
    const textarea = screen.getByRole('textbox', { name: '习惯 prompt docs/adr' })
    expect(textarea).toHaveValue('Nygard 模板')
    await userEvent.type(textarea, '，NNNN-kebab 命名')
    expect(
      useDocumentsStore.getState().registry?.docs.find((d) => d.id === 'docs/adr')?.habitPrompt
    ).toContain('NNNN-kebab')
    expect(screen.queryByRole('button', { name: '审批 docs/adr' })).toBeNull()
  })

  it('展开区可编辑路径：改为上层夹并应用（撞既有路径不应用）', async () => {
    render(<DocumentRegistryEditor />)
    await userEvent.click(screen.getByRole('button', { name: '文档 docs/adr' }))
    const input = screen.getByRole('textbox', { name: '路径 docs/adr' })
    expect(input).toHaveValue('docs/adr')
    await userEvent.clear(input)
    await userEvent.type(input, 'docs')
    await userEvent.click(screen.getByRole('button', { name: '应用路径 docs/adr' }))
    expect(within(snapshotColumn()).getByText('docs')).toBeInTheDocument()
    expect(screen.queryByText('docs/adr')).toBeNull()
    // 撞既有路径：把 docs 改成 CHANGELOG.md（已在表）→ 不应用。
    await userEvent.click(screen.getByRole('button', { name: '文档 docs' }))
    const input2 = screen.getByRole('textbox', { name: '路径 docs' })
    await userEvent.clear(input2)
    await userEvent.type(input2, 'CHANGELOG.md')
    await userEvent.click(screen.getByRole('button', { name: '应用路径 docs' }))
    expect(within(snapshotColumn()).getByText('docs')).toBeInTheDocument()
  })

  it('「+ 添加」把路径以指定桶入表', async () => {
    render(<DocumentRegistryEditor />)
    await userEvent.click(screen.getByRole('button', { name: '添加文件/文件夹' }))
    await userEvent.type(screen.getByRole('textbox', { name: '要添加的路径' }), 'LICENSE')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '添加到的桶' }), 'dynamic')
    await userEvent.click(screen.getByRole('button', { name: '确认添加' }))
    expect(within(dynamicColumn()).getByText('LICENSE')).toBeInTheDocument()
  })

  it('「文档公约」区可编辑（编辑打回未审批；无单独审批按钮）', async () => {
    useDocumentsStore.setState({ registry: registry({ conventionApproved: true }) })
    render(<DocumentRegistryEditor />)
    const textarea = screen.getByRole('textbox', { name: '文档公约' })
    expect(textarea).toHaveValue('全项目用大白话')
    expect(screen.queryByRole('button', { name: '审批文档公约' })).toBeNull()
    await userEvent.type(textarea, '；spec 过时直接改')
    expect(useDocumentsStore.getState().registry?.conventionApproved).toBe(false)
  })

  it('仅用语义令牌：渲染树里无硬编码颜色类', () => {
    const { container } = render(<DocumentRegistryEditor />)
    const html = container.innerHTML
    for (const banned of ['bg-white', 'bg-black', 'text-gray-', 'bg-gray-', 'text-white', 'border-gray-']) {
      expect(html).not.toContain(banned)
    }
  })
})
