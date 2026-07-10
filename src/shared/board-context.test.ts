import { describe, it, expect } from 'vitest'
import type { CardTypeDef, StoredCard } from './types'
import { buildBoardContext, type BoardSnapshot } from './board-context'

const TYPES: CardTypeDef[] = [
  { id: 'epic', name: 'Epic', description: '', archetype: 'container' },
  { id: 'feat', name: 'Feat', description: '', archetype: 'leaf' }
]

function card(over: Partial<StoredCard>): StoredCard {
  return {
    proposedName: 'c',
    title: 'C',
    description: '',
    typeId: 'feat',
    relations: [],
    status: '未开始',
    createdAt: 1,
    updatedAt: 1,
    projectId: 'p1',
    repos: [],
    ...over
  }
}

function snap(over: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return { cards: [], types: TYPES, goals: '', constitution: [], ...over }
}

describe('buildBoardContext', () => {
  it('含目标、生效宪法、卡摘要与关系', () => {
    const ctx = buildBoardContext(
      snap({
        goals: '把项目做好',
        constitution: ['测试先行'],
        cards: [
          card({ proposedName: 'a', title: '卡A', relations: [{ kind: 'blocked_by', target: 'b' }] }),
          card({ proposedName: 'b', title: '卡B', createdAt: 2 })
        ]
      })
    )
    expect(ctx).toContain('把项目做好')
    expect(ctx).toContain('测试先行')
    expect(ctx).toContain('`a`')
    expect(ctx).toContain('blocked_by→b')
  })

  it('标注待办 vs 已流动', () => {
    const ctx = buildBoardContext(
      snap({
        cards: [
          card({ proposedName: 'todo', status: '未开始' }),
          card({ proposedName: 'run', status: '进行中', activeRunId: 'r1', createdAt: 2 })
        ]
      })
    )
    const todoLine = ctx.split('\n').find((l) => l.includes('`todo`')) ?? ''
    const runLine = ctx.split('\n').find((l) => l.includes('`run`')) ?? ''
    expect(todoLine).toContain('待办·可结构操作')
    expect(runLine).toContain('已流动·仅建议新建')
  })

  it('超预算确定性截断并标注省略卡数', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      card({ proposedName: `card-${i}`, title: `卡${i}`, description: 'x'.repeat(200), createdAt: i })
    )
    const ctx = buildBoardContext(snap({ cards: many, budgetChars: 800 }))
    expect(ctx).toMatch(/省略 \d+ 张卡/)
  })

  it('空项目给明确空态', () => {
    expect(buildBoardContext(snap())).toContain('暂无需求卡')
  })

  it('列出可用类型的 id（供 agent 用对 typeId）', () => {
    const ctx = buildBoardContext(snap())
    expect(ctx).toContain('可用类型')
    expect(ctx).toContain('`epic`')
    expect(ctx).toContain('`feat`')
  })

  it('列出可选工作流（id·name·类型 id，供新项目选择）', () => {
    const ctx = buildBoardContext(
      snap({ workflows: [{ id: 'wf-1', name: '标准流', types: [{ id: 'story', name: 'Story', description: '', archetype: 'leaf' }] }] })
    )
    expect(ctx).toContain('可选工作流')
    expect(ctx).toContain('`wf-1`')
    expect(ctx).toContain('标准流')
    expect(ctx).toContain('story')
  })
})
