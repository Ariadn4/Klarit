import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { AGENT_HABIT_MARKERS, hasAgentHabits } from './agent-habits'

/**
 * 注入的存在性桩：给定各成员仓根「存在」的标记集合，返回一个只对这些拼接路径为真的 exists。
 * 用与实现一致的 `path.join` + 去尾斜杠拼路径，从而跨平台（Win `\` / posix `/`）都稳。
 */
function fakeExists(present: Record<string, string[]>): (p: string) => boolean {
  const set = new Set<string>()
  for (const [root, markers] of Object.entries(present)) {
    for (const m of markers) set.add(join(root, m.replace(/\/+$/, '')))
  }
  return (p: string) => set.has(p)
}

describe('agent-habits 存在性门控', () => {
  it('标记集至少覆盖约定的六项', () => {
    for (const m of ['.claude/', 'CLAUDE.md', '.cursor/', 'AGENTS.md', '.codex', '.github/']) {
      expect(AGENT_HABIT_MARKERS).toContain(m)
    }
  })

  it('空项目（无任何标记）→ false', () => {
    expect(hasAgentHabits(['/proj/a'], fakeExists({}))).toBe(false)
  })

  it('某根只有 CLAUDE.md → true', () => {
    expect(hasAgentHabits(['/proj/a'], fakeExists({ '/proj/a': ['CLAUDE.md'] }))).toBe(true)
  })

  it('某根只有 .cursor/ → true', () => {
    expect(hasAgentHabits(['/proj/a'], fakeExists({ '/proj/a': ['.cursor/'] }))).toBe(true)
  })

  it('多仓：仅一个成员命中即 true', () => {
    const roots = ['/proj/a', '/proj/b', '/proj/c']
    expect(hasAgentHabits(roots, fakeExists({ '/proj/b': ['AGENTS.md'] }))).toBe(true)
  })

  it('多仓：无一命中 → false', () => {
    const roots = ['/proj/a', '/proj/b']
    expect(hasAgentHabits(roots, fakeExists({}))).toBe(false)
  })

  it('空成员清单 → false', () => {
    expect(hasAgentHabits([], fakeExists({}))).toBe(false)
  })

  it('注入的 exists 桩被真正调用（不落真实 fs）', () => {
    const calls: string[] = []
    const spy = (p: string): boolean => {
      calls.push(p)
      return false
    }
    hasAgentHabits(['/nowhere'], spy)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((p) => p.includes('nowhere'))).toBe(true)
  })
})
