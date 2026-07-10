import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultRulePack } from '../shared/rule-pack'
import type { RulePack } from '../shared/rule-pack'
import { serializeRulePack, parseRulePack, createRulePackStore } from './rule-pack-store'

let base: string
let ext: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'klarit-rp-'))
  ext = mkdtempSync(join(tmpdir(), 'klarit-rpext-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(ext, { recursive: true, force: true })
})

function store() {
  return createRulePackStore(base)
}

describe('serialize / parse 往返', () => {
  it('YAML 序列化再解析得到等价定义', () => {
    const def = createDefaultRulePack('rp-1')
    expect(parseRulePack(serializeRulePack(def))).toEqual(def)
  })

  it('含多语言与开放语言键的包往返等价（无丢失）', () => {
    const def: RulePack = {
      id: 'multi',
      name: { zh: '多语言包', en: 'Multilingual', fr: 'Multilingue' },
      description: { en: 'only english desc' },
      items: [
        { kind: 'constitution-rule', id: 'r1', name: { zh: '规则', en: 'Rule' }, text: { zh: '正文', fr: 'corps' } },
        { kind: 'output-template', id: 't1', name: { en: 'Tpl' }, content: { en: '## H' } },
        { kind: 'objective-check', id: 'c1', name: { zh: '校验', en: 'Check' }, command: 'npm test' }
      ]
    }
    expect(parseRulePack(serializeRulePack(def))).toEqual(def)
  })

  it('解析损坏 YAML 抛错', () => {
    expect(() => parseRulePack(':\n  - [unclosed')).toThrow()
  })
})

describe('save / get / list 与校验', () => {
  it('保存合法包后 get 等价、落在 <id>/rule-pack.yaml', () => {
    const s = store()
    const def = createDefaultRulePack('rp-a')
    expect(s.save(def)).toEqual({ ok: true })
    expect(existsSync(join(base, 'rp-a', 'rule-pack.yaml'))).toBe(true)
    expect(s.get('rp-a')).toEqual(def)
  })

  it('保存非法包返回原因且不写盘', () => {
    const s = store()
    const r = s.save({ id: 'rp-b', name: {}, items: [] })
    expect(r.ok).toBe(false)
    expect(existsSync(join(base, 'rp-b'))).toBe(false)
  })

  it('list 跳过损坏包不抛错', () => {
    const s = store()
    s.save(createDefaultRulePack('rp-1'))
    mkdirSync(join(base, 'broken'), { recursive: true })
    writeFileSync(join(base, 'broken', 'rule-pack.yaml'), ':\n  - [unclosed', 'utf8')
    expect(s.list().map((p) => p.id)).toEqual(['rp-1'])
  })

  it('all 返回完整定义', () => {
    const s = store()
    s.save(createDefaultRulePack('rp-1'))
    expect(s.all().map((p) => p.id)).toEqual(['rp-1'])
  })
})

describe('create / clone / remove / seedIfEmpty', () => {
  it('create 用注入 id 建包+默认模板', () => {
    const s = store()
    expect(s.create('new-1').id).toBe('new-1')
    expect(s.get('new-1')?.id).toBe('new-1')
  })

  it('clone 复制整包，源不变，新 id', () => {
    const s = store()
    s.create('src')
    const cloned = s.clone('src', 'copy')
    expect(cloned?.id).toBe('copy')
    expect(s.get('src')?.id).toBe('src')
  })

  it('remove 删整个包目录', () => {
    const s = store()
    s.create('gone')
    s.remove('gone')
    expect(s.get('gone')).toBeNull()
  })

  it('seedIfEmpty 空库种入、非空不重复', () => {
    const s = store()
    s.seedIfEmpty('seed')
    expect(s.list().map((p) => p.id)).toEqual(['seed'])
    s.seedIfEmpty('seed2')
    expect(s.list().map((p) => p.id)).toEqual(['seed'])
  })
})

describe('import / export', () => {
  it('export 写出包、import 整包导入并分配新 id', () => {
    const s = store()
    s.create('rp')
    const dest = join(ext, 'exported')
    s.exportPackage('rp', dest)
    expect(existsSync(join(dest, 'rule-pack.yaml'))).toBe(true)
    const imported = s.importPackage(dest, 'fresh')
    expect(imported.id).toBe('fresh')
    expect(s.get('fresh')?.id).toBe('fresh')
  })

  it('import 损坏包抛错', () => {
    const s = store()
    const dest = join(ext, 'bad')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'rule-pack.yaml'), ':\n  - [unclosed', 'utf8')
    expect(() => s.importPackage(dest, 'x')).toThrow()
  })
})
