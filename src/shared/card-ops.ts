/**
 * 卡操作（CardOp）的纯逻辑：把全局 agent 产出的原始对象**逐条容错收敛**为合规 CardOp（normalizeOps），
 * 并在应用前**逐 op 校验**（validateOps）——目标存在、typeId 在册、预取名不撞、parent 无环、
 * **破坏性收边**（结构性 op 只作用「待办」列的卡）。无 fs / 无 IPC，main 与 renderer 共享。
 */

import type {
  CandidateCard,
  CardArchetype,
  CardOp,
  CardOpKind,
  OpIssue,
  SplitEdgeInherit,
  StoredCard
} from './types'
import type { TypeArchetypeMap } from './card-type'
import { coerceCandidateCard, coerceRelations } from './decomposition'
import { CARD_RELATION_KINDS, isTodoCard, validateCandidateCard } from './requirement-card'

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function coerceAdjustPatch(v: unknown): { title?: string; description?: string; typeId?: string } | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const patch: { title?: string; description?: string; typeId?: string } = {}
  if (typeof o.title === 'string') patch.title = o.title
  if (typeof o.description === 'string') patch.description = o.description
  if (typeof o.typeId === 'string' && o.typeId.trim() !== '') patch.typeId = o.typeId.trim()
  return Object.keys(patch).length > 0 ? patch : null
}

/** 逐条容错把原始对象收敛为一个合规 CardOp；无法收敛（缺关键字段/未知 kind）返回 null。 */
function coerceOp(raw: unknown): CardOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  switch (o.kind) {
    case 'create': {
      const card = coerceCandidateCard(o.card)
      return card ? { kind: 'create', card } : null
    }
    case 'adjust': {
      const target = str(o.target)
      const patch = coerceAdjustPatch(o.patch)
      return target && patch ? { kind: 'adjust', target, patch } : null
    }
    case 'split': {
      const source = str(o.source)
      const into = Array.isArray(o.into)
        ? (o.into.map(coerceCandidateCard).filter((c): c is CandidateCard => c !== null))
        : []
      if (!source || into.length === 0) return null
      const edgeInherit: SplitEdgeInherit = o.edgeInherit === 'none' ? 'none' : 'all'
      return { kind: 'split', source, into, edgeInherit }
    }
    case 'merge': {
      const sources = Array.isArray(o.sources) ? o.sources.map(str).filter((s) => s !== '') : []
      if (sources.length === 0) return null
      let into: string | CandidateCard
      if (typeof o.into === 'string') into = o.into.trim()
      else {
        const card = coerceCandidateCard(o.into)
        if (!card) return null
        into = card
      }
      if (typeof into === 'string' && into === '') return null
      const mergedDescription = typeof o.mergedDescription === 'string' ? o.mergedDescription : undefined
      return { kind: 'merge', sources, into, mergedDescription }
    }
    case 'relate': {
      const from = str(o.from)
      const op = o.op === 'remove' ? 'remove' : 'add'
      const edge = coerceRelations([o.edge])[0]
      return from && edge ? { kind: 'relate', op, from, edge } : null
    }
    default:
      return null
  }
}

/** 逐条容错收敛一批原始 op 为合规 CardOp[]（丢弃无法收敛的，不抛异常）。 */
export function normalizeOps(raw: unknown): CardOp[] {
  if (!Array.isArray(raw)) return []
  return raw.map(coerceOp).filter((o): o is CardOp => o !== null)
}

/** validateOps 上下文：现有卡（判目标存在/待办/archetype）+ 类型注册表（判 typeId 在册/archetype）。 */
export interface ValidateOpsContext {
  cards: StoredCard[]
  registry: TypeArchetypeMap
}

/** 逐 op 校验结果：非法 op 收进 issues（带 index/kind/可读原因），合法者不产 issue。 */
export interface OpsValidation {
  issues: OpIssue[]
}

/**
 * 逐 op 校验：目标存在、typeId 在册、预取名不撞、结构性 op 目标在待办（破坏性收边）、parent 指向容器且无环。
 * 不抛异常，把每处问题收进 issues 供审阅界面逐条提示、不静默丢弃。
 */
export function validateOps(ops: CardOp[], ctx: ValidateOpsContext): OpsValidation {
  const { cards, registry } = ctx
  const byName = new Map(cards.map((c) => [c.proposedName, c]))
  const archetypeOf = (name: string): CardArchetype | undefined => {
    const c = byName.get(name)
    return c ? registry.get(c.typeId) : undefined
  }
  const isTodo = (name: string): boolean => {
    const c = byName.get(name)
    return c ? isTodoCard(c, archetypeOf(name)) : false
  }
  const issues: OpIssue[] = []
  const push = (index: number, kind: CardOpKind, reason: string): void => {
    issues.push({ index, kind, reason })
  }

  // create 会引入新预取名，纳入撞名检测（既有卡 + 本批已建）。
  const introduced = new Set(byName.keys())
  const collide = (name: string): boolean => introduced.has(name)

  const validateNewCard = (index: number, kind: CardOpKind, card: CandidateCard): void => {
    const v = validateCandidateCard(card, registry)
    if (!v.ok) push(index, kind, v.reason)
    else if (collide(card.proposedName)) push(index, kind, `预取名「${card.proposedName}」已存在或重复`)
    else introduced.add(card.proposedName)
  }

  ops.forEach((op, index) => {
    switch (op.kind) {
      case 'create':
        validateNewCard(index, 'create', op.card)
        break
      case 'adjust': {
        if (!byName.has(op.target)) return push(index, 'adjust', `目标卡「${op.target}」不存在`)
        if (!isTodo(op.target)) return push(index, 'adjust', `卡「${op.target}」已离开待办列，不做跨卡结构修改（改为建议新建需求）`)
        if (op.patch.typeId && !registry.has(op.patch.typeId)) push(index, 'adjust', `类型「${op.patch.typeId}」未在项目类型注册表中在册`)
        break
      }
      case 'split': {
        if (!byName.has(op.source)) return push(index, 'split', `源卡「${op.source}」不存在`)
        if (!isTodo(op.source)) return push(index, 'split', `源卡「${op.source}」已离开待办列，不可拆（改为建议新建需求）`)
        if (op.into.length === 0) return push(index, 'split', '拆分产物为空')
        op.into.forEach((c) => validateNewCard(index, 'split', c))
        break
      }
      case 'merge': {
        if (op.sources.length < 2) return push(index, 'merge', '合并至少需要两张源卡')
        for (const s of op.sources) {
          if (!byName.has(s)) push(index, 'merge', `源卡「${s}」不存在`)
          else if (!isTodo(s)) push(index, 'merge', `源卡「${s}」已离开待办列，不可合并（改为建议新建需求）`)
        }
        if (typeof op.into === 'string') {
          if (!byName.has(op.into)) push(index, 'merge', `目标卡「${op.into}」不存在`)
          else if (!isTodo(op.into)) push(index, 'merge', `目标卡「${op.into}」已离开待办列，不可作为合并目标`)
        } else {
          validateNewCard(index, 'merge', op.into)
        }
        break
      }
      case 'relate': {
        if (!byName.has(op.from)) return push(index, 'relate', `卡「${op.from}」不存在`)
        if (!isTodo(op.from)) return push(index, 'relate', `卡「${op.from}」已离开待办列，不做关系结构修改`)
        if (!CARD_RELATION_KINDS.includes(op.edge.kind)) return push(index, 'relate', `关系类型「${op.edge.kind}」非法`)
        if (!op.edge.target) return push(index, 'relate', '关系目标为空')
        if (op.edge.target === op.from) return push(index, 'relate', '不能对自身建立关系（自环）')
        if (!byName.has(op.edge.target)) return push(index, 'relate', `关系目标「${op.edge.target}」不存在`)
        // parent 关系（from 的父是 target）要求 target 是容器；child 关系（from 挂 target 为子）要求 from 是容器。
        if (op.op === 'add') {
          if (op.edge.kind === 'parent' && archetypeOf(op.edge.target) !== 'container') push(index, 'relate', `父卡「${op.edge.target}」不是容器（container），不能挂子卡`)
          if (op.edge.kind === 'child' && archetypeOf(op.from) !== 'container') push(index, 'relate', `卡「${op.from}」不是容器（container），不能挂子卡`)
          if ((op.edge.kind === 'parent' || op.edge.kind === 'child') && wouldCycle(op.from, op.edge, byName)) push(index, 'relate', '该层级关系会形成环')
        }
        break
      }
    }
  })
  return { issues }
}

/**
 * 层级加边是否成环：把 `relate add parent/child` 归一为一条有向父边 child→parent，
 * 再看 parent 是否已能沿现有父边到达 child（可达即成环）。
 */
function wouldCycle(from: string, edge: { kind: string; target: string }, byName: Map<string, StoredCard>): boolean {
  // 归一到 (child, parent)：parent 边＝from 的父是 target；child 边＝from 挂 target 为子（即 target 的父是 from）。
  const child = edge.kind === 'parent' ? from : edge.target
  const parent = edge.kind === 'parent' ? edge.target : from
  if (child === parent) return true
  // 从 parent 沿现有 parent 边上行，若能到达 child，则新边成环。
  const seen = new Set<string>()
  let frontier = [parent]
  while (frontier.length) {
    const next: string[] = []
    for (const name of frontier) {
      if (name === child) return true
      if (seen.has(name)) continue
      seen.add(name)
      const c = byName.get(name)
      if (!c) continue
      for (const r of c.relations) if (r.kind === 'parent') next.push(r.target)
    }
    frontier = next
  }
  return false
}
