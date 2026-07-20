/**
 * 文档登记表纯函数：候选过滤、路径/文件名启发式分类（不读内容）、自底向上文件夹坍缩、
 * 登记表校验/规整。全部离线可跑（无 agent 依赖），供 main 扫描编排与测试直接使用。
 */

import type { DocKind, DocRegistry, ManagedDoc } from './types'
import { IGNORED_DIRS } from './ignored-dirs'

/** 分类输入：一个候选叶子及其启发式判定（null=不纳管）。 */
export interface ClassifiedLeaf {
  /** 相对成员仓根路径（POSIX 分隔）。 */
  path: string
  kind: DocKind | null
}

/** 纳入扫描的文本文档扩展名。 */
export const TEXT_DOC_EXTENSIONS = ['.md', '.txt', '.rst', '.adoc']

/** 快照信号：某时刻的冻结记录、只追加（词表按整词匹配路径段/文件名 token）。 */
const SNAPSHOT_SIGNALS = new Set([
  'adr',
  'adrs',
  'decision',
  'decisions',
  'changelog',
  'changelogs',
  'release',
  'releases',
  'meeting',
  'meetings',
  'retro',
  'retros',
  'postmortem',
  'postmortems',
  'incident',
  'incidents'
])

/** 动态信号：只记最新现状、可覆写。 */
const DYNAMIC_SIGNALS = new Set([
  'readme',
  'architecture',
  'arch',
  'design',
  'designs',
  'spec',
  'specs',
  'prd',
  'guide',
  'guides',
  'seed',
  'overview',
  'api'
])

/** 日期前缀文件名（YYYY-MM-DD-*）是快照信号（会议纪要/日志类惯用命名）。 */
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}([-_.]|$)/

const isTextDocFile = (name: string): boolean => {
  const lower = name.toLowerCase()
  return TEXT_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * 过滤候选叶子：只留文本文档扩展名、排除 IGNORED_DIRS 覆盖的路径；
 * isIgnored 注入 `.gitignore` 匹配（main 侧用 ignore 包供给），缺省不叠加。
 */
export function filterDocCandidates(
  relPaths: string[],
  isIgnored?: (relPath: string) => boolean
): string[] {
  return relPaths.filter((p) => {
    const segments = p.split('/')
    if (segments.slice(0, -1).some((s) => IGNORED_DIRS.has(s))) return false
    if (!isTextDocFile(segments[segments.length - 1])) return false
    return !isIgnored?.(p)
  })
}

/** 把一段路径拆成小写整词 token（路径段再按 -_. 与空格细分），供整词匹配、避免子串误命中。 */
function pathTokens(relPath: string): string[] {
  return relPath
    .toLowerCase()
    .split('/')
    .flatMap((seg) => seg.split(/[-_.\s]+/))
    .filter((t) => t !== '')
}

/** 文档目录段（弱兜底信号）：位于这些目录下的叶子默认是要管的文档。 */
const DOC_DIR_SEGMENTS = new Set(['docs', 'doc', 'documentation'])

/**
 * 启发式分类（纯路径/文件名，不读内容），强弱两级：
 * - 强信号仅一侧命中 → 该侧（snapshot / dynamic）。
 * - 冲突或无强信号 → 位于文档目录（docs/doc/documentation 段）弱兜底判 dynamic——
 *   文档目录里的东西默认在表里而非蒸发，误判交给用户改判。
 * - 都不中 → null（不纳管，不进两桶；由用户经「+ 添加」兜底拉回）。
 */
export function classify(relPath: string): DocKind | null {
  const tokens = pathTokens(relPath)
  const segments = relPath.split('/')
  const fileName = segments[segments.length - 1]
  const snapshot = tokens.some((t) => SNAPSHOT_SIGNALS.has(t)) || DATE_PREFIX.test(fileName)
  const dynamic = tokens.some((t) => DYNAMIC_SIGNALS.has(t))
  if (snapshot !== dynamic) return snapshot ? 'snapshot' : 'dynamic'
  const inDocDir = segments.slice(0, -1).some((s) => DOC_DIR_SEGMENTS.has(s.toLowerCase()))
  return inDocDir ? 'dynamic' : null
}

/** 目录树节点（坍缩用的中间结构）。 */
interface FolderNode {
  folders: Map<string, FolderNode>
  /** 本层直属叶子。 */
  leaves: ClassifiedLeaf[]
}

function buildTree(leaves: ClassifiedLeaf[]): FolderNode {
  const root: FolderNode = { folders: new Map(), leaves: [] }
  for (const leaf of leaves) {
    const segments = leaf.path.split('/')
    let node = root
    for (const seg of segments.slice(0, -1)) {
      let child = node.folders.get(seg)
      if (!child) {
        child = { folders: new Map(), leaves: [] }
        node.folders.set(seg, child)
      }
      node = child
    }
    node.leaves.push(leaf)
  }
  return root
}

/** 收集某节点下（含子孙）全部纳管叶子。 */
function managedLeavesUnder(node: FolderNode): ClassifiedLeaf[] {
  const out = node.leaves.filter((l) => l.kind !== null)
  for (const child of node.folders.values()) out.push(...managedLeavesUnder(child))
  return out
}

const fileDoc = (leaf: ClassifiedLeaf): ManagedDoc => ({
  id: leaf.path,
  location: leaf.path,
  kind: leaf.kind as DocKind,
  habitPrompt: '',
  approved: false
})

/**
 * 文件夹坍缩——**收在最高有意义的同类层**：一个子树（非仓根）全部纳管叶子（≥2）同 kind 时坍缩成一条
 * （coversFiles 圈全部纳管叶子），登记表不逐子夹展开（如 openspec/changes 一条，而非每个 change 一条）。
 * 细节：纯中转链（无直属纳管叶子、只有一个含内容子夹）继续下钻，收在有意义那层——docs/ 下只有 adr/
 * 时记 docs/adr 而非笼统的 docs。混合类型不坍缩，逐层下钻各自处理。单叶文件夹保留文件级条目。
 * 纯函数，输出按 location 排序。
 */
export function collapse(classified: ClassifiedLeaf[]): ManagedDoc[] {
  const out: ManagedDoc[] = []

  const walk = (node: FolderNode, prefix: string): void => {
    const managed = managedLeavesUnder(node)
    if (managed.length === 0) return
    const kinds = new Set(managed.map((l) => l.kind))
    if (prefix !== '' && managed.length >= 2 && kinds.size === 1) {
      const directManaged = node.leaves.some((l) => l.kind !== null)
      const childrenWithDocs = [...node.folders.entries()].filter(
        ([, c]) => managedLeavesUnder(c).length > 0
      )
      // 纯中转链：无直属叶子且只有一个含内容子夹 → 下钻到有意义的层再收。
      if (!directManaged && childrenWithDocs.length === 1) {
        const [name, child] = childrenWithDocs[0]
        walk(child, `${prefix}/${name}`)
        return
      }
      out.push({
        id: prefix,
        location: prefix,
        kind: managed[0].kind as DocKind,
        habitPrompt: '',
        approved: false,
        isFolder: true,
        coversFiles: managed.map((l) => l.path).sort()
      })
      return
    }
    for (const leaf of node.leaves) {
      if (leaf.kind !== null) out.push(fileDoc(leaf))
    }
    for (const [name, child] of node.folders) {
      walk(child, prefix === '' ? name : `${prefix}/${name}`)
    }
  }

  walk(buildTree(classified), '')
  out.sort((a, b) => a.location.localeCompare(b.location))
  return out
}

const isDocKind = (v: unknown): v is DocKind => v === 'dynamic' || v === 'snapshot'

/** 校验登记表（结构 + kind 词表 + location 非空 + id 唯一）；非法给可读原因。 */
export function validateRegistry(reg: DocRegistry): { ok: true } | { ok: false; reason: string } {
  if (typeof reg.memberId !== 'string' || reg.memberId === '') {
    return { ok: false, reason: 'memberId 缺失' }
  }
  if (!Array.isArray(reg.docs)) return { ok: false, reason: 'docs 不是数组' }
  const seen = new Set<string>()
  for (const d of reg.docs) {
    if (typeof d.location !== 'string' || d.location === '') {
      return { ok: false, reason: '存在 location 为空的条目' }
    }
    if (!isDocKind(d.kind)) {
      return { ok: false, reason: `条目「${d.location}」的 kind 非法（仅 dynamic|snapshot）` }
    }
    if (seen.has(d.location)) return { ok: false, reason: `条目「${d.location}」重复` }
    seen.add(d.location)
  }
  return { ok: true }
}

/** 空壳登记表（无表时的读取结果）。 */
export const emptyRegistry = (memberId: string): DocRegistry => ({
  memberId,
  docs: [],
  conventionPreamble: '',
  conventionApproved: false
})

function normalizeDoc(raw: unknown): ManagedDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const location = typeof o.location === 'string' ? o.location : ''
  if (location === '' || !isDocKind(o.kind)) return null
  const doc: ManagedDoc = {
    id: typeof o.id === 'string' && o.id !== '' ? o.id : location,
    location,
    kind: o.kind,
    habitPrompt: typeof o.habitPrompt === 'string' ? o.habitPrompt : '',
    approved: o.approved === true
  }
  if (o.isFolder === true) {
    doc.isFolder = true
    doc.coversFiles = Array.isArray(o.coversFiles)
      ? o.coversFiles.filter((f): f is string => typeof f === 'string')
      : []
  }
  return doc
}

/**
 * 规整外来/落盘数据为合法登记表：丢弃非法 kind 或空 location 条目（移出=离表，不留占位）、
 * 按 location 去重、审批位收敛为严格布尔（其余一律 false=草稿）。
 */
export function normalizeRegistry(raw: unknown, memberId: string): DocRegistry {
  if (!raw || typeof raw !== 'object') return emptyRegistry(memberId)
  const o = raw as Record<string, unknown>
  const docs: ManagedDoc[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(o.docs) ? o.docs : []) {
    const doc = normalizeDoc(item)
    if (doc && !seen.has(doc.location)) {
      seen.add(doc.location)
      docs.push(doc)
    }
  }
  return {
    memberId,
    docs,
    conventionPreamble: typeof o.conventionPreamble === 'string' ? o.conventionPreamble : '',
    conventionApproved: o.conventionApproved === true
  }
}
