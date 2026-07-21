import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_AGENTS,
  listSupportedAgents,
  modelsForAgent,
  coerceDefaultAgentId,
  coerceDefaultModel,
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
  it('模型属于该 agent 时原样返回', () => {
    const model = SUPPORTED_AGENTS[0].models[0].id
    expect(coerceDefaultModel(SUPPORTED_AGENTS[0].id, model)).toBe(model)
  })

  it('模型不属于该 agent 时返回 undefined（清除不匹配）', () => {
    const otherAgent = SUPPORTED_AGENTS[1]
    const foreignModel = SUPPORTED_AGENTS[0].models[0].id
    // 仅当该模型确实不在 otherAgent 清单内才有意义
    if (!otherAgent.models.some((m) => m.id === foreignModel)) {
      expect(coerceDefaultModel(otherAgent.id, foreignModel)).toBeUndefined()
    }
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
