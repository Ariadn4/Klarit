import { describe, it, expect } from 'vitest'
import type { CandidateCard } from './types'
import { validateCandidateBatch, normalizeCandidateBatch } from './decomposition'
import { DEFAULT_CARD_TYPES, typeArchetypeMap } from './card-type'

const REGISTRY = typeArchetypeMap(DEFAULT_CARD_TYPES)

function card(over: Partial<CandidateCard> = {}): CandidateCard {
  return {
    proposedName: 'add-dark-mode',
    title: '增加暗色模式',
    description: '给界面加暗色主题',
    typeId: 'feature',
    relations: [],
    ...over
  }
}

describe('validateCandidateBatch', () => {
  it('全合法批通过、无 issue', () => {
    const batch = [card(), card({ proposedName: 'fix-login', title: '修登录', typeId: 'bug' })]
    expect(validateCandidateBatch(batch, REGISTRY)).toEqual({ ok: true, issues: [] })
  })

  it('单张不合卡模型 → 带 index 与原因', () => {
    const batch = [card(), card({ proposedName: 'bad name', title: '' })]
    const v = validateCandidateBatch(batch, REGISTRY)
    expect(v.ok).toBe(false)
    expect(v.issues.some((i) => i.index === 1)).toBe(true)
    expect(v.issues[0].reason).toBeTruthy()
  })

  it('typeId 不在册 → 进 issue、不静默回落', () => {
    const batch = [card({ typeId: 'spike' })]
    const v = validateCandidateBatch(batch, REGISTRY)
    expect(v.ok).toBe(false)
    expect(v.issues.some((i) => /spike|在册|类型/.test(i.reason))).toBe(true)
  })

  it('预取名本批内重复 → 标记重复', () => {
    const batch = [card(), card({ title: '另一张但同名' })]
    const v = validateCandidateBatch(batch, REGISTRY)
    expect(v.ok).toBe(false)
    expect(v.issues.some((i) => /重复|唯一/.test(i.reason))).toBe(true)
  })

  it('关系 target 未引用本批任何预取名 → 标记悬挂', () => {
    const batch = [card({ relations: [{ kind: 'parent', target: 'no-such-card' }] })]
    const v = validateCandidateBatch(batch, REGISTRY)
    expect(v.ok).toBe(false)
    expect(v.issues.some((i) => /no-such-card|关系|引用/.test(i.reason))).toBe(true)
  })

  it('parent 关系引用容器卡 → 通过', () => {
    const batch = [
      card({ proposedName: 'theme-epic', typeId: 'epic' }),
      card({ relations: [{ kind: 'parent', target: 'theme-epic' }] })
    ]
    expect(validateCandidateBatch(batch, REGISTRY)).toEqual({ ok: true, issues: [] })
  })

  it('parent 关系指向子叶卡（leaf 当父）→ 非法', () => {
    const batch = [
      card({ proposedName: 'a-feature', typeId: 'feature' }),
      card({ proposedName: 'child', relations: [{ kind: 'parent', target: 'a-feature' }] })
    ]
    const v = validateCandidateBatch(batch, REGISTRY)
    expect(v.ok).toBe(false)
    expect(v.issues.some((i) => /子叶|leaf|父卡/.test(i.reason))).toBe(true)
  })

  it('容器嵌套容器 → 通过', () => {
    const batch = [
      card({ proposedName: 'big-epic', typeId: 'epic' }),
      card({ proposedName: 'mid-epic', typeId: 'epic', relations: [{ kind: 'parent', target: 'big-epic' }] })
    ]
    expect(validateCandidateBatch(batch, REGISTRY)).toEqual({ ok: true, issues: [] })
  })
})

describe('normalizeCandidateBatch', () => {
  it('重名预取名加后缀去重，并同步改写指向它的关系 target', () => {
    const batch = [
      card({ proposedName: 'feat', title: 'A' }),
      card({ proposedName: 'feat', title: 'B' }),
      card({ proposedName: 'child', title: 'C', relations: [{ kind: 'blocked_by', target: 'feat' }] })
    ]
    const out = normalizeCandidateBatch(batch)
    expect(out.map((c) => c.proposedName)).toEqual(['feat', 'feat-2', 'child'])
    // 第三张原引用的 'feat' 指向第一张，保持不变（首张未改名）
    expect(out[2].relations[0].target).toBe('feat')
    // 规整后整批校验通过
    expect(validateCandidateBatch(out, REGISTRY).ok).toBe(true)
  })
})
