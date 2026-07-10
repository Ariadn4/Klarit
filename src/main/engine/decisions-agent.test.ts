import { describe, it, expect } from 'vitest'
import { buildAgentDecision } from './decisions'
import type { AgentHandshake } from '../../shared/types'

describe('buildAgentDecision — sourceKind=agent', () => {
  it('选项取自握手 decision.options（原始 label）、freeInput 给自由输入、问题进 reason', () => {
    const hs: AgentHandshake = {
      status: 'need-decision',
      decision: {
        title: '接口用 REST 还是 GraphQL？',
        options: [
          { id: 'rest', label: '用 REST', recommended: true },
          { id: 'graphql', label: '用 GraphQL', detail: '更灵活但复杂' }
        ],
        multi: false,
        freeInput: true
      },
      note: '前端已搭好壳'
    }
    const d = buildAgentDecision('n1', '实现接口', hs)
    expect(d.sourceKind).toBe('agent')
    expect(d.source).toBe('n1:agent-ask')
    expect(d.options.map((o) => o.id)).toEqual(['rest', 'graphql'])
    expect(d.options[0]).toMatchObject({ id: 'rest', label: '用 REST', recommended: true })
    expect(d.options[1]).toMatchObject({ label: '用 GraphQL', detail: '更灵活但复杂' })
    expect(d.input).toBeTruthy() // freeInput → 自由输入
    expect(d.reason).toBe('接口用 REST 还是 GraphQL？')
  })

  it('agent 没给选项时兜底一个前进式「继续」选项（不留死结）', () => {
    const d = buildAgentDecision('n1', '节点', { status: 'need-decision', decision: { title: '拿不准' } })
    expect(d.options.length).toBeGreaterThanOrEqual(1)
    expect(d.options.every((o) => o.label || o.labelKey)).toBe(true)
  })

  it('无 freeInput 不给自由输入框', () => {
    const d = buildAgentDecision('n1', '节点', {
      status: 'need-decision',
      decision: { options: [{ id: 'a', label: 'A' }] }
    })
    expect(d.input).toBeUndefined()
  })
})
