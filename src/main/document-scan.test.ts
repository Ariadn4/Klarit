import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DocRegistry, ManagedDoc } from '../shared/types'
import { analyzeDocuments, mergeScan, scanDocuments } from './document-scan'

function seed(dir: string, relPath: string, content = '# 内容'): void {
  const abs = join(dir, ...relPath.split('/'))
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

describe('scanDocuments：walker + IGNORED_DIRS + .gitignore + classify + collapse', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'klarit-docscan-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('只收文本文档叶子，产出经 classify+collapse 的 ManagedDoc[]（无 prompt）', () => {
    seed(dir, 'docs/adr/0001-first.md')
    seed(dir, 'docs/adr/0002-second.md')
    seed(dir, 'docs/architecture.md')
    seed(dir, 'src/index.ts', 'export {}') // 非文本文档
    seed(dir, 'notes.md') // 无信号 → 不纳管
    const docs = scanDocuments(dir)
    expect(docs.map((d) => d.location).sort()).toEqual(['docs/adr', 'docs/architecture.md'])
    const adr = docs.find((d) => d.location === 'docs/adr') as ManagedDoc
    expect(adr).toMatchObject({
      isFolder: true,
      kind: 'snapshot',
      coversFiles: ['docs/adr/0001-first.md', 'docs/adr/0002-second.md'],
      habitPrompt: '',
      approved: false
    })
    expect(docs.find((d) => d.location === 'docs/architecture.md')?.kind).toBe('dynamic')
  })

  it('遵 IGNORED_DIRS 与 .gitignore：被忽略目录的文档不进候选', () => {
    seed(dir, 'node_modules/pkg/README.md')
    seed(dir, 'dist/guide.md')
    seed(dir, 'build/api.md')
    seed(dir, '.gitignore', 'build/\n')
    seed(dir, 'docs/api.md')
    const docs = scanDocuments(dir)
    expect(docs.map((d) => d.location)).toEqual(['docs/api.md'])
  })

  it('兜底排除计划容器：计划/提案夹下的文档不纳管，归档目标照常', () => {
    seed(dir, 'openspec/changes/add-a/proposal.md')
    seed(dir, 'openspec/changes/add-a/design.md')
    seed(dir, 'openspec/specs/foo/spec.md')
    seed(dir, 'openspec/specs/bar/spec.md')
    expect(scanDocuments(dir).map((d) => d.location)).toEqual(['openspec/specs'])
  })

  it('目录不存在时给空表（不抛）', () => {
    expect(scanDocuments(join(dir, '不存在'))).toEqual([])
  })

  it('点开头目录（.claude/.vscode 等工具配置）不进候选', () => {
    seed(dir, '.claude/skills/openspec-sync/SKILL.md')
    seed(dir, '.vscode/notes-guide.md')
    seed(dir, 'docs/guide.md')
    expect(scanDocuments(dir).map((d) => d.location)).toEqual(['docs/guide.md'])
  })

  it('不跟进符号链接/junction（防走进 worktree/外部大目录或成环冻住主进程）', () => {
    // 链接目标放在被扫目录之外，内含文档；仓内放一个指向它的 junction。
    const target = mkdtempSync(join(tmpdir(), 'klarit-docscan-target-'))
    try {
      seed(target, 'linked-guide.md')
      seed(dir, 'docs/guide.md')
      symlinkSync(target, join(dir, 'linked'), 'junction')
      expect(scanDocuments(dir).map((d) => d.location)).toEqual(['docs/guide.md'])
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })
})

describe('analyzeDocuments：agent 语义分组 + 分类 + 起草（一体）', () => {
  const candidates = [
    'openspec/changes/add-a/proposal.md',
    'openspec/changes/add-b/design.md',
    'docs/handbook/onboarding.md',
    'docs/handbook/ops.md',
    'openspec/specs/foo/spec.md',
    'docs/draft-x.md',
    'README.md'
  ]
  const reader = (rel: string): string => `《${rel} 的内容样本》`

  it('规整 agent 条目：文件夹按前缀圈 coversFiles、文件精确匹配、approved:false', async () => {
    const agent = vi.fn(async (prompt: string) => {
      // 全量候选清单与内容样本都进 prompt。
      expect(prompt).toContain('docs/handbook/onboarding.md')
      expect(prompt).toContain('《README.md 的内容样本》')
      return JSON.stringify({
        convention: '全项目大白话',
        entries: [
          { location: 'docs/handbook', kind: 'dynamic', habitPrompt: '手册' },
          { location: 'openspec/specs', kind: 'dynamic', habitPrompt: '主 spec' },
          { location: 'docs/draft-x.md', kind: 'snapshot', habitPrompt: '冻结草稿' },
          { location: 'README.md', kind: 'dynamic', habitPrompt: '概览' }
        ]
      })
    })
    const out = await analyzeDocuments(candidates, reader, agent)
    expect(agent).toHaveBeenCalledTimes(1)
    expect(out.error).toBe(null)
    expect(out.conventionPreamble).toBe('全项目大白话')
    // 同 kind 的 handbook 与 specs 保持两条（agent 语义分组说了算，不再按同类合并）。
    const handbook = out.docs.find((d) => d.location === 'docs/handbook')
    expect(handbook).toMatchObject({
      isFolder: true,
      kind: 'dynamic',
      habitPrompt: '手册',
      approved: false,
      coversFiles: ['docs/handbook/onboarding.md', 'docs/handbook/ops.md']
    })
    expect(out.docs.find((d) => d.location === 'openspec/specs')?.coversFiles).toEqual([
      'openspec/specs/foo/spec.md'
    ])
    const readme = out.docs.find((d) => d.location === 'README.md')
    expect(readme?.isFolder).toBeUndefined()
    expect(out.docs.every((d) => d.approved === false)).toBe(true)
  })

  it('公约起草指令收窄到语言 + 目录约定，不要风格类内容且要短', async () => {
    let prompt = ''
    await analyzeDocuments(candidates, reader, async (p) => {
      prompt = p
      return '{"convention":"","entries":[]}'
    })
    // 只识别两项事实。
    expect(prompt).toContain('语言')
    expect(prompt).toContain('目录')
    // 明说不写风格类内容，且要求简短。
    expect(prompt).toMatch(/不写|不要写/)
    expect(prompt).toContain('风格')
    expect(prompt).toMatch(/简短|越短越好/)
  })

  it('分析指令要求排除计划类文档；agent 判为计划类的容器不进登记表，归档目标照常', async () => {
    const agent = vi.fn(async (prompt: string) => {
      // 指令里明说计划类（任务作用域的计划/提案产物）不列入。
      expect(prompt).toContain('计划类')
      expect(prompt).toContain('不要列')
      // agent 据此把 openspec/changes 这类计划容器整个略过。
      return JSON.stringify({
        convention: '',
        entries: [
          { location: 'openspec/specs', kind: 'dynamic', habitPrompt: '主 spec' },
          { location: 'README.md', kind: 'dynamic', habitPrompt: '概览' }
        ]
      })
    })
    const out = await analyzeDocuments(candidates, reader, agent)
    expect(out.error).toBe(null)
    expect(out.docs.map((d) => d.location).sort()).toEqual(['README.md', 'openspec/specs'])
  })

  it('幻觉与非法条目被过滤：不存在的 location、非法 kind、重复 location', async () => {
    const agent = async (): Promise<string> =>
      JSON.stringify({
        convention: '',
        entries: [
          { location: 'ghost/x.md', kind: 'dynamic', habitPrompt: '' },
          { location: 'README.md', kind: 'weird', habitPrompt: '' },
          { location: 'README.md', kind: 'dynamic', habitPrompt: 'ok' },
          { location: 'README.md', kind: 'snapshot', habitPrompt: '重复' }
        ]
      })
    const out = await analyzeDocuments(candidates, reader, agent)
    expect(out.docs.map((d) => d.location)).toEqual(['README.md'])
    expect(out.docs[0].habitPrompt).toBe('ok')
  })

  it('agent 失败/输出不可解析 → error 如实、docs 空（上层回落启发式）', async () => {
    const failed = await analyzeDocuments(candidates, reader, async () => {
      throw new Error('agent 调用超时')
    })
    expect(failed.docs).toEqual([])
    expect(failed.error).toBe('agent 调用超时')

    const garbage = await analyzeDocuments(candidates, reader, async () => '呵呵这不是 JSON')
    expect(garbage.docs).toEqual([])
    expect(garbage.error).toContain('不可解析')
  })

  it('容忍围栏包裹的 JSON 输出', async () => {
    const fenced = [
      '```json',
      '{"convention":"通则","entries":[{"location":"README.md","kind":"dynamic","habitPrompt":"简洁"}]}',
      '```'
    ].join('\n')
    const out = await analyzeDocuments(candidates, reader, async () => fenced)
    expect(out.error).toBe(null)
    expect(out.docs[0]).toMatchObject({ location: 'README.md', habitPrompt: '简洁' })
  })

  it('无 agent → 空产出、无错误（上层直接走启发式兜底）', async () => {
    const out = await analyzeDocuments(candidates, reader, null)
    expect(out).toEqual({ docs: [], conventionPreamble: '', error: null })
  })
})

describe('mergeScan：重扫并入新文档，不覆盖既有条目', () => {
  it('既有条目（含已审批）原样保留，新发现的位置并入', () => {
    const existing: DocRegistry = {
      memberId: 'm1',
      docs: [
        {
          id: 'docs/adr',
          location: 'docs/adr',
          kind: 'dynamic', // 用户改判过
          habitPrompt: '用户批过的 prompt',
          approved: true,
          isFolder: true,
          coversFiles: ['docs/adr/0001.md']
        }
      ],
      conventionPreamble: '既有公约',
      conventionApproved: true
    }
    const scanned: ManagedDoc[] = [
      {
        id: 'docs/adr',
        location: 'docs/adr',
        kind: 'snapshot',
        habitPrompt: '',
        approved: false,
        isFolder: true,
        coversFiles: ['docs/adr/0001.md', 'docs/adr/0002.md']
      },
      { id: 'docs/spec.md', location: 'docs/spec.md', kind: 'dynamic', habitPrompt: '', approved: false }
    ]
    const merged = mergeScan(existing, scanned)
    // 既有条目保留用户改判与审批，仅刷新 coversFiles（磁盘现状）。
    const adr = merged.docs.find((d) => d.location === 'docs/adr') as ManagedDoc
    expect(adr.kind).toBe('dynamic')
    expect(adr.approved).toBe(true)
    expect(adr.habitPrompt).toBe('用户批过的 prompt')
    expect(adr.coversFiles).toEqual(['docs/adr/0001.md', 'docs/adr/0002.md'])
    // 新位置并入。
    expect(merged.docs.some((d) => d.location === 'docs/spec.md')).toBe(true)
    // 公约不动。
    expect(merged.conventionPreamble).toBe('既有公约')
    expect(merged.conventionApproved).toBe(true)
  })

  it('空表并入 = 直接采用扫描结果', () => {
    const empty: DocRegistry = { memberId: 'm', docs: [], conventionPreamble: '', conventionApproved: false }
    const scanned: ManagedDoc[] = [
      { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }
    ]
    expect(mergeScan(empty, scanned).docs).toEqual(scanned)
  })
})
