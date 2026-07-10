import { describe, it, expect } from 'vitest'
import type { AgentLaunch, AgentRunner } from './agent/runner'
import { createOpsProducer, parseOpsReply } from './orchestrate-producer'

/** 桩 runner：start 时把预设 stdout 分块喂回 onChunk，再以 code 0 结束。 */
function stubRunner(stdout: string, opts: { supportsResume?: boolean; failStart?: boolean } = {}): AgentRunner {
  const launch = (spec: { onChunk?: (s: 'stdout' | 'stderr', c: string) => void; onSession?: (id: string) => void }): AgentLaunch => {
    spec.onSession?.('sess-1')
    for (const chunk of stdout.match(/.{1,20}/gs) ?? [stdout]) spec.onChunk?.('stdout', chunk)
    return { kill: () => {}, done: Promise.resolve({ code: 0, killed: false }) }
  }
  return {
    supportsResume: () => opts.supportsResume ?? false,
    start: (spec) => (opts.failStart ? null : launch(spec)),
    resume: (spec) => launch(spec)
  }
}

const ctx = { intent: 'x', conversationId: 'conv-1', history: [] }

describe('parseOpsReply', () => {
  it('解析 { reply, ops } 对象', () => {
    const out = parseOpsReply('```json\n{ "reply": "好的", "ops": [ { "kind": "adjust", "target": "a", "patch": { "title": "改" } } ] }\n```')
    expect(out.reply).toBe('好的')
    expect(out.ops).toHaveLength(1)
    expect(out.ops[0].kind).toBe('adjust')
  })

  it('退而解析裸 ops 数组', () => {
    const out = parseOpsReply('[ { "kind": "create", "card": { "title": "新卡", "typeId": "feat" } } ]')
    expect(out.ops).toHaveLength(1)
    expect(out.ops[0].kind).toBe('create')
  })

  it('无法解析 → 空 ops', () => {
    expect(parseOpsReply('抱歉我不知道').ops).toEqual([])
    expect(parseOpsReply('').ops).toEqual([])
  })

  it('解析 suggestedProject（新项目提议）', () => {
    const out = parseOpsReply('{ "reply": "建个新项目", "suggestedProject": { "name": "新工具", "description": "一个新东西" }, "ops": [ { "kind": "create", "card": { "title": "首页", "typeId": "feat" } } ] }')
    expect(out.suggestedProject).toEqual({ name: '新工具', description: '一个新东西' })
    expect(out.ops).toHaveLength(1)
  })

  it('suggestedProject 缺 name → 忽略', () => {
    const out = parseOpsReply('{ "suggestedProject": { "description": "无名" }, "ops": [] }')
    expect(out.suggestedProject).toBeUndefined()
  })

  it('claude 流式重复输出（assistant + [完成] result 同一 JSON）→ 正确取一份解析', () => {
    // 真实格式：同一 JSON 出现两次，第二次带 [完成] 标记（展示层加）。
    const raw = '{ "reply": "你好", "ops": [] }\n\n[完成] { "reply": "你好", "ops": [] }\n'
    const out = parseOpsReply(raw)
    expect(out.reply).toBe('你好')
    expect(out.ops).toEqual([])
  })

  it('自然语言回复（无 JSON）→ 整段当作 reply（自由聊天）', () => {
    const raw = '我建议先从登录和首页做起。\n\n[完成] 我建议先从登录和首页做起。\n'
    const out = parseOpsReply(raw)
    expect(out.reply).toBe('我建议先从登录和首页做起。')
    expect(out.ops).toEqual([])
  })

  it('带 [工具] 噪音行 → 去噪后仍解析出 JSON', () => {
    const raw = '\n[工具] Read · foo.ts\n[完成] { "reply": "好的", "ops": [ { "kind": "adjust", "target": "a", "patch": { "title": "t" } } ] }'
    const out = parseOpsReply(raw)
    expect(out.reply).toBe('好的')
    expect(out.ops).toHaveLength(1)
  })
})

describe('createOpsProducer（桩 runner）', () => {
  it('驱动 runner、收集 stdout、解析为 ops', async () => {
    const runner = stubRunner('{ "reply": "已处理", "ops": [ { "kind": "adjust", "target": "a", "patch": { "title": "t" } } ] }')
    const produce = createOpsProducer({ runner, toolId: 'claude-code', cwd: '/ro' })
    const out = await produce('PROMPT', ctx)
    expect(out.reply).toBe('已处理')
    expect(out.ops).toHaveLength(1)
  })

  it('畸形回复 → 空 ops（不抛）', async () => {
    const runner = stubRunner('乱七八糟没有 JSON')
    const produce = createOpsProducer({ runner, toolId: 'claude-code', cwd: '/ro' })
    const out = await produce('PROMPT', ctx)
    expect(out.ops).toEqual([])
  })

  it('未配置 toolId → 抛错（供编排核降级）', async () => {
    const produce = createOpsProducer({ runner: stubRunner(''), toolId: null, cwd: '/ro' })
    await expect(produce('PROMPT', ctx)).rejects.toThrow()
  })

  it('拉起失败（start 返 null 且不支持 resume）→ 抛错', async () => {
    const runner = stubRunner('', { failStart: true, supportsResume: false })
    const produce = createOpsProducer({ runner, toolId: 'unknown', cwd: '/ro' })
    await expect(produce('PROMPT', ctx)).rejects.toThrow()
  })

  it('有 sessionId 且支持续接 → 走 resume', async () => {
    let resumed = false
    const base = stubRunner('{ "ops": [] }', { supportsResume: true })
    const runner: AgentRunner = {
      ...base,
      resume: (spec) => {
        resumed = true
        return base.resume(spec)
      }
    }
    const sessions = { get: () => 'sess-prev', set: () => {} }
    const produce = createOpsProducer({ runner, toolId: 'claude-code', cwd: '/ro', sessions })
    await produce('PROMPT', ctx)
    expect(resumed).toBe(true)
  })
})
