import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_AGENTS,
  listSupportedAgents,
  modelsForAgent,
  coerceDefaultAgentId,
  coerceDefaultModel,
  coerceEffort,
  clampEffortToHigh,
  agentSupportsSubagents
} from './agents'

describe('listSupportedAgents', () => {
  it('返回内置受支持 agent 列表（至少含 claude-code/codex/cursor）', () => {
    const ids = listSupportedAgents().map((a) => a.id)
    expect(ids).toContain('claude-code')
    expect(ids).toContain('codex')
    expect(ids).toContain('cursor')
  })

  it('每个 agent 都带稳定 id、展示名、探测命令与模型清单', () => {
    for (const a of listSupportedAgents()) {
      expect(typeof a.id).toBe('string')
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.command.length).toBeGreaterThan(0)
      expect(Array.isArray(a.models)).toBe(true)
    }
  })
})

describe('modelsForAgent', () => {
  it('返回某 agent 的模型清单，每个模型含 id 与展示名', () => {
    const models = modelsForAgent('claude-code')
    expect(models.length).toBeGreaterThan(0)
    for (const m of models) {
      expect(typeof m.id).toBe('string')
      expect(m.name.length).toBeGreaterThan(0)
    }
  })

  it('未知 agent 返回空清单而非报错', () => {
    expect(modelsForAgent('nope' as never)).toEqual([])
  })

  it('claude-code 建议表含别名条目且排在最前（自动跟随最新）', () => {
    const ids = modelsForAgent('claude-code').map((m) => m.id)
    expect(ids.slice(0, 3)).toEqual(['opus', 'sonnet', 'haiku'])
  })

  it('claude-code 建议表含 Fable 5 与 Sonnet 5 的钉死 id', () => {
    const ids = modelsForAgent('claude-code').map((m) => m.id)
    expect(ids).toContain('claude-fable-5')
    expect(ids).toContain('claude-sonnet-5')
  })
})

describe('coerceDefaultAgentId', () => {
  it('受支持 id 原样返回', () => {
    expect(coerceDefaultAgentId('codex')).toBe('codex')
  })

  it('非受支持 / 非字符串返回 undefined（视为未选择）', () => {
    expect(coerceDefaultAgentId('nope')).toBeUndefined()
    expect(coerceDefaultAgentId(undefined)).toBeUndefined()
    expect(coerceDefaultAgentId(123)).toBeUndefined()
  })
})

describe('coerceDefaultModel', () => {
  it('模型属于建议清单时原样返回', () => {
    const model = SUPPORTED_AGENTS[0].models[0].id
    expect(coerceDefaultModel(SUPPORTED_AGENTS[0].id, model)).toBe(model)
  })

  it('建议清单外的任意非空字符串放行（新模型 / 别名无需等发版）', () => {
    expect(coerceDefaultModel('claude-code', 'claude-fable-6-preview')).toBe('claude-fable-6-preview')
    expect(coerceDefaultModel('codex', 'gpt-6-turbo')).toBe('gpt-6-turbo')
  })

  it('空白字符串收敛为 undefined（视为未选择）', () => {
    expect(coerceDefaultModel('claude-code', '')).toBeUndefined()
    expect(coerceDefaultModel('claude-code', '   ')).toBeUndefined()
  })

  it('agent 未选择 / 未知时返回 undefined', () => {
    expect(coerceDefaultModel(undefined, 'whatever')).toBeUndefined()
    expect(coerceDefaultModel('nope' as never, 'whatever')).toBeUndefined()
  })

  it('model 非字符串时返回 undefined', () => {
    expect(coerceDefaultModel('claude-code', undefined)).toBeUndefined()
    expect(coerceDefaultModel('claude-code', 42)).toBeUndefined()
  })
})

describe('coerceEffort', () => {
  it('合法枚举原样返回（含 claude 完整档位 xhigh/max 与关键词档 ultracode）', () => {
    expect(coerceEffort('low')).toBe('low')
    expect(coerceEffort('medium')).toBe('medium')
    expect(coerceEffort('high')).toBe('high')
    expect(coerceEffort('xhigh')).toBe('xhigh')
    expect(coerceEffort('max')).toBe('max')
    expect(coerceEffort('ultracode')).toBe('ultracode')
  })

  it('枚举外 / 空 / 非字符串收敛为 undefined（跟随 agent 默认）', () => {
    expect(coerceEffort('ultra')).toBeUndefined()
    expect(coerceEffort('')).toBeUndefined()
    expect(coerceEffort(undefined)).toBeUndefined()
    expect(coerceEffort(42)).toBeUndefined()
  })
})

describe('clampEffortToHigh', () => {
  it('xhigh/max/ultracode 收敛为 high（供档位止于 high 的家，如 codex）', () => {
    expect(clampEffortToHigh('xhigh')).toBe('high')
    expect(clampEffortToHigh('max')).toBe('high')
    expect(clampEffortToHigh('ultracode')).toBe('high')
  })

  it('low/medium/high 原样返回', () => {
    expect(clampEffortToHigh('low')).toBe('low')
    expect(clampEffortToHigh('medium')).toBe('medium')
    expect(clampEffortToHigh('high')).toBe('high')
  })
})

describe('agentSupportsSubagents', () => {
  it('支持子 agent 的运行时返回真（claude-code 有 Task/子 agent 能力）', () => {
    expect(agentSupportsSubagents('claude-code')).toBe(true)
  })

  it('不确定/不支持子 agent 的运行时保守返回假（串行退化）', () => {
    // codex/cursor 无确证的子 agent 能力 → 保守走串行。
    expect(agentSupportsSubagents('codex')).toBe(false)
    expect(agentSupportsSubagents('cursor')).toBe(false)
  })

  it('未选择 / 未知运行时返回假（保守，不因误判并行而失败）', () => {
    expect(agentSupportsSubagents(undefined)).toBe(false)
    expect(agentSupportsSubagents('nope')).toBe(false)
    expect(agentSupportsSubagents(123 as never)).toBe(false)
  })
})
