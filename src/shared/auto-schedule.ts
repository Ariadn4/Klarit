/**
 * 待办自动排程的纯逻辑：自动运行资格判定（隐式、`blocked_by` 硬门）、共享成员仓冲突粗筛、
 * 以及"填哪些槽"的规划。无 fs / 无 IPC，main 与 renderer 共享（同 shared/requirement-card.ts 的定位）。
 * agent 细判（冲突排序产出者）与运行启动接缝归 main（见 auto-scheduler / conflict-rank-producer）。
 */

import type { StoredCard } from './types'
import type { TypeArchetypeMap } from './card-type'

/** 只需 status/repos 的最小卡视图（供纯逻辑跨形态复用）。 */
type CardStatusView = Pick<StoredCard, 'status'>
type CardReposView = { repos: string[] }

/**
 * 一张卡**是否有资格被自动启动**——纯隐式判定，无每卡/全局开关。四条**同时**满足：
 * ① 原型为 `leaf`（container 恒不跑；typeId 不在册按非 leaf 处理）；
 * ② 在待办列：状态「未开始」且无 `activeRunId`；
 * ③ **`blocked_by` 硬门**：其每个 `blocked_by` 目标卡都已「已完成」（目标缺失按未满足保守处理）；
 * ④ `canDerive`：可派生出有效运行请求（`repos` 非空、项目有激活工作流——由调用方以 `deriveRunRequest` 算好注入）。
 * `blocked_by` 是硬门，不被"冲突最小"等软排序绕过。
 */
export function isAutoEligible(
  card: StoredCard,
  cardsById: ReadonlyMap<string, CardStatusView>,
  registry: TypeArchetypeMap,
  canDerive: boolean
): boolean {
  if (registry.get(card.typeId) !== 'leaf') return false
  if (card.status !== '未开始' || card.activeRunId) return false
  for (const r of card.relations ?? []) {
    if (r.kind !== 'blocked_by') continue
    const target = cardsById.get(r.target)
    if (!target || target.status !== '已完成') return false
  }
  return canDerive
}

/** 汇总一组在跑卡涉及的全部成员仓（去重）。 */
export function reposUnion(running: readonly CardReposView[]): Set<string> {
  const u = new Set<string>()
  for (const c of running) for (const r of c.repos ?? []) u.add(r)
  return u
}

/** 候选卡是否与在跑卡集合共享任一成员仓：不相交 → false（合并不可能冲突、冲突分 0）。 */
export function reposOverlap(candidateRepos: readonly string[], runningUnion: ReadonlySet<string>): boolean {
  return (candidateRepos ?? []).some((r) => runningUnion.has(r))
}

/**
 * 规划本轮应启动的卡序列（长度 ≤ freeSlots）——**确定性、即时、无 agent**：
 * - 空槽 ≤ 0 或无候选 → 空。
 * - 否则以**成员仓重叠**排序:**与在跑卡不共享仓的候选优先**(各按入列顺序)、其后接**共享仓的候选**(各按入列顺序),
 *   再按此顺序**填满空槽**(取前 K)。多仓下把并行错开到不同仓;单仓下所有卡共享唯一仓 → 退化为纯按序填槽。
 * `candidates` 须已按入列顺序传入(调用方排好);本函数**稳定**保持组内顺序。
 */
export function planFills(
  freeSlots: number,
  candidates: readonly StoredCard[],
  running: readonly CardReposView[]
): StoredCard[] {
  if (freeSlots <= 0 || candidates.length === 0) return []
  const union = reposUnion(running)
  const safe = candidates.filter((c) => !reposOverlap(c.repos, union)) // 与在跑不共享仓 → 优先
  const shared = candidates.filter((c) => reposOverlap(c.repos, union))
  return [...safe, ...shared].slice(0, freeSlots)
}
