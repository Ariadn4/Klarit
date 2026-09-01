import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DocRegistry } from '../shared/types'
import { createDocumentStore, type DocumentStore } from './document-store'
import { testTmpDir } from './test-tmp'

const reg = (memberId: string, over: Partial<DocRegistry> = {}): DocRegistry => ({
  memberId,
  docs: [
    {
      id: 'docs/adr',
      location: 'docs/adr',
      kind: 'snapshot',
      habitPrompt: 'Nygard 模板',
      approved: true,
      isFolder: true,
      coversFiles: ['docs/adr/0001.md']
    },
    { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }
  ],
  conventionPreamble: '大白话',
  conventionApproved: false,
  ...over
})

describe('createDocumentStore：per-成员仓 JSON 持久化', () => {
  let dir: string
  let store: DocumentStore

  beforeEach(() => {
    dir = testTmpDir('klarit-docstore-')
    store = createDocumentStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('无表返回空壳（memberId 回填、docs 空、公约空且未审批）', () => {
    expect(store.get('member-1')).toEqual({
      memberId: 'member-1',
      docs: [],
      conventionPreamble: '',
      conventionApproved: false
    })
  })

  it('save 落盘后 get 读回一致', () => {
    const r = reg('member-1')
    store.save(r)
    expect(store.get('member-1')).toEqual(r)
    // 新实例（重启模拟）也读回一致——确认真实落盘而非内存缓存。
    expect(createDocumentStore(dir).get('member-1')).toEqual(r)
  })

  it('per-成员仓隔离：不同 memberId 互不覆盖', () => {
    const a = reg('member-a')
    const b = reg('member-b', { conventionPreamble: 'B 仓公约' })
    store.save(a)
    store.save(b)
    expect(store.get('member-a')).toEqual(a)
    expect(store.get('member-b')).toEqual(b)
  })

  it('路径型 memberId（含盘符/斜杠）安全落盘，不逃逸 baseDir', () => {
    const pathId = 'F:\\some\\repo/dir'
    const r = reg(pathId)
    store.save(r)
    expect(store.get(pathId)).toEqual(r)
    // 文件都落在 baseDir 里。
    expect(readdirSync(dir).length).toBeGreaterThan(0)
  })

  it('损坏文件优雅回空壳并经 normalize 兜底', () => {
    store.save(reg('member-x'))
    // 直接写坏它的落盘文件。
    for (const f of readdirSync(dir)) writeFileSync(join(dir, f), '{ 不是 JSON', 'utf8')
    expect(store.get('member-x')).toEqual({
      memberId: 'member-x',
      docs: [],
      conventionPreamble: '',
      conventionApproved: false
    })
  })

  it('remove 删除该成员仓的登记表（移除项目=重导入白纸重扫），不影响其它成员', () => {
    store.save(reg('member-a'))
    store.save(reg('member-b'))
    store.remove('member-a')
    expect(store.get('member-a')).toEqual({
      memberId: 'member-a',
      docs: [],
      conventionPreamble: '',
      conventionApproved: false
    })
    expect(store.get('member-b')).toEqual(reg('member-b'))
    // 无表时 remove 为 no-op，不抛。
    store.remove('从未存在')
  })

  it('has：从未建表返回 false、建过返回 true、remove 后回 false（供归档区分「无表挂起」与「空表 noop」）', () => {
    expect(store.has('member-h')).toBe(false)
    store.save(reg('member-h'))
    expect(store.has('member-h')).toBe(true)
    // 空 docs 但已建表：仍算「有表」（归档据此走 noop 而非挂起建表）。
    store.save({ memberId: 'member-empty', docs: [], conventionPreamble: '', conventionApproved: false })
    expect(store.has('member-empty')).toBe(true)
    store.remove('member-h')
    expect(store.has('member-h')).toBe(false)
  })

  it('save 前经 normalize：非法条目不落盘', () => {
    const dirty = {
      ...reg('member-y'),
      docs: [
        ...reg('member-y').docs,
        { id: '', location: '', kind: 'weird', habitPrompt: 0, approved: 'y' }
      ]
    } as unknown as DocRegistry
    store.save(dirty)
    expect(store.get('member-y').docs.map((d) => d.location)).toEqual(['docs/adr', 'README.md'])
  })
})
