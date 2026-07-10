import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { CardTypeDef, StoredCard, WorkflowDefinition } from '@shared/types'
import { KanbanBoard } from './KanbanBoard'

function wf(stages: { id: string; name: string }[]): WorkflowDefinition {
  return { id: 'w', name: { zh: 'W' }, stages: stages.map((s) => ({ id: s.id, name: { zh: s.name } })), nodes: [] }
}

const TYPES: CardTypeDef[] = [
  { id: 'feat', name: 'Feature', description: '', archetype: 'leaf' },
  { id: 'epic', name: 'Epic', description: '', archetype: 'container' }
]

function card(over: Partial<StoredCard> & { proposedName: string }): StoredCard {
  return {
    title: over.proposedName,
    description: '',
    typeId: 'feat',
    relations: [],
    status: '未开始',
    createdAt: 0,
    updatedAt: 0,
    projectId: 'p',
    repos: [],
    ...over
  }
}

function board(props: Partial<Parameters<typeof KanbanBoard>[0]> = {}): React.JSX.Element {
  return (
    <KanbanBoard
      activeWorkflow={props.activeWorkflow ?? null}
      cards={props.cards ?? []}
      cardTypes={props.cardTypes ?? TYPES}
      runs={props.runs ?? {}}
    />
  )
}

describe('KanbanBoard', () => {
  it('有阶段时渲染「待办」+各阶段+「已完成」列', () => {
    render(
      board({
        activeWorkflow: wf([
          { id: 's1', name: '开发' },
          { id: 's2', name: '测试' }
        ])
      })
    )
    for (const name of ['待办', '开发', '测试', '已完成']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('activeWorkflow 为 null 时只渲染两列书挡', () => {
    render(board({ activeWorkflow: null }))
    expect(screen.getByRole('region', { name: '待办' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '已完成' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '开发' })).not.toBeInTheDocument()
  })

  it('切换激活工作流时中间阶段列实时重算、书挡列不变', () => {
    const { rerender } = render(board({ activeWorkflow: wf([{ id: 's1', name: '开发' }]) }))
    expect(screen.getByRole('region', { name: '开发' })).toBeInTheDocument()

    rerender(board({ activeWorkflow: wf([{ id: 'r1', name: '评审' }]) }))
    expect(screen.queryByRole('region', { name: '开发' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '评审' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '待办' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '已完成' })).toBeInTheDocument()
  })

  it('未开始的 leaf 卡渲染在「待办」列；container 卡也停「待办」', () => {
    render(
      board({
        activeWorkflow: wf([{ id: 's1', name: '开发' }]),
        cards: [
          card({ proposedName: 'leaf-card', title: '叶子卡' }),
          card({ proposedName: 'epic-card', title: '容器卡', typeId: 'epic' })
        ]
      })
    )
    const todo = screen.getByRole('region', { name: '待办' })
    expect(within(todo).getByText('叶子卡')).toBeInTheDocument()
    expect(within(todo).getByText('容器卡')).toBeInTheDocument()
  })

  it('已完成的 leaf 卡渲染在「已完成」列', () => {
    render(
      board({
        activeWorkflow: wf([{ id: 's1', name: '开发' }]),
        cards: [card({ proposedName: 'done-card', title: '完成卡', status: '已完成' })]
      })
    )
    const done = screen.getByRole('region', { name: '已完成' })
    expect(within(done).getByText('完成卡')).toBeInTheDocument()
  })
})
