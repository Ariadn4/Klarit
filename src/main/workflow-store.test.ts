import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowDefinition } from '../shared/types'
import { createDefaultWorkflow } from '../shared/workflow'
import { serializeWorkflow, parseWorkflow, createWorkflowStore } from './workflow-store'

let base: string
let ext: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'klarit-wf-'))
  ext = mkdtempSync(join(tmpdir(), 'klarit-ext-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(ext, { recursive: true, force: true })
})

function store() {
  return createWorkflowStore(base)
}

describe('serialize / parse 往返', () => {
  it('YAML 序列化再解析得到等价定义', () => {
    const def = createDefaultWorkflow('wf-1')
    const round = parseWorkflow(serializeWorkflow(def))
    expect(round).toEqual(def)
  })

  it('往返保持 newRequirementInstruction（file 形态）', () => {
    const def = { ...createDefaultWorkflow('wf-1'), newRequirementInstruction: { kind: 'file' as const, path: 'skills/decompose.md' } }
    const round = parseWorkflow(serializeWorkflow(def))
    expect(round.newRequirementInstruction).toEqual({ kind: 'file', path: 'skills/decompose.md' })
  })

  it('解析损坏 YAML 抛错（由调用方捕获）', () => {
    expect(() => parseWorkflow(':\n  - [unclosed')).toThrow()
  })
})

describe('save / get 往返与校验', () => {
  it('保存合法定义后 get 读回等价，落在 <id>/workflow.yaml', () => {
    const s = store()
    const def = createDefaultWorkflow('wf-a')
    expect(s.save(def)).toEqual({ ok: true })
    expect(existsSync(join(base, 'wf-a', 'workflow.yaml'))).toBe(true)
    expect(s.get('wf-a')).toEqual(def)
  })

  it('保存非法定义返回原因且不写盘', () => {
    const s = store()
    const bad: WorkflowDefinition = { id: 'wf-b', name: {}, stages: [], nodes: [] }
    const r = s.save(bad)
    expect(r.ok).toBe(false)
    expect(existsSync(join(base, 'wf-b'))).toBe(false)
    expect(s.get('wf-b')).toBeNull()
  })

  it('get 不存在的工作流返回 null', () => {
    expect(store().get('nope')).toBeNull()
  })
})

describe('list 与损坏包', () => {
  it('列出合法包、跳过损坏包，不抛错', () => {
    const s = store()
    s.save(createDefaultWorkflow('wf-1'))
    s.save({ ...createDefaultWorkflow('wf-2'), name: { zh: '流程二' } })
    // 损坏包
    mkdirSync(join(base, 'broken'), { recursive: true })
    writeFileSync(join(base, 'broken', 'workflow.yaml'), ':\n  - [unclosed', 'utf8')
    const list = s.list()
    expect(list.map((w) => w.id).sort()).toEqual(['wf-1', 'wf-2'])
    expect(list.find((w) => w.id === 'wf-2')?.name).toEqual({ zh: '流程二' })
  })

  it('base 目录不存在时 list 返回空', () => {
    const s = createWorkflowStore(join(base, 'nonexistent'))
    expect(s.list()).toEqual([])
  })
})

describe('create / clone / remove', () => {
  it('create 用注入 id 建包+默认模板', () => {
    const s = store()
    const def = s.create('new-1')
    expect(def.id).toBe('new-1')
    expect(s.get('new-1')).toEqual(def)
  })

  it('clone 复制整包（含 skill 文件），源不变，新 id', () => {
    const s = store()
    s.create('src')
    s.writeSkillFile('src', 'review.md', '# 审查')
    const cloned = s.clone('src', 'copy')
    expect(cloned?.id).toBe('copy')
    expect(existsSync(join(base, 'copy', 'skills', 'review.md'))).toBe(true)
    expect(readFileSync(join(base, 'copy', 'skills', 'review.md'), 'utf8')).toBe('# 审查')
    // 源不变
    expect(s.get('src')?.id).toBe('src')
    expect(existsSync(join(base, 'src', 'skills', 'review.md'))).toBe(true)
  })

  it('clone 源不存在返回 null', () => {
    expect(store().clone('nope', 'x')).toBeNull()
  })

  it('remove 删除整个包目录', () => {
    const s = store()
    s.create('gone')
    s.writeSkillFile('gone', 'a.md', 'x')
    s.remove('gone')
    expect(existsSync(join(base, 'gone'))).toBe(false)
    expect(s.get('gone')).toBeNull()
  })
})

describe('skill 文件管理', () => {
  it('writeSkillFile 写入包内并返回相对包路径', () => {
    const s = store()
    s.create('wf')
    const rel = s.writeSkillFile('wf', 'plan.md', '# 计划')
    expect(rel).toBe('skills/plan.md')
    expect(readFileSync(join(base, 'wf', 'skills', 'plan.md'), 'utf8')).toBe('# 计划')
  })

  it('importSkillFile 把外部文件拷入包，返回相对包路径', () => {
    const s = store()
    s.create('wf')
    const src = join(ext, 'external.md')
    writeFileSync(src, '外部内容', 'utf8')
    const rel = s.importSkillFile('wf', src)
    expect(rel).toBe('skills/external.md')
    expect(readFileSync(join(base, 'wf', 'skills', 'external.md'), 'utf8')).toBe('外部内容')
  })

  it('readSkillFile 按相对包路径读回内容；越界/缺失返回 null', () => {
    const s = store()
    s.create('wf')
    const rel = s.writeSkillFile('wf', 'plan.md', '# 计划')
    expect(s.readSkillFile('wf', rel)).toBe('# 计划')
    expect(s.readSkillFile('wf', 'skills/missing.md')).toBeNull()
    expect(s.readSkillFile('wf', '../../escape.md')).toBeNull()
    expect(s.readSkillFile('wf', 'C:\\abs.md')).toBeNull()
  })
})

describe('旧包形状迁移', () => {
  it('读旧 workflow.yaml（旧产出/检查项、无 exec）归一为新形状且可读', () => {
    const s = store()
    const oldYaml = [
      'id: old-wf',
      'name: 旧流程',
      'stages:',
      '  - id: s1',
      '    name: 开发',
      'nodes:',
      '  - id: n1',
      '    name: 写报告',
      '    stageId: s1',
      '    executor:',
      '      kind: agent',
      '      instruction:',
      '        kind: inline',
      '        text: 干活',
      '    outputs:',
      '      - type: report',
      '        format: md',
      '        path: docs/r.md',
      '        required: true',
      '      - type: note', // 无路径→卡片数据→丢弃
      '        format: text',
      '        required: false',
      '    gate:',
      '      - kind: auto', // 无命令→丢弃
      '        description: 客观',
      '      - kind: manual',
      '        description: 人工'
    ].join('\n')
    mkdirSync(join(base, 'old-wf'), { recursive: true })
    writeFileSync(join(base, 'old-wf', 'workflow.yaml'), oldYaml, 'utf8')
    const def = s.get('old-wf')
    expect(def).not.toBeNull()
    expect(def?.nodes[0].outputs).toEqual([
      { destination: { kind: 'file', path: 'docs/r.md' }, template: { kind: 'none' }, required: true }
    ])
    expect(def?.nodes[0].gate).toEqual([{ kind: 'manual' }])
    expect(def?.nodes[0].executor).toEqual({ kind: 'agent', instruction: { kind: 'inline', text: '干活' } })
  })
})

describe('seedIfEmpty', () => {
  it('库为空时种入默认工作流', () => {
    const s = store()
    s.seedIfEmpty('seed')
    expect(s.list().map((w) => w.id)).toEqual(['seed'])
  })

  it('库非空时不种入、不覆盖', () => {
    const s = store()
    s.create('existing')
    s.seedIfEmpty('seed')
    expect(s.list().map((w) => w.id)).toEqual(['existing'])
  })
})

describe('import / export 包', () => {
  it('exportPackage 写出含 workflow.yaml 与 skill 文件的包', () => {
    const s = store()
    s.create('wf')
    s.writeSkillFile('wf', 'r.md', 'rr')
    const dest = join(ext, 'exported')
    s.exportPackage('wf', dest)
    expect(existsSync(join(dest, 'workflow.yaml'))).toBe(true)
    expect(readFileSync(join(dest, 'skills', 'r.md'), 'utf8')).toBe('rr')
  })

  it('importPackage 整包导入并分配新 id', () => {
    const s = store()
    s.create('wf')
    s.writeSkillFile('wf', 'r.md', 'rr')
    const dest = join(ext, 'exported')
    s.exportPackage('wf', dest)
    const imported = s.importPackage(dest, 'fresh-id')
    expect(imported.id).toBe('fresh-id')
    expect(existsSync(join(base, 'fresh-id', 'skills', 'r.md'))).toBe(true)
  })

  it('importPackage 损坏包抛错', () => {
    const s = store()
    const dest = join(ext, 'bad')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'workflow.yaml'), ':\n  - [unclosed', 'utf8')
    expect(() => s.importPackage(dest, 'x')).toThrow()
  })
})
