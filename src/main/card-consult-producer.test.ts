import { describe, it, expect } from 'vitest'
import { createCardConsultProducer } from './card-consult-producer'
import type { AgentRunner } from './agent/runner'

/** 桩 runner：start 时把预设 stdout 分块回吐，立即结束；记录 cwd/sessionId 供断言只读脱 worktree。 */
function stubRunner(stdout: string): AgentRunner & { starts: Array<{ cwd: string; sessionId?: string }> } {
  const r = {
    starts: [] as Array<{ cwd: string; sessionId?: string }>,
    supportsResume: () => true,
    start(spec: Parameters<AgentRunner['start']>[0]): ReturnType<AgentRunner['start']> {
      r.starts.push({ cwd: spec.cwd, sessionId: spec.sessionId })
      spec.onChunk?.('stdout', stdout)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    },
    resume(spec: Parameters<AgentRunner['resume']>[0]): ReturnType<AgentRunner['resume']> {
      r.starts.push({ cwd: spec.cwd, sessionId: spec.sessionId })
      spec.onChunk?.('stdout', stdout)
      return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
    }
  }
  return r
}

describe('createCardConsultProducer', () => {
  it('解析结构化三岔（interventions）', async () => {
    const runner = stubRunner('{ "reply": "暂停这卡", "interventions": [ { "kind": "pause" } ] }')
    const produce = createCardConsultProducer({ runner, toolId: 'claude-code', cwd: '/scratch' })
    const turn = await produce('PROMPT', { cardId: 'c', intent: 'i', history: [] })
    expect(turn.reply).toBe('暂停这卡')
    expect(turn.interventions).toEqual([{ kind: 'pause' }])
    // 只读脱 worktree：cwd 为传入的 scratch，不是任何 worktree
    expect(runner.starts[0].cwd).toBe('/scratch')
  })

  it('无结构化 JSON → 整段当自由咨询回复', async () => {
    const runner = stubRunner('当前跑到写测试这步，还差一个门。')
    const produce = createCardConsultProducer({ runner, toolId: 'claude-code', cwd: '/scratch' })
    const turn = await produce('PROMPT', { cardId: 'c', intent: 'i', history: [] })
    expect(turn.reply).toBe('当前跑到写测试这步，还差一个门。')
    expect(turn.interventions ?? []).toEqual([])
  })

  it('未配置 toolId → 抛错（上层咨询核降级空态）', async () => {
    const produce = createCardConsultProducer({ runner: stubRunner('x'), toolId: null, cwd: '/scratch' })
    await expect(produce('P', { cardId: 'c', intent: 'i', history: [] })).rejects.toThrow()
  })
})
