/**
 * agent 习惯痕迹的**廉价存在性门控**（agent-habits）：只回答「这个项目带不带值得学的 agent 使用痕迹」，
 * 用于工作流 onboarding 判据门控。**只做存在性判断**——绝不读取/解析/预抽取痕迹内容（深读与解读是
 * author agent 自身职责）。**项目级**——只看各成员仓根目录，不碰用户 home（如 `~/.claude`）。
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
