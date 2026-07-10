/** 项目目录派生逻辑（main 与 renderer 共用，避免漂移）。 */

import type { Project } from './types'

/** 去掉末尾分隔符后按 `/` 或 `\` 切段。 */
function segments(p: string): string[] {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/)
}

/** Windows 盘符根（如 `F:`）补回分隔符，保证可作为目录列出。 */
function denormalizeRoot(joined: string, sep: string): string {
  return /^[A-Za-z]:$/.test(joined) ? joined + sep : joined
}

/**
 * 多个成员仓路径的公共父目录。成员是容器的直接子目录，故其路径的段级公共前缀即容器目录。
 * 路径分散在不同父目录时退化为它们的最近公共祖先。
 */
function commonParentDir(paths: string[]): string {
  const sep = paths[0].includes('\\') ? '\\' : '/'
  let common = segments(paths[0])
  for (const p of paths.slice(1)) {
    const segs = segments(p)
    let i = 0
    while (i < common.length && i < segs.length && common[i] === segs[i]) i++
    common = common.slice(0, i)
  }
  return denormalizeRoot(common.join(sep), sep)
}

/**
 * 项目目录（侧边栏文件树视图的根）——由成员仓的最近已知路径派生，而非另存绝对路径：
 * - 单仓项目取其唯一成员的路径；
 * - 多仓项目取各成员仓的公共父目录（即容器目录）。
 * 成员路径靠 `.klarit/project-id` 在重新导入时刷新，故项目目录在换机器/同步后自动归位。
 */
export function projectRootPath(project: Project): string {
  const paths = project.members.map((m) => m.rootPath).filter(Boolean)
  if (paths.length === 0) return ''
  if (paths.length === 1) return paths[0]
  return commonParentDir(paths)
}
