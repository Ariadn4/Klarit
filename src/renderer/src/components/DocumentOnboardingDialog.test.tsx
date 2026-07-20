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
      id: 'openspec/changes',
      location: 'openspec/changes',
      kind: 'dynamic',
      habitPrompt: '工作草稿',
      approved: false,
      isFolder: true,
      coversFiles: ['openspec/changes/a/proposal.md']
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
  it('分析完成前只显示加载指示（不出现中间分类），完成后统一呈现编辑器', async () => {
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
    // 分析中：扫描文案（含可跳过说明），无两栏编辑器。
    expect(screen.getByText(/正在扫描该仓库文档现状/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '动态文档' })).toBeNull()
    // 完成 → 分类与 prompt 一并出现，扫描/引导文案不再显示。
    await act(async () => resolveAnalyze?.({ registry: registry(), error: null }))
    expect(await screen.findByRole('region', { name: '动态文档' })).toBeInTheDocument()
    expect(screen.getByText('openspec/changes')).toBeInTheDocument()
    expect(screen.queryByText(/正在扫描该仓库文档现状/)).toBeNull()
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
