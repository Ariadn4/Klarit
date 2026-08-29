/**
 * agent 习惯痕迹的**廉价探测**（agent-habits），两件事、共用同一标记集：
 *
 * - `hasAgentHabits`：**存在性门控**——只回答「这个项目带不带值得学的 agent 使用痕迹」，用于工作流
 *   onboarding 判据门控。
 * - `enumerateHabitPaths`：**路径枚举**——回答「在哪」，产出命中的具体路径，供 `habit-context` 逐字物化备料。
 *
 * 两者**并存不互相取代**，且都**绝不读取/解析/预抽取痕迹内容**（深读与解读是 author agent 自身职责；
 * 物化只做逐字复制，同样不解析）。**项目级**——只看各成员仓根目录，不碰用户 home（如 `~/.claude`）。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * agent 习惯痕迹标记集（相对成员仓根）。命中任一即算「有习惯」。可扩展。
 * 尾斜杠仅表意（目录）；实际只做路径存在性判断，不区分文件/目录。
 */
export const AGENT_HABIT_MARKERS = [
  '.claude/',
  'CLAUDE.md',
  '.cursor/',
  'AGENTS.md',
  '.codex',
  '.github/'
] as const

/** 去掉标记的表意尾斜杠，得到可拼接的真实名。 */
function markerName(marker: string): string {
  return marker.replace(/\/+$/, '')
}

/**
 * 是否带 agent 习惯痕迹：任一成员仓根命中任一标记即 true。纯存在性检查，
 * `exists` 默认走真实 fs（`existsSync`），测试可注入桩。
 */
export function hasAgentHabits(
  memberRoots: string[],
  exists: (p: string) => boolean = existsSync
): boolean {
  return memberRoots.some((root) =>
    AGENT_HABIT_MARKERS.some((marker) => exists(join(root, markerName(marker))))
  )
}

/** 一条命中的痕迹路径：所属成员仓根 + 命中的标记（原样，含表意尾斜杠）+ 真实绝对路径。 */
export interface HabitPathHit {
  /** 命中所在的成员仓根（原样传入值）。 */
  memberRoot: string
  /** 命中的标记，取自 `AGENT_HABIT_MARKERS`（原样，目录标记带表意尾斜杠）。 */
  marker: string
  /** 命中的真实路径（`memberRoot` + 去尾斜杠的标记名）；可能是文件也可能是目录。 */
  path: string
}

/**
 * 枚举各成员仓命中的**具体痕迹路径**（答「在哪」，与 `hasAgentHabits` 的「有没有」并存）。
 * 与门控**共用同一标记集** `AGENT_HABIT_MARKERS`，不另维护一份。只做路径存在性判断——
 * **不打开、不读取、不解析**任何命中内容。按成员仓顺序、标记集顺序产出，`exists` 可注入桩。
 */
export function enumerateHabitPaths(
  memberRoots: string[],
  exists: (p: string) => boolean = existsSync
): HabitPathHit[] {
  const hits: HabitPathHit[] = []
  for (const memberRoot of memberRoots) {
    for (const marker of AGENT_HABIT_MARKERS) {
      const path = join(memberRoot, markerName(marker))
      if (exists(path)) hits.push({ memberRoot, marker, path })
    }
  }
  return hits
}
