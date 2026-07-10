/**
 * 需求卡持久化与 CRUD（requirement-card-store）：一卡一文件、按项目隔离
 * （`<baseDir>/<projectId>/<slug>.json`，不入 git），关系双向落地、删卡清悬挂边，
 * 两条落库路统一收口到 `create`。落库前经 `requirement-card.ts` 纯校验（注入 typeId→archetype）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CandidateCard,
  CandidateIssue,
  CardRelation,
  CardRelationKind,
  SplitEdgeInherit,
  StoredCard
} from '../shared/types'
import type { TypeArchetypeMap } from '../shared/card-type'
import { isTodoCard, newRequirementCard, validateRequirementCard } from '../shared/requirement-card'

/** 统一创建接缝的输入：一批候选 + 目标项目 + 注入的 now/registry（及落到每张卡的 repos）。 */
export interface CreateCardsInput {
  projectId: string
  candidates: CandidateCard[]
  now: number
  registry: TypeArchetypeMap
  /** 落到本批每张新卡的涉及仓；缺省为空（多仓留口，运行集成只取首仓）。 */
  repos?: string[]
}

/** 创建结果：成功落库的卡 + 逐张非法候选的可读问题（不静默丢弃）。 */
export interface CreateCardsResult {
  created: StoredCard[]
  issues: CandidateIssue[]
}

/** 关系边增删的公共结果（失败带可读原因）。 */
export type RelationResult = { ok: true } | { ok: false; reason: string }

/** addRelation 输入：在两张既有卡间加一条边（维护 INVERSE），注入注册表判 container-for-parent。 */
export interface AddRelationInput {
  projectId: string
  from: string
  edge: CardRelation
  registry: TypeArchetypeMap
}

/** splitCard 输入：把待办列的源卡拆成 N 张新卡（纯管理态、不碰 git）。 */
export interface SplitCardInput {
  projectId: string
  source: string
  into: CandidateCard[]
  edgeInherit: SplitEdgeInherit
  now: number
  registry: TypeArchetypeMap
  /** 落到子卡的涉及仓；缺省继承源卡 repos。 */
  repos?: string[]
}

/** splitCard 结果：落库的子卡 + 逐张问题；ok=false 时不落任何卡、带可读原因。 */
export interface SplitCardResult {
  ok: boolean
  reason?: string
  created: StoredCard[]
  issues: CandidateIssue[]
}

/** mergeCards 输入：把多张待办列的源卡并成一张目标卡（既有 id 或新卡）。 */
export interface MergeCardsInput {
  projectId: string
  sources: string[]
  into: string | CandidateCard
  mergedDescription?: string
  now: number
  registry: TypeArchetypeMap
  /** 落到目标卡的涉及仓（新卡时）；缺省取参与卡 repos 并集。 */
  repos?: string[]
}

/** mergeCards 结果：目标卡 + 逐项问题；ok=false 时不动任何卡、带可读原因。 */
export interface MergeCardsResult {
  ok: boolean
  reason?: string
  target: StoredCard | null
  issues: CandidateIssue[]
}

export interface CardStore {
  list(projectId: string): StoredCard[]
  get(projectId: string, slug: string): StoredCard | null
  create(input: CreateCardsInput): CreateCardsResult
  update(projectId: string, slug: string, patch: Partial<StoredCard>): StoredCard | null
  remove(projectId: string, slug: string): void
  /** 在两张既有卡间加一条关系边（双向、去重、container-for-parent 校验）。 */
  addRelation(input: AddRelationInput): RelationResult
  /** 移除一条关系边及其对侧反向边（无则 no-op）。 */
  removeRelation(projectId: string, from: string, edge: CardRelation): void
  /** 拆卡：源卡（须在待办列）→ N 张新卡，外部边按 edgeInherit 继承，删源卡；越界/非法整体拒绝不部分落。 */
  splitCard(input: SplitCardInput): SplitCardResult
  /** 并卡：多张源卡（须在待办列）→ 一张目标卡，边并集重指、删被并卡；越界/非法整体拒绝不部分落。 */
  mergeCards(input: MergeCardsInput): MergeCardsResult
}

/** 关系边的反向类型（parent↔child、blocked_by↔blocks、coupled_with 自反）。 */
const INVERSE: Record<CardRelationKind, CardRelationKind> = {
  parent: 'child',
  child: 'parent',
  blocked_by: 'blocks',
  blocks: 'blocked_by',
  coupled_with: 'coupled_with'
}

function hasRelation(rels: CardRelation[], kind: CardRelationKind, target: string): boolean {
  return rels.some((r) => r.kind === kind && r.target === target)
}

/** 低层持久化后端（内存 / 文件各实现一份），承载读写一张卡与列项目卡。 */
interface Backend {
  read(projectId: string, slug: string): StoredCard | null
  write(card: StoredCard): void
  listProject(projectId: string): StoredCard[]
  del(projectId: string, slug: string): void
}

function makeStore(b: Backend): CardStore {
  function create({ projectId, candidates, now, registry, repos }: CreateCardsInput): CreateCardsResult {
    const created: StoredCard[] = []
    const issues: CandidateIssue[] = []
    const taken = new Set(b.listProject(projectId).map((c) => c.proposedName))

    candidates.forEach((c, index) => {
      if (taken.has(c.proposedName)) {
        issues.push({ index, proposedName: c.proposedName, reason: `预取名「${c.proposedName}」在该项目已存在` })
        return
      }
      const stored: StoredCard = { ...newRequirementCard(c, now), projectId, repos: repos ?? [] }
      const v = validateRequirementCard(stored, registry)
      if (!v.ok) {
        issues.push({ index, proposedName: c.proposedName, reason: v.reason })
        return
      }
      stored.relations = [...(stored.relations ?? [])]
      b.write(stored)
      taken.add(stored.proposedName)
      created.push(stored)
    })

    // 关系双向落地：为每条边在目标卡补反向边（目标须已在库——本批或既存；悬挂目标跳过）。
    for (const card of created) {
      for (const rel of card.relations) {
        const target = b.read(projectId, rel.target)
        if (!target) continue
        const inverse = INVERSE[rel.kind]
        if (!hasRelation(target.relations, inverse, card.proposedName)) {
          target.relations = [...target.relations, { kind: inverse, target: card.proposedName }]
          b.write(target)
        }
      }
    }

    // 重读 created（某张可能被同批另一张作为目标补了反向边）。
    return { created: created.map((c) => b.read(projectId, c.proposedName) ?? c), issues }
  }

  function update(projectId: string, slug: string, patch: Partial<StoredCard>): StoredCard | null {
    const cur = b.read(projectId, slug)
    if (!cur) return null
    // 保护身份字段（proposedName=id、projectId 不可经 patch 改）。
    const next: StoredCard = { ...cur, ...patch, proposedName: cur.proposedName, projectId: cur.projectId }
    b.write(next)
    return next
  }

  function remove(projectId: string, slug: string): void {
    for (const other of b.listProject(projectId)) {
      if (other.proposedName === slug) continue
      if (other.relations.some((r) => r.target === slug)) {
        other.relations = other.relations.filter((r) => r.target !== slug)
        b.write(other)
      }
    }
    b.del(projectId, slug)
  }

  /** 低层：给 from 加一条 (kind,target) 边并在 target 加反向边（各自去重）。缺卡跳过。 */
  function writeEdge(projectId: string, from: string, kind: CardRelationKind, target: string): void {
    const a = b.read(projectId, from)
    if (a && !hasRelation(a.relations, kind, target)) {
      a.relations = [...a.relations, { kind, target }]
      b.write(a)
    }
    const t = b.read(projectId, target)
    const inv = INVERSE[kind]
    if (t && !hasRelation(t.relations, inv, from)) {
      t.relations = [...t.relations, { kind: inv, target: from }]
      b.write(t)
    }
  }

  /** 低层：移除 from 的 (kind,target) 边及 target 的反向边。 */
  function dropEdge(projectId: string, from: string, kind: CardRelationKind, target: string): void {
    const a = b.read(projectId, from)
    if (a) {
      const next = a.relations.filter((r) => !(r.kind === kind && r.target === target))
      if (next.length !== a.relations.length) {
        a.relations = next
        b.write(a)
      }
    }
    const t = b.read(projectId, target)
    const inv = INVERSE[kind]
    if (t) {
      const next = t.relations.filter((r) => !(r.kind === inv && r.target === from))
      if (next.length !== t.relations.length) {
        t.relations = next
        b.write(t)
      }
    }
  }

  const isTodo = (projectId: string, name: string, registry: TypeArchetypeMap): boolean => {
    const c = b.read(projectId, name)
    return c ? isTodoCard(c, registry.get(c.typeId)) : false
  }

  function addRelation({ projectId, from, edge, registry }: AddRelationInput): RelationResult {
    const src = b.read(projectId, from)
    if (!src) return { ok: false, reason: `卡「${from}」不存在` }
    if (from === edge.target) return { ok: false, reason: '不能对自身建立关系（自环）' }
    const tgt = b.read(projectId, edge.target)
    if (!tgt) return { ok: false, reason: `目标卡「${edge.target}」不存在` }
    if (edge.kind === 'parent' && registry.get(tgt.typeId) !== 'container') {
      return { ok: false, reason: `父卡「${edge.target}」不是容器（container），不能挂子卡` }
    }
    if (edge.kind === 'child' && registry.get(src.typeId) !== 'container') {
      return { ok: false, reason: `卡「${from}」不是容器（container），不能挂子卡` }
    }
    writeEdge(projectId, from, edge.kind, edge.target)
    return { ok: true }
  }

  function removeRelation(projectId: string, from: string, edge: CardRelation): void {
    dropEdge(projectId, from, edge.kind, edge.target)
  }

  /** 预校验一批新卡（撞名 + 卡模型），返回逐张 issue（空即全合法）。excludeNames 为即将删除、可复用其名的卡。 */
  function precheckNewCards(
    projectId: string,
    cards: CandidateCard[],
    now: number,
    registry: TypeArchetypeMap,
    repos: string[],
    excludeNames: Set<string>
  ): CandidateIssue[] {
    const taken = new Set(b.listProject(projectId).map((c) => c.proposedName))
    for (const n of excludeNames) taken.delete(n)
    const issues: CandidateIssue[] = []
    cards.forEach((c, index) => {
      if (taken.has(c.proposedName)) {
        issues.push({ index, proposedName: c.proposedName, reason: `预取名「${c.proposedName}」在该项目已存在` })
        return
      }
      const stored: StoredCard = { ...newRequirementCard(c, now), projectId, repos }
      const v = validateRequirementCard(stored, registry)
      if (!v.ok) issues.push({ index, proposedName: c.proposedName, reason: v.reason })
      else taken.add(c.proposedName)
    })
    return issues
  }

  function splitCard({ projectId, source, into, edgeInherit, now, registry, repos }: SplitCardInput): SplitCardResult {
    const src = b.read(projectId, source)
    if (!src) return { ok: false, reason: `源卡「${source}」不存在`, created: [], issues: [] }
    if (!isTodoCard(src, registry.get(src.typeId))) {
      return { ok: false, reason: `源卡「${source}」已离开待办列，不可拆`, created: [], issues: [] }
    }
    const childRepos = repos ?? src.repos
    // 源的外部边（into 都是新卡，故源现有边全指向其它既有卡）——按策略继承给每张子卡。
    const inherited = edgeInherit === 'all' ? src.relations.filter((r) => !!b.read(projectId, r.target)) : []
    const children = into.map((c) => ({ ...c, relations: [...(c.relations ?? []), ...inherited] }))
    const issues = precheckNewCards(projectId, children, now, registry, childRepos, new Set([source]))
    if (issues.length > 0) return { ok: false, reason: '拆分产物含非法/撞名卡', created: [], issues }
    // 原子应用：先删源（清邻居对源的悬挂反向边），再建子卡（写双向，邻居反向重指子卡）。
    remove(projectId, source)
    const res = create({ projectId, candidates: children, now, registry, repos: childRepos })
    return { ok: true, created: res.created, issues: res.issues }
  }

  function mergeCards({ projectId, sources, into, mergedDescription, now, registry, repos }: MergeCardsInput): MergeCardsResult {
    if (sources.length < 2) return { ok: false, reason: '合并至少需要两张源卡', target: null, issues: [] }
    const survivorName = typeof into === 'string' ? into : into.proposedName
    const mergeSet = new Set(sources)
    if (typeof into === 'string') mergeSet.add(into)

    // 校验：每张源卡存在且在待办列；既有目标卡同理；新目标卡合法且不撞名。
    for (const s of sources) {
      if (!b.read(projectId, s)) return { ok: false, reason: `源卡「${s}」不存在`, target: null, issues: [] }
      if (!isTodo(projectId, s, registry)) return { ok: false, reason: `源卡「${s}」已离开待办列，不可合并`, target: null, issues: [] }
    }
    if (typeof into === 'string') {
      if (!b.read(projectId, into)) return { ok: false, reason: `目标卡「${into}」不存在`, target: null, issues: [] }
      if (!isTodo(projectId, into, registry)) return { ok: false, reason: `目标卡「${into}」已离开待办列`, target: null, issues: [] }
    } else {
      const issues = precheckNewCards(projectId, [into], now, registry, repos ?? [], new Set())
      if (issues.length > 0) return { ok: false, reason: '合并目标卡非法/撞名', target: null, issues }
    }

    // 参与卡（mergeSet 中既有卡）——先算并集外部边与合并描述、repos，再动库。
    const parts = [...mergeSet].map((n) => b.read(projectId, n)).filter((c): c is StoredCard => c !== null)
    const external: CardRelation[] = []
    for (const p of parts) {
      for (const r of p.relations) {
        if (mergeSet.has(r.target)) continue // 并集内部边丢弃
        if (!external.some((e) => e.kind === r.kind && e.target === r.target)) external.push(r)
      }
    }
    // 描述优先级：显式 mergedDescription > 新目标卡自带描述 > 参与卡描述拼接。
    const newCardDesc = typeof into !== 'string' && into.description?.trim() !== '' ? into.description : undefined
    const desc = mergedDescription ?? newCardDesc ?? parts.map((p) => p.description).filter((d) => d.trim() !== '').join('\n\n')
    const mergedRepos = repos ?? [...new Set(parts.flatMap((p) => p.repos))]

    // 应用：删被并卡（清邻居悬挂反向边），再落目标卡 + 双向重指外部边。
    const absorbed = [...mergeSet].filter((n) => n !== survivorName)
    for (const n of absorbed) remove(projectId, n)

    if (typeof into === 'string') {
      const surv = b.read(projectId, survivorName)
      if (!surv) return { ok: false, reason: `目标卡「${survivorName}」丢失`, target: null, issues: [] }
      surv.relations = []
      surv.description = desc
      surv.updatedAt = now
      b.write(surv)
      for (const e of external) writeEdge(projectId, survivorName, e.kind, e.target)
    } else {
      create({
        projectId,
        candidates: [{ ...into, description: desc, relations: external }],
        now,
        registry,
        repos: mergedRepos
      })
    }
    return { ok: true, target: b.read(projectId, survivorName), issues: [] }
  }

  return {
    list: (projectId) => b.listProject(projectId),
    get: (projectId, slug) => b.read(projectId, slug),
    create,
    update,
    remove,
    addRelation,
    removeRelation,
    splitCard,
    mergeCards
  }
}

/** 文件持久化后端（userData/cards/<projectId>/<slug>.json）。 */
function fileBackend(baseDir: string): Backend {
  const file = (p: string, s: string): string => join(baseDir, p, `${s}.json`)
  return {
    read(p, s) {
      try {
        const f = file(p, s)
        return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as StoredCard) : null
      } catch {
        return null
      }
    },
    write(c) {
      mkdirSync(join(baseDir, c.projectId), { recursive: true })
      writeFileSync(file(c.projectId, c.proposedName), JSON.stringify(c, null, 2), 'utf8')
    },
    listProject(p) {
      const dir = join(baseDir, p)
      if (!existsSync(dir)) return []
      const out: StoredCard[] = []
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue
        try {
          out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as StoredCard)
        } catch {
          /* 跳过损坏单卡文件 */
        }
      }
      return out
    },
    del(p, s) {
      rmSync(file(p, s), { force: true })
    }
  }
}

/** 内存后端（测试/无盘），深拷贝隔离。 */
function memoryBackend(): Backend {
  const map = new Map<string, StoredCard>()
  const key = (p: string, s: string): string => `${p}/${s}`
  const clone = (c: StoredCard): StoredCard => JSON.parse(JSON.stringify(c)) as StoredCard
  return {
    read: (p, s) => {
      const c = map.get(key(p, s))
      return c ? clone(c) : null
    },
    write: (c) => {
      map.set(key(c.projectId, c.proposedName), clone(c))
    },
    listProject: (p) => [...map.values()].filter((c) => c.projectId === p).map(clone),
    del: (p, s) => {
      map.delete(key(p, s))
    }
  }
}

export function createCardStore(baseDir: string): CardStore {
  return makeStore(fileBackend(baseDir))
}

export function createMemoryCardStore(): CardStore {
  return makeStore(memoryBackend())
}
