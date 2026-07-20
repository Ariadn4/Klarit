import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DocRegistry, Project } from '@shared/types'
import { useDocumentsStore } from '../stores/documents'
import { DocumentRegistrySettings } from './DocumentRegistrySettings'
import { SettingsHeaderSlotContext } from './ui/SettingsHeaderSlot'

const registry = (over: Partial<DocRegistry> = {}): DocRegistry => ({
  memberId: 'm1',
  docs: [
    { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '概览', approved: false }
  ],
  conventionPreamble: '',
  conventionApproved: false,
  ...over
})

function project(members: Array<{ id: string; name: string }>): Project {
  return {
    id: 'p1',
    displayName: 'proj',
    derivedName: 'proj',
    members: members.map((m) => ({
      id: m.id,
      idKind: 'uuid' as const,
      derivedName: m.name,
      rootPath: `/repo/${m.name}`,
      worktreePaths: [`/repo/${m.name}`],
      git: null,
      gitless: true
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function install(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    analyzeDocuments: vi.fn(async () => ({ registry: registry(), error: null })),
    getDocuments: vi.fn(async () => registry()),
    saveDocuments: vi.fn(async () => undefined),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api as Record<string, ReturnType<typeof vi.fn>>
}

beforeEach(() => {
  useDocumentsStore.setState({ registry: null, analyzing: false, analyzeError: null })
})

describe('DocumentRegistrySettings · 设置常驻文档面板', () => {
  it('挂载即载入首成员仓登记表并展示编辑器', async () => {
    const api = install()
    render(<DocumentRegistrySettings project={project([{ id: 'm1', name: 'web' }])} />)
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalledWith('m1'))
    expect(await screen.findByRole('region', { name: '动态文档' })).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('动作走顶栏插槽：重新扫描/保存为图标按钮，内容区不再自画文字按钮', async () => {
    install()
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    render(
      <SettingsHeaderSlotContext.Provider value={slot}>
        <DocumentRegistrySettings project={project([{ id: 'm1', name: 'web' }])} />
      </SettingsHeaderSlotContext.Provider>
    )
    await screen.findByText('README.md')
    const rescan = screen.getByRole('button', { name: '重新扫描' })
    const save = screen.getByRole('button', { name: '保存' })
    // 传送进顶栏插槽（与关闭 X 同行），而不是留在内容区。
    expect(slot.contains(rescan)).toBe(true)
    expect(slot.contains(save)).toBe(true)
    // 图标按钮：无文字、hover 有提示。
    expect(rescan).toHaveTextContent('')
    expect(rescan).toHaveAttribute('title', '重新扫描')
    expect(save).toHaveTextContent('')
    expect(save).toHaveAttribute('title', '保存')
    slot.remove()
  })

  it('用途说明可见（agent 参考 + 归档节点统一更新）', async () => {
    install()
    render(<DocumentRegistrySettings project={project([{ id: 'm1', name: 'web' }])} />)
    await screen.findByText('README.md')
    expect(screen.getByText(/项目参考/)).toHaveTextContent(/归档/)
  })

  it('改判后点保存 → 整表审批并落盘（保存即审批）', async () => {
    const api = install()
    render(<DocumentRegistrySettings project={project([{ id: 'm1', name: 'web' }])} />)
    await screen.findByText('README.md')
    await userEvent.click(screen.getByRole('button', { name: '改判 README.md' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(api.saveDocuments).toHaveBeenCalledTimes(1))
    const saved = api.saveDocuments.mock.calls[0][0] as DocRegistry
    expect(saved.docs[0]).toMatchObject({ kind: 'snapshot', approved: true })
    expect(saved.conventionApproved).toBe(true)
  })

  it('触发重新扫描 → 调 analyzeDocuments 并入新文档（主进程侧合并，不覆盖已审批条）', async () => {
    const api = install({
      analyzeDocuments: vi.fn(async () => ({
        registry: registry({
          docs: [
            { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '概览', approved: true },
            { id: 'docs/new.md', location: 'docs/new.md', kind: 'dynamic', habitPrompt: '', approved: false }
          ]
        }),
        error: null
      }))
    })
    render(<DocumentRegistrySettings project={project([{ id: 'm1', name: 'web' }])} />)
    await screen.findByText('README.md')
    await userEvent.click(screen.getByRole('button', { name: '重新扫描' }))
    await waitFor(() => expect(api.analyzeDocuments).toHaveBeenCalledWith('m1'))
    expect(await screen.findByText('docs/new.md')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('多成员仓项目提供成员切换，切换后载入对应表', async () => {
    const api = install()
    render(
      <DocumentRegistrySettings
        project={project([
          { id: 'm1', name: 'web' },
          { id: 'm2', name: 'server' }
        ])}
      />
    )
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalledWith('m1'))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '选择成员仓' }), 'm2')
    await waitFor(() => expect(api.getDocuments).toHaveBeenCalledWith('m2'))
  })
})
