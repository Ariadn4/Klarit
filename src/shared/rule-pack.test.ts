import { describe, it, expect } from 'vitest'
import type { RulePack, ConstitutionGovernance, Localized } from './rule-pack'
import {
  validateRulePack,
  createDefaultRulePack,
  rulePackSummary,
  listItemsByKind,
  deriveEffectiveConstitution,
  resolveLocalized,
  migrateRulePackShape
} from './rule-pack'

/** 造一个只含一条宪法规则的合法双语包（可覆盖）。 */
function pack(over: Partial<RulePack> = {}): RulePack {
  return {
    id: 'rp-1',
    name: { zh: '默认包', en: 'Default pack' },
    items: [{ kind: 'constitution-rule', id: 'r1', name: { zh: '测试先行', en: 'Test-First' }, text: { zh: '先写测试', en: 'Write tests first' } }],
    ...over
  }
}

describe('resolveLocalized', () => {
  const field: Localized = { zh: '中文', en: 'English' }

  it('命中当前语言', () => {
    expect(resolveLocalized(field, 'zh')).toBe('中文')
    expect(resolveLocalized(field, 'en')).toBe('English')
  })

  it('当前语言缺失时回退英语', () => {
    expect(resolveLocalized({ en: 'only-en' }, 'zh')).toBe('only-en')
  })

  it('英语也缺失时回退到仅有的语言（有啥用啥）', () => {
    expect(resolveLocalized({ fr: 'seulement-fr' }, 'zh')).toBe('seulement-fr')
    expect(resolveLocalized({ fr: 'seulement-fr' }, 'en')).toBe('seulement-fr')
  })

  it('空表返回空串', () => {
    expect(resolveLocalized({}, 'zh')).toBe('')
    expect(resolveLocalized(undefined, 'zh')).toBe('')
  })

  it('忽略空串条目，继续回退', () => {
    expect(resolveLocalized({ zh: '   ', en: 'E' }, 'zh')).toBe('E')
  })

  it('非法/不支持语言按默认解析、不崩', () => {
    // 不支持语言归一后走默认（zh）→ en → 仅有
    expect(resolveLocalized({ zh: 'Z', en: 'E' }, 'fr')).toBe('Z')
    expect(resolveLocalized({ en: 'E' }, 'fr')).toBe('E')
  })
})

describe('validateRulePack', () => {
  it('完整合法（双语）规则包通过', () => {
    expect(validateRulePack(pack())).toEqual({ ok: true })
  })

  it('单语言字段也合法（部分翻译允许）', () => {
    expect(validateRulePack(pack({ name: { en: 'Only EN' } })).ok).toBe(true)
    expect(
      validateRulePack(
        pack({ items: [{ kind: 'constitution-rule', id: 'r', name: { en: 'N' }, text: { fr: 'seulement' } }] })
      ).ok
    ).toBe(true)
  })

  it('id 为空判非法', () => {
    expect(validateRulePack(pack({ id: '' })).ok).toBe(false)
  })

  it('包名无任何语言判非法', () => {
    expect(validateRulePack(pack({ name: {} })).ok).toBe(false)
    expect(validateRulePack(pack({ name: { zh: '  ' } })).ok).toBe(false)
  })

  it('条目 id 在包内重复判非法', () => {
    const dup = pack({
      items: [
        { kind: 'constitution-rule', id: 'x', name: { en: 'A' }, text: { en: 'a' } },
        { kind: 'output-template', id: 'x', name: { en: 'B' }, content: { en: 'b' } }
      ]
    })
    const r = validateRulePack(dup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/重复|x/)
  })

  it('可翻字段无任何非空语言判非法（各类型）', () => {
    expect(validateRulePack(pack({ items: [{ kind: 'constitution-rule', id: 'r', name: { en: 'N' }, text: {} }] })).ok).toBe(false)
    expect(validateRulePack(pack({ items: [{ kind: 'output-template', id: 'r', name: { en: 'N' }, content: { en: '  ' } }] })).ok).toBe(false)
  })

  it('结构字段（命令）为空判非法', () => {
    expect(validateRulePack(pack({ items: [{ kind: 'objective-check', id: 'r', name: { en: 'N' }, command: '' }] })).ok).toBe(false)
  })

  it('条目类型非法判非法', () => {
    expect(validateRulePack(pack({ items: [{ kind: 'nope', id: 'r', name: { en: 'N' } } as never] })).ok).toBe(false)
  })

  it('空条目列表合法（允许空包）', () => {
    expect(validateRulePack(pack({ items: [] })).ok).toBe(true)
  })
})

describe('createDefaultRulePack', () => {
  it('用注入 id 生成合法、含「测试先行」等宪法规则的默认包', () => {
    const def = createDefaultRulePack('seed')
    expect(def.id).toBe('seed')
    expect(validateRulePack(def)).toEqual({ ok: true })
    const rules = def.items.filter((i) => i.kind === 'constitution-rule')
    expect(rules.length).toBeGreaterThanOrEqual(3)
    expect(rules.some((r) => r.id === 'test-first')).toBe(true)
  })

  it('所有可翻字段同时含 zh 与 en', () => {
    const def = createDefaultRulePack('seed')
    expect(def.name.zh && def.name.en).toBeTruthy()
    for (const it of def.items) {
      expect(it.name.zh && it.name.en).toBeTruthy()
      if (it.kind === 'constitution-rule') expect(it.text.zh && it.text.en).toBeTruthy()
      if (it.kind === 'output-template') expect(it.content.zh && it.content.en).toBeTruthy()
    }
  })

  it('zh 与 en 下条目结构逐字相同，仅文案不同', () => {
    const def = createDefaultRulePack('seed')
    // id / kind / 命令 跨语言不变（单一来源，本就与语言无关）
    expect(def.items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      'constitution-rule:test-first',
      'constitution-rule:abstraction',
      'constitution-rule:decoupling',
      'constitution-rule:user-language',
      'output-template:spec-template',
      'objective-check:run-tests'
    ])
    const check = def.items.find((i) => i.id === 'run-tests')
    expect(check?.kind === 'objective-check' && check.command).toBe('npm test')
    // 文案随语言不同
    const testFirst = def.items.find((i) => i.id === 'test-first')!
    expect(resolveLocalized(testFirst.name, 'zh')).not.toBe(resolveLocalized(testFirst.name, 'en'))
  })
})

describe('migrateRulePackShape', () => {
  it('旧裸字符串可翻字段 upcast 为 {zh:值}，命令保持单值', () => {
    const old = {
      id: 'rp',
      name: '默认规则包',
      description: '内置',
      items: [
        { kind: 'constitution-rule', id: 'r', name: '测试先行', text: '先写测试' },
        { kind: 'output-template', id: 't', name: '模板', content: '## 背景' },
        { kind: 'objective-check', id: 'c', name: '跑测试', command: 'npm test' }
      ]
    }
    const m = migrateRulePackShape(old)
    expect(m.name).toEqual({ zh: '默认规则包' })
    expect(m.description).toEqual({ zh: '内置' })
    const rule = m.items[0]
    expect(rule.kind === 'constitution-rule' && rule.name).toEqual({ zh: '测试先行' })
    expect(rule.kind === 'constitution-rule' && rule.text).toEqual({ zh: '先写测试' })
    const check = m.items[2]
    expect(check.kind === 'objective-check' && check.command).toBe('npm test')
    expect(validateRulePack(m)).toEqual({ ok: true })
  })

  it('对新（多语言）形状幂等', () => {
    const def = createDefaultRulePack('seed')
    expect(migrateRulePackShape(def)).toEqual(def)
  })
})

describe('rulePackSummary', () => {
  it('提取 id 与（多语言）name', () => {
    const s = rulePackSummary(pack({ id: 'x', name: { zh: '包 X', en: 'Pack X' } }))
    expect(s.id).toBe('x')
    expect(resolveLocalized(s.name, 'en')).toBe('Pack X')
  })
})

describe('listItemsByKind', () => {
  it('跨包按类型列出条目（带 packId）', () => {
    const packs: RulePack[] = [
      { id: 'p1', name: { en: 'P1' }, items: [{ kind: 'output-template', id: 't1', name: { en: 'T1' }, content: { en: 'c' } }, { kind: 'constitution-rule', id: 'r1', name: { en: 'R1' }, text: { en: 'x' } }] },
      { id: 'p2', name: { en: 'P2' }, items: [{ kind: 'output-template', id: 't2', name: { en: 'T2' }, content: { en: 'c' } }] }
    ]
    const tpls = listItemsByKind(packs, 'output-template')
    expect(tpls.map((x) => `${x.packId}/${x.item.id}`)).toEqual(['p1/t1', 'p2/t2'])
  })
})

describe('deriveEffectiveConstitution', () => {
  const packs: RulePack[] = [
    {
      id: 'p1',
      name: { en: 'P1' },
      items: [
        { kind: 'constitution-rule', id: 'R1', name: { zh: '规则1', en: 'Rule1' }, text: { zh: '甲', en: 'a' } },
        { kind: 'constitution-rule', id: 'R2', name: { zh: '规则2', en: 'Rule2' }, text: { zh: '乙', en: 'b' } },
        { kind: 'output-template', id: 'T', name: { en: 'T' }, content: { en: 'c' } },
        { kind: 'constitution-rule', id: 'R3', name: { en: 'Rule3' }, text: { en: 'd' } }
      ]
    }
  ]

  it('激活并集减去关闭项，且只含宪法规则、顺序稳定', () => {
    const gov: ConstitutionGovernance = { activePackIds: ['p1'], disabledRules: [{ packId: 'p1', itemId: 'R2' }] }
    expect(deriveEffectiveConstitution(packs, gov, 'zh').map((r) => r.itemId)).toEqual(['R1', 'R3'])
  })

  it('按语言解析出单语言 name/text', () => {
    const gov: ConstitutionGovernance = { activePackIds: ['p1'], disabledRules: [] }
    const zh = deriveEffectiveConstitution(packs, gov, 'zh')
    expect(zh[0]).toMatchObject({ itemId: 'R1', name: '规则1', text: '甲' })
    const en = deriveEffectiveConstitution(packs, gov, 'en')
    expect(en[0]).toMatchObject({ itemId: 'R1', name: 'Rule1', text: 'a' })
    // R3 只有 en：zh 下回退到 en
    expect(zh[2]).toMatchObject({ itemId: 'R3', name: 'Rule3', text: 'd' })
  })

  it('未激活任何包时为空', () => {
    expect(deriveEffectiveConstitution(packs, { activePackIds: [], disabledRules: [] }, 'zh')).toEqual([])
  })

  it('激活不存在的包安全跳过', () => {
    const gov: ConstitutionGovernance = { activePackIds: ['ghost', 'p1'], disabledRules: [] }
    expect(deriveEffectiveConstitution(packs, gov, 'en').map((r) => r.itemId)).toEqual(['R1', 'R2', 'R3'])
  })
})
