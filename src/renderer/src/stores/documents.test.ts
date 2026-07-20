import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DocRegistry } from '@shared/types'
import { useDocumentsStore } from './documents'

const registry = (over: Partial<DocRegistry> = {}): DocRegistry => ({
  memberId: 'm1',
  docs: [
    {
      id: 'docs/adr',
      location: 'docs/adr',
      kind: 'snapshot',
      habitPrompt: 'Nygard 模板',
      approved: false,
      isFolder: true,
      coversFiles: ['docs/adr/0001.md']
    },
    { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }
  ],
  conventionPreamble: '大白话',
  conventionApproved: false,
  ...over
})

function stubApi(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
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

describe('documents store', () => {
  it('analyze() 调 window.klarit.analyzeDocuments 并载入登记表（analyzing 收尾复位）', async () => {
    const api = stubApi()
    await useDocumentsStore.getState().analyze('m1')
    expect(api.analyzeDocuments).toHaveBeenCalledWith('m1')
    expect(useDocumentsStore.getState().registry?.docs).toHaveLength(2)
    expect(useDocumentsStore.getState().analyzing).toBe(false)
    expect(useDocumentsStore.getState().analyzeError).toBe(null)
  })

  it('analyze() 成员不存在（null）优雅清空', async () => {
    stubApi({ analyzeDocuments: vi.fn(async () => null) })
    await useDocumentsStore.getState().analyze('无此成员')
    expect(useDocumentsStore.getState().registry).toBe(null)
    expect(useDocumentsStore.getState().analyzing).toBe(false)
  })

  it('analyze() 把主进程报的失败态写入 analyzeError（no-agent / 具体错误），成功后清除', async () => {
    stubApi({
      analyzeDocuments: vi.fn(async () => ({ registry: registry(), error: 'agent 调用超时' }))
    })
    await useDocumentsStore.getState().analyze('m1')
    expect(useDocumentsStore.getState().analyzeError).toBe('agent 调用超时')
    // 兜底结果仍载入（启发式表）。
    expect(useDocumentsStore.getState().registry?.docs).toHaveLength(2)

    stubApi()
    await useDocumentsStore.getState().analyze('m1')
    expect(useDocumentsStore.getState().analyzeError).toBe(null)
  })

  it('load() 读既有表', async () => {
    const api = stubApi()
    await useDocumentsStore.getState().load('m1')
    expect(api.getDocuments).toHaveBeenCalledWith('m1')
    expect(useDocumentsStore.getState().registry?.memberId).toBe('m1')
  })

  it('reclassify(id) 在 dynamic/snapshot 间切换该条 kind', async () => {
    stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().reclassify('docs/adr')
    expect(useDocumentsStore.getState().registry?.docs.find((d) => d.id === 'docs/adr')?.kind).toBe(
      'dynamic'
    )
    useDocumentsStore.getState().reclassify('docs/adr')
    expect(useDocumentsStore.getState().registry?.docs.find((d) => d.id === 'docs/adr')?.kind).toBe(
      'snapshot'
    )
  })

  it('eject(id) 从表移除（隐式不纳管，不留占位）', async () => {
    stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().eject('README.md')
    expect(useDocumentsStore.getState().registry?.docs.map((d) => d.id)).toEqual(['docs/adr'])
  })

  it('add(path, kind) 把路径入表（找回移出者/纳入未扫到者）；已在表不重复', async () => {
    stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().add('LICENSE', 'dynamic')
    expect(
      useDocumentsStore.getState().registry?.docs.find((d) => d.location === 'LICENSE')
    ).toMatchObject({ kind: 'dynamic', habitPrompt: '', approved: false })
    useDocumentsStore.getState().add('README.md', 'snapshot')
    expect(
      useDocumentsStore.getState().registry?.docs.filter((d) => d.location === 'README.md')
    ).toHaveLength(1)
  })

  it('editPrompt(id, text) 改 habitPrompt 并把该条打回未审批', async () => {
    stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().approveAll()
    useDocumentsStore.getState().editPrompt('docs/adr', '改过的习惯')
    const doc = useDocumentsStore.getState().registry?.docs.find((d) => d.id === 'docs/adr')
    expect(doc?.habitPrompt).toBe('改过的习惯')
    expect(doc?.approved).toBe(false)
  })

  it('approveAll() 整表审批（「确认并保存」的语义核）', async () => {
    stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().approveAll()
    const reg = useDocumentsStore.getState().registry
    expect(reg?.docs.every((d) => d.approved)).toBe(true)
    expect(reg?.conventionApproved).toBe(true)
  })

  it('editLocation(id, path) 改路径收级：id/location 更新、打回未审批；撞既有路径不应用', async () => {
    stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().approveAll()
    useDocumentsStore.getState().editLocation('docs/adr', 'docs')
    const moved = useDocumentsStore.getState().registry?.docs.find((d) => d.id === 'docs')
    expect(moved).toMatchObject({ location: 'docs', approved: false })
    expect(
      useDocumentsStore.getState().registry?.docs.find((d) => d.id === 'docs/adr')
    ).toBeUndefined()
    // 撞既有路径（README.md 已在表）→ 不应用。
    useDocumentsStore.getState().editLocation('docs', 'README.md')
    expect(useDocumentsStore.getState().registry?.docs.find((d) => d.id === 'docs')).toBeDefined()
  })

  it('editConvention 编辑公约并打回未审批', async () => {
    stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().approveAll()
    useDocumentsStore.getState().editConvention('新公约')
    expect(useDocumentsStore.getState().registry?.conventionPreamble).toBe('新公约')
    expect(useDocumentsStore.getState().registry?.conventionApproved).toBe(false)
  })

  it('save() 把当前表经 IPC 持久化', async () => {
    const api = stubApi()
    await useDocumentsStore.getState().load('m1')
    useDocumentsStore.getState().approveAll()
    await useDocumentsStore.getState().save()
    expect(api.saveDocuments).toHaveBeenCalledTimes(1)
    const saved = api.saveDocuments.mock.calls[0][0] as DocRegistry
    expect(saved.docs.every((d) => d.approved)).toBe(true)
  })
})
