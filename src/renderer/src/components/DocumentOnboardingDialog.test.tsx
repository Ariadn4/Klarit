import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DocRegistry } from '@shared/types'
import { useDocumentsStore } from '../stores/documents'
import { DocumentOnboardingDialog } from './DocumentOnboardingDialog'

const registry = (over: Partial<DocRegistry> = {}): DocRegistry => ({
  memberId: 'm1',
  docs: [
    { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '概览', approved: false },
    {
      id: 'docs/handbook',
      location: 'docs/handbook',
      kind: 'dynamic',
      habitPrompt: '团队手册',
      approved: false,
      isFolder: true,
      coversFiles: ['docs/handbook/onboarding.md']
    }
  ],
  conventionPreamble: '大白话',
  conventionApproved: false,
  ...over
})

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

describe('DocumentOnboardingDialog · 导入后的文档确认步（统一推出）', () => {
  it('分析进行中不弹确认步（进度归底栏），完成后弹窗直接推出完整编辑器', async () => {
    let resolveAnalyze: ((v: { registry: DocRegistry; error: null }) => void) | undefined
    const api = install({
      analyzeDocuments: vi.fn(
        () =>
          new Promise((r) => {
            resolveAnalyze = r as (v: { registry: DocRegistry; error: null }) => void
          })
      )
    })
    render(<DocumentOnboardingDialog memberId="m1" onClose={() => {}} />)
    await waitFor(() => expect(api.analyzeDocuments).toHaveBeenCalledWith('m1'))
    // 分析中：确认步整个不出现（模态不该把用户堵在纯等待的空壳里），进度由底栏承载。
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('region', { name: '动态文档' })).toBeNull()
    // 完成 → 弹窗推出，分类与文档规定一并呈现。
    await act(async () => resolveAnalyze?.({ registry: registry(), error: null }))
    expect(await screen.findByRole('region', { name: '动态文档' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('docs/handbook')).toBeInTheDocument()
  })

  it('用途说明在标题区、分割线之上（不随条目区滚走）', async () => {
    install()
    render(<DocumentOnboardingDialog memberId="m1" onClose={() => {}} />)
    await screen.findByText('README.md')
    const heading = screen.getByRole('heading', { name: '文档登记表' })
    const header = heading.parentElement as HTMLElement
    // 说明与标题同处标题区（该区带下边框=分割线），而非条目区。
    expect(header).toHaveTextContent(/项目参考/)
    expect(header.className).toContain('border-b')
    expect(header.querySelector('[data-doc-column]')).toBeNull()
  })

  it('「跳过」保存当前（未审批）状态并关闭', async () => {
    const api = install()
    const onClose = vi.fn()
    render(<DocumentOnboardingDialog memberId="m1" onClose={onClose} />)
    await screen.findByText('README.md')
    await userEvent.click(screen.getByRole('button', { name: '跳过' }))
    await waitFor(() => expect(api.saveDocuments).toHaveBeenCalledTimes(1))
    const saved = api.saveDocuments.mock.calls[0][0] as DocRegistry
    expect(saved.docs.every((d) => d.approved === false)).toBe(true)
    expect(onClose).toHaveBeenCalled()
  })

  it('「确认并保存」= 整表审批 + 落盘并关闭', async () => {
    const api = install()
    const onClose = vi.fn()
    render(<DocumentOnboardingDialog memberId="m1" onClose={onClose} />)
    await screen.findByText('README.md')
    await userEvent.click(screen.getByRole('button', { name: '改判 README.md' }))
    await userEvent.click(screen.getByRole('button', { name: '确认并保存' }))
    await waitFor(() => expect(api.saveDocuments).toHaveBeenCalledTimes(1))
    const saved = api.saveDocuments.mock.calls[0][0] as DocRegistry
    expect(saved.docs.find((d) => d.id === 'README.md')?.kind).toBe('snapshot')
    // 确认即审批：全部条目 + 公约都置为已审批。
    expect(saved.docs.every((d) => d.approved)).toBe(true)
    expect(saved.conventionApproved).toBe(true)
    expect(onClose).toHaveBeenCalled()
  })

  it('确无 agent（no-agent）→ 呈现启发式兜底结果并提示', async () => {
    install({
      analyzeDocuments: vi.fn(async () => ({ registry: registry(), error: 'no-agent' }))
    })
    render(<DocumentOnboardingDialog memberId="m1" onClose={() => {}} />)
    await screen.findByText('README.md')
    expect(screen.getByText(/未配置默认 agent/)).toBeInTheDocument()
  })

  it('分析失败（有 agent）→ 呈现兜底结果并如实报错，不误报「未配置 agent」', async () => {
    install({
      analyzeDocuments: vi.fn(async () => ({ registry: registry(), error: 'agent 调用超时' }))
    })
    render(<DocumentOnboardingDialog memberId="m1" onClose={() => {}} />)
    await screen.findByText('README.md')
    const alert = await screen.findByText(/分析失败/)
    expect(alert).toHaveTextContent('agent 调用超时')
    expect(screen.queryByText(/未配置默认 agent/)).toBeNull()
  })
})
