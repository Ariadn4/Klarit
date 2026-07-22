/** 需求卡的纯逻辑：分类/状态/关系词表、预取名（git 友好 slug）校验与规整、候选卡与卡校验。
 *  无 fs / 无 IPC，main 与 renderer 共享（同 shared/workflow.ts 的定位）。本 change 不含持久化。 */

import type {
  CandidateCard,
  CardArchetype,
  CardRelation,
  CardRelationKind,
  CardStatus,
  RequirementCard,
  CardValidation
} from './types'
import type { TypeArchetypeMap } from './card-type'

/** 生命周期状态封闭词表。 */
export const CARD_STATUSES: ReadonlyArray<CardStatus> = [
  '未开始',
  '进行中',
  '已完成',
  '已暂停',
  '等待决策'
]

/** 关系边类型封闭词表（对齐「关系图：带类型的三种边」）。 */
export const CARD_RELATION_KINDS: ReadonlyArray<CardRelationKind> = [
  'parent',
  'child',
  'blocked_by',
  'blocks',
  'coupled_with'
]

/** git 友好 slug：小写字母/数字段、单连字符分隔、不以连字符起止、非空。 */
const PROPOSED_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function nonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.trim() !== ''
}

/** 预取名是否为合法 git 友好 slug（既作卡 id，也作分支名）。 */
export function isValidProposedName(name: unknown): boolean {
  return typeof name === 'string' && PROPOSED_NAME_RE.test(name)
}

/**
 * 把任意标题/文本规整为合法预取名：小写、非字母数字串折成连字符、去首尾连字符。
 * 全非 ASCII（折空）时回落到 `card`，保证非空合法（唯一性由 dedupeProposedName 负责）。
 */
export function toProposedName(text: string): string {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'card'
}

/** 冲突时加数字后缀去重（`name` → `name-2` / `name-3` …），返回首个未被占用者。 */
export function dedupeProposedName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  if (!set.has(name)) return name
  let i = 2
  while (set.has(`${name}-${i}`)) i++
  return `${name}-${i}`
}

function validateRelations(card: CandidateCard, where: string): string | null {
  const relations = card.relations ?? []
  if (!Array.isArray(relations)) return `${where}：关系必须是数组`
  for (let i = 0; i < relations.length; i++) {
    const r = relations[i]
    if (!r || !CARD_RELATION_KINDS.includes(r.kind)) {
      return `${where}：关系 ${i + 1} 的类型非法（应为 ${CARD_RELATION_KINDS.join('/')} 之一）`
    }
    if (!nonEmpty(r.target)) return `${where}：关系 ${i + 1} 的目标卡标识不能为空`
  }
  return null
}

/**
 * 校验候选卡的全部 agent 生成字段：标题非空、描述为字符串、预取名 git 友好、关系合法，且
 * **类型 typeId 在册**。类型在册与否由调用方注入的 `registry`（typeId→archetype）判定——纯逻辑
 * 不自读注册表；未提供 registry 时一律判类型不在册（见 `card-type.ts`、requirement-card-model spec）。
 * archetype 自检：声明了 `child` 关系（即挂子卡）的卡，其类型 archetype 必须为 `container`（leaf 不挂子卡）。
 */
export function validateCandidateCard(card: CandidateCard, registry?: TypeArchetypeMap): CardValidation {
  const where = `候选卡「${card?.title ?? card?.proposedName ?? ''}」`
  if (!card || typeof card !== 'object') return { ok: false, reason: '候选卡为空或非对象' }
  if (!isValidProposedName(card.proposedName)) {
    return {
      ok: false,
      reason: `${where}：预取名必须是 git 友好 slug（小写字母/数字/连字符、不以连字符起止）：${String(card.proposedName)}`
    }
  }
  if (!nonEmpty(card.title)) return { ok: false, reason: `${where}：标题不能为空` }
  if (typeof card.description !== 'string') return { ok: false, reason: `${where}：描述必须是文本` }
  if (!nonEmpty(card.typeId) || !registry?.has(card.typeId)) {
    return { ok: false, reason: `${where}：类型「${String(card.typeId)}」未在项目类型注册表中在册` }
  }
  const relReason = validateRelations(card, where)
  if (relReason) return { ok: false, reason: relReason }
  // archetype 自检：挂子卡（声明 child 关系）的卡必须是容器。
  const hasChild = (card.relations ?? []).some((r) => r?.kind === 'child')
  if (hasChild && registry.get(card.typeId) !== 'container') {
    return { ok: false, reason: `${where}：类型「${card.typeId}」是子叶（leaf），不能挂子卡（child 关系）` }
  }
  return { ok: true }
}

/** 校验持久化形态的需求卡：候选字段合法 + 状态合法 + 时间戳为数字。 */
export function validateRequirementCard(card: RequirementCard, registry?: TypeArchetypeMap): CardValidation {
  const base = validateCandidateCard(card, registry)
  if (!base.ok) return base
  if (!CARD_STATUSES.includes(card.status)) {
    return { ok: false, reason: `需求卡「${card.title}」：状态非法（应为 ${CARD_STATUSES.join('/')} 之一）` }
  }
  if (typeof card.createdAt !== 'number' || typeof card.updatedAt !== 'number') {
    return { ok: false, reason: `需求卡「${card.title}」：时间戳必须是数字` }
  }
  return { ok: true }
}

/** 由候选卡构造持久化形态需求卡：状态默认「未开始」，创建/更新时间戳取注入的 now。 */
export function newRequirementCard(candidate: CandidateCard, now: number): RequirementCard {
  return { ...candidate, status: '未开始', createdAt: now, updatedAt: now }
}

/**
 * 破坏性收边的待办门控（单一来源，供 board-context 标注与 validateOps 共用）：判定一张卡是否**仍在
 * 「待办」列、可被结构性编排操作（split/merge/adjust/relate）**。对齐 `requirement-kanban-board` 列定位：
 * - `container` 原型卡**恒在待办列**（作子卡入口）→ 可操作；
 * - `leaf` 卡仅当**状态「未开始」且无关联运行**（未流动的未跑卡）→ 可操作；一旦进行中/已暂停/等待决策/
 *   已完成或已有 `activeRunId`，即已离开待办、**不可**跨卡结构操作（改为建议新建需求）。
 * 未知 archetype（typeId 不在册）按 `leaf` 保守处理。
 */
export function isTodoCard(
  card: { status: CardStatus; activeRunId?: string },
  archetype: CardArchetype | undefined
): boolean {
  if (archetype === 'container') return true
  return card.status === '未开始' && !card.activeRunId
}

/**
 * 关系边校验用的**活现状卡视图**：现有落库卡与本批新卡统一到此形态。
 * `status`/`activeRunId` 供「blocks 目标须未跑」判定，`relations` 供跨图成环检测，`typeId` 供 archetype 查表。
 */
export interface EdgeCardView {
  typeId: string
  status: CardStatus
  activeRunId?: string
  relations: CardRelation[]
}

/** 一张卡是否**尚未启动**（状态「未开始」且无关联运行）——`blocks` 边的目标须满足此条件。 */
function isNotStarted(view: { status: CardStatus; activeRunId?: string }): boolean {
  return view.status === '未开始' && !view.activeRunId
}

/**
 * 层级加边是否成环：把 `parent`/`child` 边归一为一条有向父边 child→parent，
 * 再看 parent 是否已能沿现有父边到达 child（可达即成环）。图取自 `universe`（现有卡 ∪ 本批新卡），
 * 故成环检测**跨合并图**、不只本批。
 */
export function wouldCycle(
  from: string,
  edge: { kind: CardRelationKind; target: string },
  universe: ReadonlyMap<string, { relations: CardRelation[] }>
): boolean {
  // 归一到 (child, parent)：parent 边＝from 的父是 target；child 边＝from 挂 target 为子（即 target 的父是 from）。
  const child = edge.kind === 'parent' ? from : edge.target
  const parent = edge.kind === 'parent' ? edge.target : from
  if (child === parent) return true
  const seen = new Set<string>()
  let frontier = [parent]
  while (frontier.length) {
    const next: string[] = []
    for (const name of frontier) {
      if (name === child) return true
      if (seen.has(name)) continue
      seen.add(name)
      const c = universe.get(name)
      if (!c) continue
      for (const r of c.relations ?? []) if (r.kind === 'parent') next.push(r.target)
    }
    frontier = next
  }
  return false
}

/**
 * 单条关系边**在被引入的那一刻**是否合法——分解路（候选卡自带边）与编排路（`create` 内嵌边、`relate` 加边）
 * **共享的单一来源**。`universe` 为「现有落库卡 ∪ 本批新卡」的 id→视图映射；`from` 为发起卡 id（须在 universe 内）。
 * 判据：目标存在 · 无自环 · `parent`/`child` 的 archetype 与跨图成环 · **`blocks` 目标须未跑**
 * （`blocked_by` 不设状态门——等待端是发起卡自己）。只在引入期判定；既有已落库边不由本谓词追溯。
 */
export function isRelationEdgeLegal(
  from: string,
  edge: CardRelation,
  universe: ReadonlyMap<string, EdgeCardView>,
  registry: TypeArchetypeMap | undefined
): CardValidation {
  const { kind, target } = edge
  if (!CARD_RELATION_KINDS.includes(kind)) return { ok: false, reason: `关系类型「${String(kind)}」非法` }
  if (!nonEmpty(target)) return { ok: false, reason: '关系目标不能为空' }
  if (target === from) return { ok: false, reason: '不能对自身建立关系（自环）' }
  const targetView = universe.get(target)
  if (!targetView) return { ok: false, reason: `关系目标「${target}」不存在（未引用现有卡或本批任何卡）` }

  const archetypeOf = (name: string): CardArchetype | undefined => {
    const v = universe.get(name)
    return v ? registry?.get(v.typeId) : undefined
  }

  // blocks 引入时目标须未跑：不得给飞行中/已离开待办的卡追加前置门。blocked_by 目标不设状态门（放行任意状态）。
  if (kind === 'blocks' && !isNotStarted(targetView)) {
    return {
      ok: false,
      reason: `「${target}」已在运行或已离开待办，不能作为 blocks 边的目标（不得给飞行中的卡追加前置门）`
    }
  }
  // 层级 archetype：parent（from 的父是 target）要求 target 是容器；child（from 挂 target 为子）要求 from 是容器。
  if (kind === 'parent' && archetypeOf(target) !== 'container') {
    return { ok: false, reason: `父卡「${target}」不是容器（container），不能挂子卡` }
  }
  if (kind === 'child' && archetypeOf(from) !== 'container') {
    return { ok: false, reason: `卡「${from}」不是容器（container），不能挂子卡（child 关系）` }
  }
  if ((kind === 'parent' || kind === 'child') && wouldCycle(from, edge, universe)) {
    return { ok: false, reason: '该层级关系会形成环' }
  }
  return { ok: true }
}
