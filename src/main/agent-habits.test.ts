import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { AGENT_HABIT_MARKERS, enumerateHabitPaths, hasAgentHabits } from './agent-habits'

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

describe('enumerateHabitPaths 痕迹枚举（答「在哪」，与门控并存）', () => {
  it('某仓有 CLAUDE.md 与 .cursor/ → 枚举出这两条具体路径（带真实绝对路径与所属仓根）', () => {
    const hits = enumerateHabitPaths(['/proj/a'], fakeExists({ '/proj/a': ['CLAUDE.md', '.cursor/'] }))
    expect(hits.map((h) => h.marker).sort()).toEqual(['.cursor/', 'CLAUDE.md'])
    expect(hits.map((h) => h.path).sort()).toEqual(
      [join('/proj/a', 'CLAUDE.md'), join('/proj/a', '.cursor')].sort()
    )
    expect(hits.every((h) => h.memberRoot === '/proj/a')).toBe(true)
  })

  it('多仓多标记 → 每条命中都带所属成员仓根，互不混淆', () => {
    const hits = enumerateHabitPaths(
      ['/proj/a', '/proj/b'],
      fakeExists({ '/proj/a': ['CLAUDE.md'], '/proj/b': ['CLAUDE.md', 'AGENTS.md'] })
    )
    expect(hits).toHaveLength(3)
    expect(hits.filter((h) => h.memberRoot === '/proj/a').map((h) => h.marker)).toEqual(['CLAUDE.md'])
    expect(hits.filter((h) => h.memberRoot === '/proj/b').map((h) => h.marker).sort()).toEqual([
      'AGENTS.md',
      'CLAUDE.md'
    ])
  })

  it('无痕迹 → 空清单', () => {
    expect(enumerateHabitPaths(['/proj/a', '/proj/b'], fakeExists({}))).toEqual([])
    expect(enumerateHabitPaths([], fakeExists({}))).toEqual([])
  })

  it('与存在性门控共用同一标记集：逐个标记单独命中都被枚举到，且枚举不产出标记集之外的条目', () => {
    for (const marker of AGENT_HABIT_MARKERS) {
      const exists = fakeExists({ '/proj/a': [marker] })
      // 门控答「有没有」、枚举答「在哪」——同一标记集，同进同出。
      expect(hasAgentHabits(['/proj/a'], exists)).toBe(true)
      const hits = enumerateHabitPaths(['/proj/a'], exists)
      expect(hits.map((h) => h.marker)).toEqual([marker])
    }
    // 标记集之外的痕迹不被枚举（不各自维护一份清单）。
    const other = enumerateHabitPaths(['/proj/a'], fakeExists({ '/proj/a': ['Makefile', 'docs/CONTRIBUTING.md'] }))
    expect(other).toEqual([])
  })

  it('门控与枚举对同一项目同进同出（有痕迹 ⟺ 枚举非空）', () => {
    const cases: Record<string, string[]>[] = [
      {},
      { '/proj/a': ['CLAUDE.md'] },
      { '/proj/b': ['.github/'] },
      { '/proj/a': ['.claude/'], '/proj/b': ['.codex'] }
    ]
    for (const present of cases) {
      const exists = fakeExists(present)
      const roots = ['/proj/a', '/proj/b']
      expect(enumerateHabitPaths(roots, exists).length > 0).toBe(hasAgentHabits(roots, exists))
    }
  })

  it('注入的 exists 桩被真正调用（不落真实 fs）', () => {
    const calls: string[] = []
    enumerateHabitPaths(['/nowhere'], (p) => {
      calls.push(p)
      return false
    })
    expect(calls.length).toBe(AGENT_HABIT_MARKERS.length)
  })
})
