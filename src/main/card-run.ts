/**
 * 从需求卡派生引擎运行请求（requirement-card-store「从卡派生运行请求」）。
 * 多仓扇出：取 `card.repos` 全集解析为 `RunRequest.repos`（一卡一运行，引擎在运行内扇出，见 engine-execution）；
 * `repoPath` 保留首仓作单仓退化/兼容。纯逻辑、可独立测。
 */

import type { Project, RunRepoTarget, RunRequest, StoredCard } from '../shared/types'

export type DeriveRunResult = { ok: true; request: RunRequest } | { ok: false; reason: string }

/**
 * 派生：`branch` = 卡预取名(slug)、`repos` = `card.repos` 全部涉及仓解析到的成员上下文（含标签）、
 * `repoPath` = 首仓 rootPath（单仓退化/兼容）、`workflowId` = 项目激活工作流、`cardId` = 卡 id(= 预取名)。
 * 缺前置条件（无激活工作流 / repos 为空 / 涉及仓不在项目）时不派生无效运行，回可读原因。
 */
export function deriveRunRequest(card: StoredCard, project: Project): DeriveRunResult {
  const workflowId = project.activeWorkflowId
  if (!workflowId) return { ok: false, reason: '项目未激活工作流，无法运行' }
  if (!card.repos.length) return { ok: false, reason: '卡未声明涉及的成员仓，无法运行' }
  const repos: RunRepoTarget[] = []
  for (const repoId of card.repos) {
    const member = project.members.find((m) => m.id === repoId)
    if (!member) return { ok: false, reason: `卡涉及的成员仓「${repoId}」不在项目中` }
    repos.push({ memberId: member.id, repoPath: member.rootPath, tag: member.tag })
  }
  return {
    ok: true,
    request: {
      workflowId,
      repoPath: repos[0].repoPath,
      repos,
      branch: card.proposedName,
      cardId: card.proposedName,
      // 卡运行默认开启统一递增避撞:新卡 slug 撞到遗留/人工同名分支时,引擎在 start 全仓统一另起下一档。
      avoidBranchConflict: true
    }
  }
}
