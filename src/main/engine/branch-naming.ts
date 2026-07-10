/**
 * 分支/worktree 命名的纯逻辑:名字消毒、worktree 路径派生、尾号递增,以及**建分支统一递增避撞**。
 * 抽出为纯模块(不碰 git/fs)——冲突判定经 probe 注入,便于单测与在 engine 内复用。
 */

import { basename, dirname, join } from 'node:path'

/** 把分支名里 worktree 路径不友好的字符替换成连字符(用于派生 worktree 目录名)。 */
export const sanitize = (s: string): string => s.replace(/[^\w.-]+/g, '-')

/**
 * worktree 路径派生:repo 同级 `basename--wt--sanitize(branch)`。
 * `deriveMembers`(逐成员派生)与撞名解析共用此式,避免两处漂移。
 */
export function memberWorktreePath(repoPath: string, branch: string): string {
  return join(dirname(repoPath), `${basename(repoPath)}--wt--${sanitize(branch)}`)
}

/** 给名字递增尾号:`x`→`x-2`,`x-2`→`x-3`(对分支名与 worktree 路径同样适用)。 */
export function nextSuffixed(name: string): string {
  const m = name.match(/^(.*?)-(\d+)$/)
  return m ? `${m[1]}-${Number(m[2]) + 1}` : `${name}-2`
}

/** 撞名探测:分支是否已存在于某仓、某路径是否已占用(注入以便测试/复用)。 */
export interface BranchProbe {
  branchExists: (repoPath: string, branch: string) => boolean
  pathExists: (p: string) => boolean
}

/**
 * 统一递增解析:自 `startBranch` 起,逐档找一个在**所有**涉及仓「本地分支不存在 **且** 派生 worktree
 * 路径空闲」的名字。任一仓任一维度撞名即整档作废、`nextSuffixed` 进下一档,全仓共用同一名字
 * (**不逐仓分别递增**)——保「卡 slug = 各仓同名分支」不变量。纯函数:同 (start, members, probe) 恒定输出。
 */
export function resolveFreeBranch(
  startBranch: string,
  members: ReadonlyArray<{ repoPath: string }>,
  probe: BranchProbe
): string {
  const taken = (branch: string): boolean =>
    members.some(
      (m) =>
        probe.branchExists(m.repoPath, branch) || probe.pathExists(memberWorktreePath(m.repoPath, branch))
    )
  let candidate = startBranch
  // 上限兜底,避免病态输入下的死循环(现实里几档即命中)。
  for (let i = 0; i < 1000 && taken(candidate); i++) candidate = nextSuffixed(candidate)
  return candidate
}
