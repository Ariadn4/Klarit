import { describe, expect, it } from 'vitest'
import type { DocKind, DocRegistry, ManagedDoc } from './types'
import {
  classify,
  collapse,
  filterDocCandidates,
  normalizeRegistry,
  validateRegistry,
  type ClassifiedLeaf
} from './document-registry'

describe('classify：路径/文件名启发式（不读内容）', () => {
  it('快照信号（adr 路径段）归 snapshot', () => {
    expect(classify('docs/adr/0003-use-dockview.md')).toBe('snapshot')
  })

  it('动态信号（architecture 文件名）归 dynamic', () => {
    expect(classify('docs/architecture.md')).toBe('dynamic')
  })

  it('README 归 dynamic', () => {
    expect(classify('README.md')).toBe('dynamic')
  })

  it('CHANGELOG 归 snapshot', () => {
    expect(classify('CHANGELOG.md')).toBe('snapshot')
  })

  it('日期前缀文件名归 snapshot', () => {
    expect(classify('journal/2024-01-05-sync.md')).toBe('snapshot')
  })

  it('无信号且不在文档目录（仓根 notes.md）落不纳管（null），不硬塞某桶', () => {
    expect(classify('notes.md')).toBe(null)
  })

  it('文档目录弱兜底：docs 下无强信号默认 dynamic（不蒸发）', () => {
    expect(classify('docs/project-goals.md')).toBe('dynamic')
    expect(classify('docs/brand/01-colors.md')).toBe('dynamic')
  })

  it('强信号胜过弱兜底：docs/CHANGELOG.md 判 snapshot', () => {
    expect(classify('docs/CHANGELOG.md')).toBe('snapshot')
  })

  it('强信号冲突时按弱兜底：docs/adr/design.md 落 dynamic，文档目录外落不纳管', () => {
    expect(classify('docs/adr/design.md')).toBe('dynamic')
    expect(classify('src/adr/design.md')).toBe(null)
  })

  it('信号按整词匹配，不误命中子串（radar 不含 adr）', () => {
    expect(classify('radar.md')).toBe(null)
  })

  it('计划/提案容器优先排除：其下叶子不纳管，哪怕带动态强信号', () => {
    expect(classify('openspec/changes/add-a/design.md')).toBe(null)
    expect(classify('openspec/changes/archive/2026-06-01-c/tasks.md')).toBe(null)
    expect(classify('docs/proposals/new-idea.md')).toBe(null)
    expect(classify('docs/plans/q3.md')).toBe(null)
  })

  it('计划排除只看目录段，不误伤归档目标', () => {
    expect(classify('openspec/specs/foo/spec.md')).toBe('dynamic')
    expect(classify('docs/CHANGELOG.md')).toBe('snapshot')
    expect(classify('docs/adr/0007-plan-format.md')).toBe('snapshot')
  })
})

describe('filterDocCandidates：候选叶子过滤（扩展名 + IGNORED_DIRS + 注入 .gitignore）', () => {
  it('只留文本文档扩展名，排除代码文件', () => {
    expect(filterDocCandidates(['guide.txt', 'src/index.ts', 'docs/spec.md'])).toEqual([
      'guide.txt',
      'docs/spec.md'
    ])
  })

  it('IGNORED_DIRS 覆盖的路径不产候选', () => {
    expect(
      filterDocCandidates(['node_modules/pkg/README.md', 'dist/notes.md', 'docs/adr/0001.md'])
    ).toEqual(['docs/adr/0001.md'])
  })

  it('.gitignore（注入谓词）覆盖的路径不产候选', () => {
    const isIgnored = (p: string): boolean => p.startsWith('build/')
    expect(filterDocCandidates(['build/api.md', 'docs/api.md'], isIgnored)).toEqual(['docs/api.md'])
  })
})

describe('collapse：自底向上文件夹坍缩', () => {
  const leaf = (path: string, kind: DocKind | null): ClassifiedLeaf => ({ path, kind })

  it('全子项同类 → 坍缩为一条文件夹条目（带 coversFiles）', () => {
    const leaves = [
      leaf('docs/adr/0001-a.md', 'snapshot'),
      leaf('docs/adr/0002-b.md', 'snapshot'),
      leaf('docs/adr/0003-c.md', 'snapshot')
    ]
    const out = collapse(leaves)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      location: 'docs/adr',
      isFolder: true,
      kind: 'snapshot',
      coversFiles: ['docs/adr/0001-a.md', 'docs/adr/0002-b.md', 'docs/adr/0003-c.md'],
      approved: false,
      habitPrompt: ''
    })
  })

  it('混合类型不坍缩：父夹逐项记、同类子夹各自坍缩', () => {
    const leaves = [
      leaf('docs/architecture.md', 'dynamic'),
      leaf('docs/spec/a.md', 'dynamic'),
      leaf('docs/spec/b.md', 'dynamic'),
      leaf('docs/adr/0001.md', 'snapshot'),
      leaf('docs/adr/0002.md', 'snapshot')
    ]
    const out = collapse(leaves)
    const locations = out.map((d) => d.location).sort()
    expect(locations).toEqual(['docs/adr', 'docs/architecture.md', 'docs/spec'])
    const arch = out.find((d) => d.location === 'docs/architecture.md') as ManagedDoc
    expect(arch.isFolder).toBeUndefined()
    expect(arch.kind).toBe('dynamic')
    expect(out.find((d) => d.location === 'docs/adr')?.kind).toBe('snapshot')
    expect(out.find((d) => d.location === 'docs/spec')?.kind).toBe('dynamic')
  })

  it('坍缩跳过不纳管子项：coversFiles 只含纳管叶子', () => {
    const leaves = [
      leaf('docs/spec/a.md', 'dynamic'),
      leaf('docs/spec/b.md', 'dynamic'),
      leaf('docs/spec/c.md', 'dynamic'),
      leaf('docs/spec/scratch.md', null)
    ]
    const out = collapse(leaves)
    expect(out).toHaveLength(1)
    expect(out[0].location).toBe('docs/spec')
    expect(out[0].coversFiles).toEqual(['docs/spec/a.md', 'docs/spec/b.md', 'docs/spec/c.md'])
  })

  it('不纳管叶子不产条目', () => {
    expect(collapse([leaf('notes.md', null)])).toEqual([])
  })

  it('同类子树坍缩到最高层：多个同类子夹收成父夹一条（不逐子夹记）', () => {
    const leaves = [
      leaf('docs/handbook/onboarding/setup.md', 'dynamic'),
      leaf('docs/handbook/onboarding/tools.md', 'dynamic'),
      leaf('docs/handbook/ops/deploy.md', 'dynamic'),
      leaf('docs/handbook/ops/oncall.md', 'dynamic')
    ]
    const out = collapse(leaves)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      location: 'docs/handbook',
      isFolder: true,
      kind: 'dynamic',
      coversFiles: [
        'docs/handbook/onboarding/setup.md',
        'docs/handbook/onboarding/tools.md',
        'docs/handbook/ops/deploy.md',
        'docs/handbook/ops/oncall.md'
      ]
    })
  })

  it('纯中转链下钻：夹里只有一个含内容子夹时收在有意义的那层（docs/adr 而非 docs）', () => {
    const leaves = [leaf('docs/adr/0001.md', 'snapshot'), leaf('docs/adr/0002.md', 'snapshot')]
    const out = collapse(leaves)
    expect(out).toHaveLength(1)
    expect(out[0].location).toBe('docs/adr')
  })

  it('有直属叶子的同类夹在本层坍缩（不再下钻）', () => {
    const leaves = [
      leaf('docs/overview.md', 'dynamic'),
      leaf('docs/guide/setup.md', 'dynamic'),
      leaf('docs/guide/deploy.md', 'dynamic')
    ]
    const out = collapse(leaves)
    expect(out).toHaveLength(1)
    expect(out[0].location).toBe('docs')
    expect(out[0].coversFiles).toHaveLength(3)
  })

  it('单叶文件夹不坍缩，保留文件级条目', () => {
    const out = collapse([leaf('docs/guide/setup.md', 'dynamic')])
    expect(out).toHaveLength(1)
    expect(out[0].location).toBe('docs/guide/setup.md')
    expect(out[0].isFolder).toBeUndefined()
  })

  it('仓根不坍缩（根级全同类也不成一条根条目）', () => {
    const out = collapse([leaf('README.md', 'dynamic'), leaf('guide.md', 'dynamic')])
    expect(out.map((d) => d.location).sort()).toEqual(['README.md', 'guide.md'])
  })
})

describe('validateRegistry / normalizeRegistry', () => {
  const good: DocRegistry = {
    memberId: 'm1',
    docs: [
      { id: 'docs/spec', location: 'docs/spec', kind: 'dynamic', habitPrompt: '', approved: false }
    ],
    conventionPreamble: '',
    conventionApproved: false
  }

  it('合法登记表通过校验', () => {
    expect(validateRegistry(good)).toEqual({ ok: true })
  })

  it('kind 仅 dynamic|snapshot，其它值拒绝', () => {
    const bad = {
      ...good,
      docs: [{ ...good.docs[0], kind: 'other' as DocKind }]
    }
    const v = validateRegistry(bad)
    expect(v.ok).toBe(false)
  })

  it('normalize 丢弃非法 kind 条目（移出=离表，不留占位）', () => {
    const raw = {
      memberId: 'm1',
      docs: [
        { location: 'a.md', kind: 'dynamic' },
        { location: 'b.md', kind: 'weird' },
        { location: '', kind: 'snapshot' }
      ]
    }
    const reg = normalizeRegistry(raw, 'm1')
    expect(reg.docs.map((d) => d.location)).toEqual(['a.md'])
  })

  it('normalize 补默认：未审批条 approved:false、habitPrompt 空串、公约未审批', () => {
    const raw = {
      docs: [{ location: 'a.md', kind: 'snapshot', habitPrompt: 42, approved: 'yes' }],
      conventionPreamble: 7,
      conventionApproved: 'true'
    }
    const reg = normalizeRegistry(raw, 'm2')
    expect(reg.memberId).toBe('m2')
    expect(reg.docs[0].approved).toBe(false)
    expect(reg.docs[0].habitPrompt).toBe('')
    expect(reg.docs[0].id).toBe('a.md')
    expect(reg.conventionPreamble).toBe('')
    expect(reg.conventionApproved).toBe(false)
  })

  it('normalize 保留合法字段：审批过的条目与公约原样读回', () => {
    const raw = {
      memberId: 'm3',
      docs: [
        {
          id: 'docs/adr',
          location: 'docs/adr',
          kind: 'snapshot',
          habitPrompt: 'Nygard 模板',
          approved: true,
          isFolder: true,
          coversFiles: ['docs/adr/0001.md']
        }
      ],
      conventionPreamble: '大白话',
      conventionApproved: true
    }
    const reg = normalizeRegistry(raw, 'm3')
    expect(reg.docs[0]).toEqual({
      id: 'docs/adr',
      location: 'docs/adr',
      kind: 'snapshot',
      habitPrompt: 'Nygard 模板',
      approved: true,
      isFolder: true,
      coversFiles: ['docs/adr/0001.md']
    })
    expect(reg.conventionPreamble).toBe('大白话')
    expect(reg.conventionApproved).toBe(true)
  })
})
