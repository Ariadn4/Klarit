import { describe, it, expect, vi } from 'vitest'
import type { AppSettings } from '../shared/types'
import {
  initSettings,
  setLanguage,
  setAppearance,
  setDefaultAgent,
  setDefaultModel,
  type SettingsDeps
} from './settings'

function deps(over: Partial<SettingsDeps> = {}): SettingsDeps {
  return {
    read: () => null,
    write: vi.fn(),
    systemLocale: () => 'en-US',
    ...over
  }
}

describe('initSettings 首启检测', () => {
  it('无已存语言时按系统语言初始化并持久化', () => {
    const write = vi.fn()
    const d = deps({ read: () => null, write, systemLocale: () => 'en-US' })
    const settings = initSettings(d)
    expect(settings.language).toBe('en')
    expect(write).toHaveBeenCalledWith({ language: 'en' })
  })

  it('系统语言为中文变体时初始化为 zh', () => {
    const settings = initSettings(deps({ systemLocale: () => 'zh-Hans-CN' }))
    expect(settings.language).toBe('zh')
  })

  it('系统语言不受支持时回退默认 zh', () => {
    const settings = initSettings(deps({ systemLocale: () => 'fr-FR' }))
    expect(settings.language).toBe('zh')
  })

  it('已有语言设置不被系统语言覆盖，也不写回', () => {
    const write = vi.fn()
    const d = deps({ read: () => ({ language: 'en' }), write, systemLocale: () => 'zh-CN' })
    const settings = initSettings(d)
    expect(settings.language).toBe('en')
    expect(write).not.toHaveBeenCalled()
  })

  it('设置文件损坏（read 返回 null）按首启安全恢复', () => {
    const write = vi.fn()
    const d = deps({ read: () => null, write, systemLocale: () => 'en-US' })
    const settings = initSettings(d)
    expect(settings.language).toBe('en')
    expect(write).toHaveBeenCalledOnce()
  })

  it('已存语言为非法值时收敛为默认', () => {
    const stored = { language: 'xx' } as unknown as AppSettings
    const settings = initSettings(deps({ read: () => stored }))
    expect(settings.language).toBe('zh')
  })
})

describe('initSettings 外观兜底', () => {
  it('已存设置无 appearance 时返回默认 system', () => {
    const settings = initSettings(deps({ read: () => ({ language: 'en' }) }))
    expect(settings.appearance).toBe('system')
  })

  it('已存合法 appearance 时沿用', () => {
    const stored = { language: 'en', appearance: 'dark' } as AppSettings
    const settings = initSettings(deps({ read: () => stored }))
    expect(settings.appearance).toBe('dark')
  })

  it('已存非法 appearance 时收敛为默认 system', () => {
    const stored = { language: 'en', appearance: 'blue' } as unknown as AppSettings
    const settings = initSettings(deps({ read: () => stored }))
    expect(settings.appearance).toBe('system')
  })

  it('首启（read 返回 null）时 appearance 为默认 system', () => {
    const settings = initSettings(deps({ read: () => null }))
    expect(settings.appearance).toBe('system')
  })
})

describe('setAppearance', () => {
  it('写入受支持外观并持久化，保留语言', () => {
    const write = vi.fn()
    const next = setAppearance({ language: 'zh', appearance: 'system' }, 'dark', { write })
    expect(next.appearance).toBe('dark')
    expect(next.language).toBe('zh')
    expect(write).toHaveBeenCalledWith({ language: 'zh', appearance: 'dark' })
  })

  it('写入非法值时回退默认 system，不写非法值', () => {
    const write = vi.fn()
    const next = setAppearance({ language: 'en', appearance: 'dark' }, 'blue', { write })
    expect(next.appearance).toBe('system')
    expect(write).toHaveBeenCalledWith({ language: 'en', appearance: 'system' })
  })
})

describe('setLanguage', () => {
  it('写入受支持语言并持久化', () => {
    const write = vi.fn()
    const next = setLanguage({ language: 'zh' }, 'en', { write })
    expect(next.language).toBe('en')
    expect(write).toHaveBeenCalledWith({ language: 'en' })
  })

  it('写入非法值时回退默认，不写非法值', () => {
    const write = vi.fn()
    const next = setLanguage({ language: 'en' }, 'xx', { write })
    expect(next.language).toBe('zh')
    expect(write).toHaveBeenCalledWith({ language: 'zh' })
  })
})

describe('initSettings 默认 agent / 模型加载', () => {
  it('已存合法 defaultAgent/defaultModel 时收敛后返回', () => {
    const stored = {
      language: 'zh',
      defaultAgent: 'claude-code',
      defaultModel: 'claude-opus-4-8'
    } as AppSettings
    const settings = initSettings(deps({ read: () => stored }))
    expect(settings.defaultAgent).toBe('claude-code')
    expect(settings.defaultModel).toBe('claude-opus-4-8')
  })

  it('已存非法 defaultAgent 收敛为未选择（undefined）', () => {
    const stored = { language: 'zh', defaultAgent: 'nope' } as unknown as AppSettings
    const settings = initSettings(deps({ read: () => stored }))
    expect(settings.defaultAgent).toBeUndefined()
  })

  it('defaultModel 不属于 defaultAgent 时被清除', () => {
    const stored = {
      language: 'zh',
      defaultAgent: 'codex',
      defaultModel: 'claude-opus-4-8'
    } as AppSettings
    const settings = initSettings(deps({ read: () => stored }))
    expect(settings.defaultAgent).toBe('codex')
    expect(settings.defaultModel).toBeUndefined()
  })

  it('首启（read 为 null）默认 agent/model 为未选择', () => {
    const settings = initSettings(deps({ read: () => null }))
    expect(settings.defaultAgent).toBeUndefined()
    expect(settings.defaultModel).toBeUndefined()
  })
})

describe('setDefaultAgent', () => {
  it('写入已检测到的受支持 agent 并持久化', () => {
    const write = vi.fn()
    const next = setDefaultAgent({ language: 'zh' }, 'codex', ['codex', 'cursor'], { write })
    expect(next.defaultAgent).toBe('codex')
    expect(write).toHaveBeenCalledWith({ language: 'zh', defaultAgent: 'codex', defaultModel: undefined })
  })

  it('未检测到（不在 allowed 内）的 agent 无副作用', () => {
    const write = vi.fn()
    const current: AppSettings = { language: 'zh', defaultAgent: 'cursor' }
    const next = setDefaultAgent(current, 'codex', ['cursor'], { write })
    expect(next).toBe(current)
    expect(write).not.toHaveBeenCalled()
  })

  it('非受支持值无副作用', () => {
    const write = vi.fn()
    const current: AppSettings = { language: 'zh' }
    const next = setDefaultAgent(current, 'nope', ['claude-code'], { write })
    expect(next).toBe(current)
    expect(write).not.toHaveBeenCalled()
  })

  it('切换 agent 后清除不属于新 agent 的旧模型', () => {
    const write = vi.fn()
    const current: AppSettings = {
      language: 'zh',
      defaultAgent: 'claude-code',
      defaultModel: 'claude-opus-4-8'
    }
    const next = setDefaultAgent(current, 'codex', ['claude-code', 'codex'], { write })
    expect(next.defaultAgent).toBe('codex')
    expect(next.defaultModel).toBeUndefined()
  })

  it('切换 agent 后保留同时属于新 agent 的模型', () => {
    const write = vi.fn()
    // claude-sonnet-4-6 同属 claude-code 与 cursor
    const current: AppSettings = {
      language: 'zh',
      defaultAgent: 'claude-code',
      defaultModel: 'claude-sonnet-4-6'
    }
    const next = setDefaultAgent(current, 'cursor', ['claude-code', 'cursor'], { write })
    expect(next.defaultAgent).toBe('cursor')
    expect(next.defaultModel).toBe('claude-sonnet-4-6')
  })
})

describe('setDefaultModel', () => {
  it('写入属于当前 agent 的模型并持久化', () => {
    const write = vi.fn()
    const current: AppSettings = { language: 'zh', defaultAgent: 'codex' }
    const next = setDefaultModel(current, 'gpt-5', { write })
    expect(next.defaultModel).toBe('gpt-5')
    expect(write).toHaveBeenCalled()
  })

  it('写入不属于当前 agent 的模型时收敛为未选择', () => {
    const write = vi.fn()
    const current: AppSettings = { language: 'zh', defaultAgent: 'codex', defaultModel: 'gpt-5' }
    const next = setDefaultModel(current, 'claude-opus-4-8', { write })
    expect(next.defaultModel).toBeUndefined()
  })

  it('未选择 agent 时写模型收敛为未选择', () => {
    const write = vi.fn()
    const next = setDefaultModel({ language: 'zh' }, 'gpt-5', { write })
    expect(next.defaultModel).toBeUndefined()
  })
})
