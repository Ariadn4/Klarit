import { describe, it, expect, vi } from 'vitest'
import { buildContinuationDelta, launchContinuation } from './continuation'
import type { AgentRunner, AgentLaunch, AgentRunSpec } from './runner'

const launch = (): AgentLaunch => ({ kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) })
const spec: AgentRunSpec = { toolId: 'claude-code', cwd: '/wt', sessionId: 'sess-1' }

function fakeRunner(over: Partial<AgentRunner>): AgentRunner {
  return {
    supportsResume: () => true,
    start: () => launch(),
    resume: () => launch(),
    ...over
  }
}

describe('launchContinuation — --resume by id 优先、失败/无 id 回落全新起', () => {
  it('有 session id 且支持 resume 且 resume 成功 → 原生 --resume（inject delta，不 start）', () => {
    const resume = vi.fn((_s: AgentRunSpec & { inject: string }) => launch())
    const start = vi.fn((_s: AgentRunSpec & { prompt: string }) => launch())
    launchContinuation(fakeRunner({ supportsResume: () => true, resume, start }), spec, {
      inject: '失败详情',
      rebuildPrompt: '完整任务 + 历史'
    })
    expect(resume).toHaveBeenCalledOnce()
    expect(resume.mock.calls[0][0]).toMatchObject({ inject: '失败详情', sessionId: 'sess-1' })
    expect(start).not.toHaveBeenCalled()
  })

  it('resume 返回 null（会话失效）→ 回落全新起带 rebuildPrompt', () => {
    const start = vi.fn((_s: AgentRunSpec & { prompt: string }) => launch())
    launchContinuation(fakeRunner({ supportsResume: () => true, resume: () => null, start }), spec, {
      inject: 'x',
      rebuildPrompt: '完整任务 + 历史'
    })
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0][0]).toMatchObject({ prompt: '完整任务 + 历史' })
  })

  it('无 session id → 直接全新起（不调 resume）', () => {
    const resume = vi.fn((_s: AgentRunSpec & { inject: string }) => launch())
    const start = vi.fn((_s: AgentRunSpec & { prompt: string }) => launch())
    launchContinuation(fakeRunner({ supportsResume: () => true, resume, start }), { ...spec, sessionId: undefined }, {
      inject: 'x',
      rebuildPrompt: '完整重拼'
    })
    expect(resume).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledOnce()
  })
})

describe('buildContinuationDelta — 续接注入文本', () => {
  it('含失败详情', () => {
    const d = buildContinuationDelta({ failure: '客观门没过：测试 3 个失败' })
    expect(d).toContain('测试 3 个失败')
  })
  it('含用户决策答复', () => {
    const d = buildContinuationDelta({ decisionAnswer: '用方案A' })
    expect(d).toContain('用方案A')
  })
})
