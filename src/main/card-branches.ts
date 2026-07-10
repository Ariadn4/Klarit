/**
 * 从运行的每成员派生上下文映射出卡面「逐成员仓已建分支条目」(供 `cardBranches` IPC)。
 * 纯逻辑:门控是「该成员仓**本地分支已建出**」(由注入的 `branchExists` 判定),而非 worktree 是否落地——
 * 分支一建出即展示;worktree 有无交给 git 视图处理(有则看树、无则「暂未创建 worktree」空态)。
 */

import type { CardBranch, MemberDerived } from '../shared/types'

/** 过滤出分支已建出的成员,映射为卡面条目(以成员仓名 + 实际分支标识)。 */
export function cardBranchesView(
  members: Record<string, MemberDerived>,
  nameOf: (memberId: string) => string,
  branchExists: (repoPath: string, branch: string) => boolean
): CardBranch[] {
  return Object.values(members)
    .filter((m) => branchExists(m.repoPath, m.branch))
    .map((m) => ({ memberId: m.memberId, name: nameOf(m.memberId), branch: m.branch }))
}
