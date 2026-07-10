import { describe, it, expect } from 'vitest'
import type { CardTypeDef } from './types'
import {
  CARD_ARCHETYPES,
  DEFAULT_CARD_TYPES,
  coerceToRegisteredType,
  migrateCardTypeId,
  projectCardTypes,
  removeCardType,
  seedCardTypes,
  typeArchetypeMap,
  upsertCardType,
  validateCardTypeDef,
  validateSuggestedTypes
} from './card-type'

function typeDef(over: Partial<CardTypeDef> = {}): CardTypeDef {
  return { id: 'spike', name: '探路', description: '不确定性高、先探路不交付。', archetype: 'leaf', ...over }
}

describe('CARD_ARCHETYPES / DEFAULT_CARD_TYPES', () => {
  it('原型恰两个：container / leaf', () => {
    expect([...CARD_ARCHETYPES]).toEqual(['container', 'leaf'])
  })

  it('默认种子含 epic(container)/feature(leaf)/bug(leaf)', () => {
    const byId = new Map(DEFAULT_CARD_TYPES.map((t) => [t.id, t.archetype]))
    expect(byId.get('epic')).toBe('container')
    expect(byId.get('feature')).toBe('leaf')
    expect(byId.get('bug')).toBe('leaf')
  })

  it('默认种子每项都合法', () => {
    for (const t of DEFAULT_CARD_TYPES) expect(validateCardTypeDef(t)).toEqual({ ok: true })
  })
})

describe('typeArchetypeMap', () => {
  it('映射 typeId → archetype', () => {
    const m = typeArchetypeMap(DEFAULT_CARD_TYPES)
    expect(m.get('epic')).toBe('container')
    expect(m.get('feature')).toBe('leaf')
    expect(m.has('nope')).toBe(false)
  })
})

describe('validateCardTypeDef', () => {
  it('合法类型通过', () => {
    expect(validateCardTypeDef(typeDef())).toEqual({ ok: true })
  })
  it('空 id / 空 name 被拒', () => {
    expect(validateCardTypeDef(typeDef({ id: ' ' })).ok).toBe(false)
    expect(validateCardTypeDef(typeDef({ name: '' })).ok).toBe(false)
  })
  it('非法 archetype 被拒', () => {
    expect(validateCardTypeDef(typeDef({ archetype: 'flow' as never })).ok).toBe(false)
  })
  it('合法 color 通过、非法 color 被拒、缺省 color 通过', () => {
    expect(validateCardTypeDef(typeDef({ color: 'amber' })).ok).toBe(true)
    expect(validateCardTypeDef(typeDef({ color: 'cyan' })).ok).toBe(true)
    expect(validateCardTypeDef(typeDef({ color: 'rainbow' as never })).ok).toBe(false)
    expect(validateCardTypeDef(typeDef({ color: undefined })).ok).toBe(true)
  })
})

describe('默认类型带预置颜色', () => {
  it('epic/feature/bug 各有 color', () => {
    const byId = new Map(DEFAULT_CARD_TYPES.map((t) => [t.id, t.color]))
    expect(byId.get('epic')).toBe('violet')
    expect(byId.get('feature')).toBe('blue')
    expect(byId.get('bug')).toBe('red')
  })
})

describe('validateSuggestedTypes', () => {
  it('leaf 与 container 都通过（工作流可带容器与流通类型）', () => {
    const ok = [typeDef({ id: 'chore', name: '杂务' }), typeDef({ id: 'big', name: '大目标', archetype: 'container' })]
    expect(validateSuggestedTypes(ok)).toEqual({ ok: true })
  })
  it('含非法定义被拒', () => {
    const bad = [typeDef(), { id: '', name: 'x', description: '', archetype: 'leaf' as const }]
    expect(validateSuggestedTypes(bad).ok).toBe(false)
  })
  it('非数组被拒', () => {
    expect(validateSuggestedTypes('x' as never).ok).toBe(false)
  })
})

describe('项目类型数组纯逻辑', () => {
  it('projectCardTypes：undefined 回落默认、[] 尊重空', () => {
    expect(projectCardTypes(undefined).map((t) => t.id)).toContain('epic')
    expect(projectCardTypes([])).toEqual([])
  })
  it('upsertCardType：新增追加、同 id 替换、不改原数组', () => {
    const a = [typeDef({ id: 'x', name: '旧' })]
    const added = upsertCardType(a, typeDef({ id: 'y' }))
    expect(added.map((t) => t.id)).toEqual(['x', 'y'])
    const replaced = upsertCardType(a, typeDef({ id: 'x', name: '新' }))
    expect(replaced).toHaveLength(1)
    expect(replaced[0].name).toBe('新')
    expect(a[0].name).toBe('旧') // 原数组不变
  })
  it('removeCardType：移除指定 id', () => {
    expect(removeCardType([typeDef({ id: 'x' }), typeDef({ id: 'y' })], 'x').map((t) => t.id)).toEqual(['y'])
  })
  it('seedCardTypes：新 id 追加、已存在跳过、非法跳过', () => {
    const base = [typeDef({ id: 'x', name: '原始 x' })]
    const out = seedCardTypes(base, [
      typeDef({ id: 'x', name: '不该覆盖' }),
      typeDef({ id: 'spike', name: '探路' }),
      { id: '', name: 'bad', description: '', archetype: 'leaf' }
    ])
    expect(out.map((t) => t.id)).toEqual(['x', 'spike'])
    expect(out[0].name).toBe('原始 x') // 已存在不覆盖
  })
})

describe('coerceToRegisteredType', () => {
  const types = [...DEFAULT_CARD_TYPES] // epic / feature / bug
  it('在册 id 直接用', () => {
    expect(coerceToRegisteredType('feature', types)).toBe('feature')
    expect(coerceToRegisteredType('epic', types)).toBe('epic')
  })
  it('按显示名不区分大小写匹配（Feat→feature）', () => {
    expect(coerceToRegisteredType('Feat', types)).toBe('feature') // 'feature' 的 name 是 'Feat'
  })
  it('按 id 不区分大小写匹配（FEATURE→feature）', () => {
    expect(coerceToRegisteredType('FEATURE', types)).toBe('feature')
  })
  it('不认识的 typeId 兜底到第一个 leaf 类型', () => {
    expect(coerceToRegisteredType('story', types)).toBe('feature') // 第一个 leaf
  })
  it('types 空则原样返回', () => {
    expect(coerceToRegisteredType('whatever', [])).toBe('whatever')
  })
})

describe('migrateCardTypeId', () => {
  it('旧卡 category → typeId 原样映射', () => {
    expect(migrateCardTypeId({ category: 'epic', title: 'x' }).typeId).toBe('epic')
  })
  it('已有 typeId → 幂等保持', () => {
    expect(migrateCardTypeId({ typeId: 'feature', category: 'bug' }).typeId).toBe('feature')
  })
  it('既无 typeId 也无 category → 空串（留待校验判不在册）', () => {
    expect(migrateCardTypeId({ title: 'x' }).typeId).toBe('')
  })
})
