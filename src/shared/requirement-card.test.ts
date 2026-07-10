import { describe, it, expect } from 'vitest'
import type { CandidateCard, RequirementCard } from './types'
import {
  CARD_RELATION_KINDS,
  CARD_STATUSES,
  isValidProposedName,
  toProposedName,
  dedupeProposedName,
  validateCandidateCard,
  validateRequirementCard,
  newRequirementCard,
  isTodoCard
} from './requirement-card'
import { DEFAULT_CARD_TYPES, typeArchetypeMap } from './card-type'

const REGISTRY = typeArchetypeMap(DEFAULT_CARD_TYPES)

function candidate(over: Partial<CandidateCard> = {}): CandidateCard {
  return {
    proposedName: 'add-dark-mode',
    title: '增加暗色模式',
    description: '## goals\n给整个界面增加一套暗色主题。',
    typeId: 'feature',
    relations: [],
    ...over
  }
}

describe('isValidProposedName', () => {
  it('接受 git 友好 slug', () => {
    expect(isValidProposedName('add-dark-mode')).toBe(true)
    expect(isValidProposedName('bug-42')).toBe(true)
    expect(isValidProposedName('a')).toBe(true)
  })

  it('拒绝空格 / 斜杠 / 大写 / 起止连字符 / 空串', () => {
    expect(isValidProposedName('Add Dark/Mode')).toBe(false)
    expect(isValidProposedName('Add-Dark')).toBe(false)
    expect(isValidProposedName('a/b')).toBe(false)
    expect(isValidProposedName('-lead')).toBe(false)
    expect(isValidProposedName('trail-')).toBe(false)
    expect(isValidProposedName('double--hyphen')).toBe(false)
    expect(isValidProposedName('')).toBe(false)
  })
})

describe('toProposedName', () => {
  it('把含中文与括号的标题规整为合法 slug', () => {
    const slug = toProposedName('增加暗色模式 (Dark Mode)')
    expect(slug).toBe('dark-mode')
    expect(isValidProposedName(slug)).toBe(true)
  })

  it('全非 ASCII 标题回落到非空合法 slug', () => {
    const slug = toProposedName('增加暗色模式')
    expect(isValidProposedName(slug)).toBe(true)
  })
})

describe('dedupeProposedName', () => {
  it('无冲突原样返回', () => {
    expect(dedupeProposedName('add-dark-mode', [])).toBe('add-dark-mode')
  })

  it('冲突时加数字后缀去重', () => {
    expect(dedupeProposedName('feat', ['feat'])).toBe('feat-2')
    expect(dedupeProposedName('feat', ['feat', 'feat-2'])).toBe('feat-3')
  })
})

describe('validateCandidateCard', () => {
  it('合法候选（类型在册）通过', () => {
    expect(validateCandidateCard(candidate(), REGISTRY)).toEqual({ ok: true })
  })

  it('未提供注册表时类型判不在册（纯逻辑不自读注册表）', () => {
    expect(validateCandidateCard(candidate()).ok).toBe(false)
  })

  it('typeId 不在册被拒', () => {
    expect(validateCandidateCard(candidate({ typeId: 'spike' }), REGISTRY).ok).toBe(false)
  })

  it('空 typeId 被拒', () => {
    expect(validateCandidateCard(candidate({ typeId: '' }), REGISTRY).ok).toBe(false)
  })

  it('空标题被拒', () => {
    expect(validateCandidateCard(candidate({ title: '  ' }), REGISTRY).ok).toBe(false)
  })

  it('非法预取名被拒', () => {
    expect(validateCandidateCard(candidate({ proposedName: 'Add Dark/Mode' }), REGISTRY).ok).toBe(false)
  })

  it('非法关系类型被拒', () => {
    const bad = candidate({ relations: [{ kind: 'depends' as never, target: 'x' }] })
    expect(validateCandidateCard(bad, REGISTRY).ok).toBe(false)
  })

  it('关系 target 须为非空字符串', () => {
    const bad = candidate({ relations: [{ kind: 'blocked_by', target: '' }] })
    expect(validateCandidateCard(bad, REGISTRY).ok).toBe(false)
  })

  it('合法关系边通过', () => {
    const ok = candidate({ relations: [{ kind: 'parent', target: 'dark-mode-epic' }] })
    expect(validateCandidateCard(ok, REGISTRY)).toEqual({ ok: true })
  })

  it('leaf 卡声明 child 关系（挂子卡）非法', () => {
    const bad = candidate({ typeId: 'feature', relations: [{ kind: 'child', target: 'sub' }] })
    expect(validateCandidateCard(bad, REGISTRY).ok).toBe(false)
  })

  it('container 卡声明 child 关系（挂子卡）合法', () => {
    const ok = candidate({ typeId: 'epic', relations: [{ kind: 'child', target: 'sub' }] })
    expect(validateCandidateCard(ok, REGISTRY)).toEqual({ ok: true })
  })
})

describe('validateRequirementCard / newRequirementCard', () => {
  it('由候选构造的卡默认未开始且带时间戳', () => {
    const card = newRequirementCard(candidate(), 1000)
    expect(card.status).toBe('未开始')
    expect(card.createdAt).toBe(1000)
    expect(card.updatedAt).toBe(1000)
    expect(validateRequirementCard(card, REGISTRY)).toEqual({ ok: true })
  })

  it('完整卡往返字段保持', () => {
    const card: RequirementCard = {
      ...candidate({ relations: [{ kind: 'coupled_with', target: 'other-card' }] }),
      status: '进行中',
      createdAt: 1,
      updatedAt: 2
    }
    expect(validateRequirementCard(card, REGISTRY)).toEqual({ ok: true })
  })

  it('非法状态被拒', () => {
    const card = { ...newRequirementCard(candidate(), 1), status: '搁置' as never }
    expect(validateRequirementCard(card, REGISTRY).ok).toBe(false)
  })

  it('暴露封闭词表常量', () => {
    expect(CARD_STATUSES).toContain('未开始')
    expect(CARD_RELATION_KINDS).toContain('coupled_with')
  })
})

describe('isTodoCard（破坏性收边的待办门控）', () => {
  it('container 卡恒在待办、可结构操作', () => {
    expect(isTodoCard({ status: '未开始' }, 'container')).toBe(true)
    // container 恒在待办列，即便挂了运行态字段也当待办处理。
    expect(isTodoCard({ status: '进行中', activeRunId: 'r1' }, 'container')).toBe(true)
  })

  it('leaf 卡：未开始且无运行 → 待办可操作', () => {
    expect(isTodoCard({ status: '未开始' }, 'leaf')).toBe(true)
    expect(isTodoCard({ status: '未开始', activeRunId: undefined }, 'leaf')).toBe(true)
  })

  it('leaf 卡：有 activeRunId → 已离开待办、不可结构操作', () => {
    expect(isTodoCard({ status: '未开始', activeRunId: 'r1' }, 'leaf')).toBe(false)
  })

  it('leaf 卡：进行中/已暂停/等待决策/已完成 → 已离开待办', () => {
    expect(isTodoCard({ status: '进行中' }, 'leaf')).toBe(false)
    expect(isTodoCard({ status: '已暂停' }, 'leaf')).toBe(false)
    expect(isTodoCard({ status: '等待决策' }, 'leaf')).toBe(false)
    expect(isTodoCard({ status: '已完成' }, 'leaf')).toBe(false)
  })

  it('未知 archetype 按 leaf 保守处理（未开始无运行才算待办）', () => {
    expect(isTodoCard({ status: '未开始' }, undefined)).toBe(true)
    expect(isTodoCard({ status: '已完成' }, undefined)).toBe(false)
  })
})
