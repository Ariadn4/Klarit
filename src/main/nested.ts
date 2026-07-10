import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { NestedRepoCandidate } from '../shared/types'
import { IGNORED_DIRS } from './filetree'
import { makeGitRunner, probeGit } from './git'

/**
 * 扫描容器目录的直接子目录（depth 1），返回其中「自身就是仓库根」的 git 子仓。
 * 跳过 IGNORED_DIRS；只在容器自身非 git 时才有意义（由调用方保证）。
 */
export function scanNestedRepos(containerDir: string): NestedRepoCandidate[] {
  let entries
  try {
    entries = readdirSync(containerDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: NestedRepoCandidate[] = []
  for (const e of entries) {
    if (!e.isDirectory() || IGNORED_DIRS.has(e.name)) continue
    const child = join(containerDir, e.name)
    const probe = probeGit(child, makeGitRunner(child))
    // 必须是该子目录自己就是仓库根（toplevel == child），排除「整个容器其实在某个外层仓里」的情况。
    if (probe.isGit && probe.toplevel && resolve(probe.toplevel) === resolve(child)) {
      out.push({ rootPath: child, name: e.name })
    }
  }
  return out
}
