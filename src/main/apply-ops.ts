/**
 * apply-ops 派发器（card-ops-review-apply）：用户审阅确认后，把编排提案的**合法** op 逐条派发到
 * `card-store` 落库应用。应用前**再校验**（board 可能已变）——非法 op 带原因回报、不应用；破坏性 op
 * （split/merge/delete）须已获二次确认，否则跳过并回报。agent 不旁路人确认落盘——本派发器是唯一落库口，
 * decompose「描述想法」的纯 create 落库也收敛为其特例（全 create ops）。
 */

import type { ApplyOpsResult, CandidateCard, CardOp, OpIssue, StoredCard } from '../shared/types'
import { DESTRUCTIVE_OP_KINDS } from '../shared/types'
import type { TypeArchetypeMap } from '../shared/card-type'
import { validateOps } from '../shared/card-ops'
import type { CardStore } from './card-store'

export interface ApplyOpsInput {
  projectId: string
  ops: CardOp[]
  now: number
  registry: TypeArchetypeMap
  /** 新卡默认涉及仓（create/split/merge 新目标卡）。 */
  repos?: string[]
  /** 破坏性 op（split/merge）是否已获用户二次确认；未确认则跳过它们并回 issue。 */
  confirmedDestructive?: boolean
}

/** 把一批候选卡（全 create）包成 ops——供 decompose「描述想法」落库收敛为 applyOps 特例。 */
export function createOpsFromCandidates(cards: CandidateCard[]): CardOp[] {
  return cards.map((card) => ({ kind: 'create', card }))
}

export function applyOps(store: CardStore, input: ApplyOpsInput): ApplyOpsResult {
  const { projectId, ops, now, registry, repos, confirmedDestructive } = input
  const created: StoredCard[] = []
  const updated: StoredCard[] = []
  const removed: string[] = []
  const issues: OpIssue[] = []

  // 应用前再校验（board 可能自提案后变动）：非法 op 记 issue、跳过应用。
  const preIssues = validateOps(ops, { cards: store.list(projectId), registry }).issues
  const invalid = new Set(preIssues.map((i) => i.index))
  issues.push(...preIssues)

  // 阶段一：把所有合法 create op 合成**一次** store.create 批量落库——保留批内候选间关系互链
  // （decompose 常含批内 parent/child 互引；逐条 create 会丢互链）。issue 的 index 映射回原 op 下标。
  const createOps = ops.map((op, i) => ({ op, i })).filter(({ op, i }) => op.kind === 'create' && !invalid.has(i))
  if (createOps.length > 0) {
    const res = store.create({
      projectId,
      candidates: createOps.map(({ op }) => (op as Extract<CardOp, { kind: 'create' }>).card),
      now,
      registry,
      repos
    })
    created.push(...res.created)
    for (const ci of res.issues) issues.push({ index: createOps[ci.index]?.i ?? -1, kind: 'create', reason: ci.reason })
  }

  // 阶段二：其余 op（adjust/relate/split/merge）按序应用。
  ops.forEach((op, index) => {
    if (invalid.has(index) || op.kind === 'create') return
    if (DESTRUCTIVE_OP_KINDS.includes(op.kind) && !confirmedDestructive) {
      issues.push({ index, kind: op.kind, reason: '破坏性操作需二次确认后才能应用' })
      return
    }
    switch (op.kind) {
      case 'adjust': {
        const next = store.update(projectId, op.target, { ...op.patch, updatedAt: now })
        if (next) updated.push(next)
        else issues.push({ index, kind: 'adjust', reason: `卡「${op.target}」更新失败` })
        break
      }
      case 'relate': {
        if (op.op === 'add') {
          const res = store.addRelation({ projectId, from: op.from, edge: op.edge, registry })
          if (!res.ok) issues.push({ index, kind: 'relate', reason: res.reason })
        } else {
          store.removeRelation(projectId, op.from, op.edge)
        }
        break
      }
      case 'delete': {
        store.remove(projectId, op.target)
        removed.push(op.target)
        break
      }
      case 'split': {
        const res = store.splitCard({
          projectId,
          source: op.source,
          into: op.into,
          edgeInherit: op.edgeInherit ?? 'all',
          now,
          registry,
          repos
        })
        if (!res.ok) issues.push({ index, kind: 'split', reason: res.reason ?? '拆分失败' })
        else {
          created.push(...res.created)
          removed.push(op.source)
          for (const ci of res.issues) issues.push({ index, kind: 'split', reason: ci.reason })
        }
        break
      }
      case 'merge': {
        const res = store.mergeCards({
          projectId,
          sources: op.sources,
          into: op.into,
          mergedDescription: op.mergedDescription,
          now,
          registry,
          repos
        })
        if (!res.ok) issues.push({ index, kind: 'merge', reason: res.reason ?? '合并失败' })
        else {
          const survivor = typeof op.into === 'string' ? op.into : op.into.proposedName
          for (const s of op.sources) if (s !== survivor) removed.push(s)
          if (res.target) {
            if (typeof op.into === 'string') updated.push(res.target)
            else created.push(res.target)
          }
        }
        break
      }
    }
  })

  return { created, updated, removed, issues }
}
