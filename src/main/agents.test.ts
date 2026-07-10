import { describe, it, expect, vi } from 'vitest'
import { scanAgents, type AgentProbe } from './agents'
import { SUPPORTED_AGENTS } from '../shared/agents'

/** 用一组「可用命令名」构造探测桩。 */
function probeFor(available: string[]): AgentProbe {
  return (command) => available.includes(command)
}

describe('scanAgents', () => {
  it('只返回探测到的 agent，未装的不出现，并内联其模型清单', () => {
    const claude = SUPPORTED_AGENTS.find((a) => a.id === 'claude-code')!
    const cursor = SUPPORTED_AGENTS.find((a) => a.id === 'cursor')!
    const detected = scanAgents(probeFor([claude.command, cursor.command]))
    const ids = detected.map((d) => d.id)
    expect(ids).toContain('claude-code')
    expect(ids).toContain('cursor')
    expect(ids).not.toContain('codex')
    const detectedClaude = detected.find((d) => d.id === 'claude-code')!
    expect(detectedClaude.models).toEqual(claude.models)
    expect(detectedClaude.name).toBe(claude.name)
  })

  it('未检测到任何 agent 时返回空数组，不抛出', () => {
    expect(scanAgents(probeFor([]))).toEqual([])
  })

  it('单个探测抛错/超时不影响其余 agent，整体成功返回', () => {
    const codex = SUPPORTED_AGENTS.find((a) => a.id === 'codex')!
    const probe: AgentProbe = vi.fn((command) => {
      if (command === codex.command) throw new Error('timeout')
      return true // 其余都视为已安装
    })
    const detected = scanAgents(probe)
    const ids = detected.map((d) => d.id)
    expect(ids).not.toContain('codex')
    // 其余受支持 agent 仍被检出
    expect(ids.length).toBe(SUPPORTED_AGENTS.length - 1)
  })
})
