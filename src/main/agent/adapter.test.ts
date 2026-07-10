import { describe, it, expect } from 'vitest'
import { claudeAdapter, codexAdapter, cursorAdapter, resolveAdapter, type AgentInvocation } from './adapter'

describe('claudeAdapter — start argv 翻译', () => {
  it('无头 print + 跳权限 + 选模型；prompt 走 stdin', () => {
    const inv = claudeAdapter.start('完整 prompt', { model: 'claude-opus-4-8' })
    expect(inv.command).toBe('claude')
    expect(inv.args).toContain('-p')
    expect(inv.args).toContain('--dangerously-skip-permissions')
    expect(inv.args).toContain('--model')
    expect(inv.args[inv.args.indexOf('--model') + 1]).toBe('claude-opus-4-8')
    expect(inv.input).toBe('完整 prompt') // prompt 经 stdin，不进 argv
    expect(inv.args).not.toContain('完整 prompt')
  })

  it('未指定模型不带 --model', () => {
    const inv = claudeAdapter.start('p', {})
    expect(inv.args).not.toContain('--model')
  })

  it('extraDirs 逐个 --add-dir（一个 agent 跨仓）', () => {
    const inv = claudeAdapter.start('p', { extraDirs: ['/wt/api', '/wt/web'] })
    const dirs = inv.args.reduce<string[]>((acc, a, i) => (inv.args[i - 1] === '--add-dir' ? [...acc, a] : acc), [])
    expect(dirs).toEqual(['/wt/api', '/wt/web'])
  })

  it('extraArgs 透传（按空白切分）', () => {
    const inv = claudeAdapter.start('p', { extraArgs: '--foo bar' })
    expect(inv.args).toContain('--foo')
    expect(inv.args).toContain('bar')
  })
})

describe('claudeAdapter — resume by session id', () => {
  it('supportsResume=true；有 sessionId → --resume <id> 精确续接，注入文本走 stdin', () => {
    expect(claudeAdapter.supportsResume).toBe(true)
    const inv = claudeAdapter.resume('修一下这个门失败', { model: 'm', sessionId: 'sess-123' }) as AgentInvocation
    expect(inv).not.toBeNull()
    expect(inv.command).toBe('claude')
    expect(inv.args[inv.args.indexOf('--resume') + 1]).toBe('sess-123')
    expect(inv.args).not.toContain('--continue') // 不用「最近一条」
    expect(inv.input).toBe('修一下这个门失败')
  })

  it('无 sessionId → resume 返回 null（无法原生续接，引擎回落历史重建）', () => {
    expect(claudeAdapter.resume('x', {})).toBeNull()
  })
})

describe('claudeAdapter — 从流式抓 session id', () => {
  it('init 事件抓出 session_id；其它行 null', () => {
    const line = '{"type":"system","subtype":"init","session_id":"abc-1","model":"opus"}'
    expect(claudeAdapter.sessionIdFromStreamLine?.(line)).toBe('abc-1')
    expect(claudeAdapter.sessionIdFromStreamLine?.('{"type":"assistant","message":{}}')).toBeNull()
    expect(claudeAdapter.sessionIdFromStreamLine?.('not json')).toBeNull()
  })
})

describe('codexAdapter / cursorAdapter — 契约对齐', () => {
  it('codex：exec 非交互 + 免审批沙箱 + 选模型；prompt 走 stdin；resume 用 exec resume --last', () => {
    const inv = codexAdapter.start('P', { model: 'gpt-5-codex' })
    expect(inv.command).toBe('codex')
    expect(inv.args.slice(0, 1)).toEqual(['exec'])
    expect(inv.args).toContain('--ask-for-approval')
    expect(inv.args).toContain('never')
    expect(inv.args[inv.args.indexOf('-m') + 1]).toBe('gpt-5-codex')
    expect(inv.input).toBe('P')
    const rz = codexAdapter.resume('续', { sessionId: 'sid' }) as AgentInvocation
    expect(rz.args.slice(0, 3)).toEqual(['exec', 'resume', 'sid'])
    expect(codexAdapter.resume('续', {})).toBeNull() // 无 id → null
    expect(codexAdapter.supportsResume).toBe(true)
  })

  it('cursor：print + force + trust + 选模型 + extraDirs 多目录；resume 用 --resume', () => {
    const inv = cursorAdapter.start('P', { model: 'gpt-5', extraDirs: ['/wt/api'] })
    expect(inv.command).toBe('cursor-agent')
    expect(inv.args).toContain('-p')
    expect(inv.args).toContain('--force')
    expect(inv.args).toContain('--trust')
    expect(inv.args[inv.args.indexOf('--add-dir') + 1]).toBe('/wt/api')
    expect(inv.input).toBe('P')
    const rz = cursorAdapter.resume('续', { sessionId: 'sid' }) as AgentInvocation
    expect(rz.args[rz.args.indexOf('--resume') + 1]).toBe('sid')
    expect(cursorAdapter.resume('续', {})).toBeNull() // 无 id → null
    expect(cursorAdapter.supportsResume).toBe(true)
  })
})

describe('resolveAdapter — 按 AgentId 解析', () => {
  it('三家外壳各自解析到对应 adapter', () => {
    expect(resolveAdapter('claude-code')).toBe(claudeAdapter)
    expect(resolveAdapter('codex')).toBe(codexAdapter)
    expect(resolveAdapter('cursor')).toBe(cursorAdapter)
  })
  it('未知/未落地外壳 → null（由调用方按技术失败处理）', () => {
    expect(resolveAdapter('nope')).toBeNull()
  })
})
