import { describe, it, expect } from 'vitest'
import type { AgentLaunch, AgentRunner, AgentRunSpec } from './agent/runner'
import { createOpsProducer, parseOpsReply } from './orchestrate-producer'
import { claudeAdapter } from './agent/adapter'

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

  it('解析 workflow 提案（改写：带 baseId）', () => {
    const raw = JSON.stringify({
      reply: '给你的流加了个评审门',
      baseId: 'my-flow',
      workflow: {
        id: 'my-flow',
        name: { zh: '我的流', en: 'My flow' },
        stages: [{ id: 's1', name: { zh: '交付' } }],
        nodes: [{ id: 'push', name: { zh: '推送' }, stageId: 's1', executor: { kind: 'engine', operation: 'push-branch' }, outputs: [] }]
      }
    })
    const out = parseOpsReply(raw)
    expect(out.reply).toBe('给你的流加了个评审门')
    expect(out.workflow?.workflow.id).toBe('my-flow')
    expect(out.workflow?.baseId).toBe('my-flow')
    expect(out.ops).toEqual([]) // 工作流轮 ops 为空
  })

  it('解析 workflow 提案（创建：无 baseId → baseId undefined）', () => {
    const raw = JSON.stringify({
      workflow: {
        id: 'new-flow',
        name: { zh: '新流' },
        stages: [{ id: 's1', name: { zh: '开发' } }],
        nodes: [{ id: 'impl', name: { zh: '实现' }, stageId: 's1', executor: { kind: 'agent', instruction: { kind: 'inline', text: '做' } }, outputs: [] }]
      }
    })
    const out = parseOpsReply(raw)
    expect(out.workflow?.workflow.id).toBe('new-flow')
    expect(out.workflow?.baseId).toBeUndefined()
  })

  it('workflow 经 migrateWorkflowShape 归一（裸字符串名 → 语言表）', () => {
    const raw = JSON.stringify({
      workflow: { id: 'wf', name: '裸名', stages: [{ id: 's1', name: '阶段' }], nodes: [] }
    })
    const out = parseOpsReply(raw)
    expect(out.workflow?.workflow.name).toEqual({ zh: '裸名' })
  })

  it('无 workflow 字段 → out.workflow 为 undefined（卡编排路径不回归）', () => {
    const out = parseOpsReply('{ "reply": "好的", "ops": [ { "kind": "create", "card": { "title": "卡", "typeId": "feat" } } ] }')
    expect(out.workflow).toBeUndefined()
    expect(out.ops).toHaveLength(1)
  })

  it('纯聊天轮不产 workflow', () => {
    const out = parseOpsReply('就是随便聊聊，没有要改工作流。')
    expect(out.workflow).toBeUndefined()
    expect(out.ops).toEqual([])
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

  // 根因修复（设计决策 #10）：自动 author 须能读到项目文件——producer 收到 addDirs 时把项目成员仓真实路径
  // 作为可访问目录（--add-dir）交给 runner，author agent 才能实际查看 .claude/、CLAUDE.md、git log 推断习惯。
  it('addDirs → runner spec.extraDirs（项目成员仓真实路径的只读访问）', async () => {
    let captured: string[] | undefined
    const base = stubRunner('{ "ops": [] }')
    const runner: AgentRunner = {
      ...base,
      start: (spec: AgentRunSpec & { prompt: string }) => {
        captured = spec.extraDirs
        return base.start(spec)
      }
    }
    const produce = createOpsProducer({ runner, toolId: 'claude-code', cwd: '/scratch', addDirs: ['/repo/api', '/repo/web'] })
    await produce('PROMPT', ctx)
    expect(captured).toEqual(['/repo/api', '/repo/web'])
  })

  it('addDirs 经真实 adapter 翻成 CLI --add-dir（读到项目文件）', async () => {
    let captured: string[] | undefined
    const base = stubRunner('{ "ops": [] }')
    const runner: AgentRunner = {
      ...base,
      start: (spec: AgentRunSpec & { prompt: string }) => {
        captured = spec.extraDirs
        return base.start(spec)
      }
    }
    const produce = createOpsProducer({ runner, toolId: 'claude-code', cwd: '/scratch', addDirs: ['/repo/api'] })
    await produce('PROMPT', ctx)
    // 用真实 CLI-arg 构建器（claudeAdapter）验证捕获到的目录落成 --add-dir 参数（不触真 CLI）。
    const inv = claudeAdapter.start('p', { extraDirs: captured })
    const dirs = inv.args.reduce<string[]>((acc, a, i) => (inv.args[i - 1] === '--add-dir' ? [...acc, a] : acc), [])
    expect(dirs).toEqual(['/repo/api'])
  })

  it('未给 addDirs → spec.extraDirs 不带（聊天路径不回归）', async () => {
    let captured: string[] | undefined = ['sentinel']
    const base = stubRunner('{ "ops": [] }')
    const runner: AgentRunner = {
      ...base,
      start: (spec: AgentRunSpec & { prompt: string }) => {
        captured = spec.extraDirs
        return base.start(spec)
      }
    }
    const produce = createOpsProducer({ runner, toolId: 'claude-code', cwd: '/scratch' })
    await produce('PROMPT', ctx)
    expect(captured).toBeUndefined()
  })

  // habit-context-materialization 回归：聊天写工作流那条路本来就不挂项目——改成「自动路只挂习惯上下文包」后
  // 它照旧一个可访问目录都不带（既不挂包、也不挂仓根），翻成 CLI 参数里没有任何 --add-dir。
  it('聊天路径 producer 一个可访问目录都不带（不挂上下文包、不挂仓根）', async () => {
    let captured: string[] | undefined = ['sentinel']
    const base = stubRunner('{ "ops": [] }')
    const runner: AgentRunner = {
      ...base,
      start: (spec: AgentRunSpec & { prompt: string }) => {
        captured = spec.extraDirs
        return base.start(spec)
      }
    }
    const produce = createOpsProducer({ runner, toolId: 'claude-code', cwd: '/scratch' })
    await produce('PROMPT', ctx)
    expect(captured).toBeUndefined()
    expect(claudeAdapter.start('p', { extraDirs: captured }).args).not.toContain('--add-dir')
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
