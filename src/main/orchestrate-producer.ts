/**
 * 真实 OpsProducer：以**只读姿态、脱 worktree** 驱动用户配置的默认 agent（复用 `agent/runner.ts` 流式续接
 * 那套——聊天要的流式展示 + session 捕获 + `--resume` 续接都在里头），把 agent 回复解析为结构化卡操作。
 * 全局 agent 只编排卡、不写代码——即便它写了文件我们也**不消费**，只取其结构化 ops 输出。
 * runner 注入式：测试用桩 runner（编排 stdout + 退出码），不触真 CLI。
 */

import { normalizeOps } from '../shared/card-ops'
import { migrateWorkflowShape } from '../shared/workflow'
import type { OpsProducer, ProducedOps } from './orchestrate-service'
import type { AgentRunner, AgentRunSpec } from './agent/runner'
import type { EffortLevel } from '../shared/agents'
import { launchContinuation } from './agent/continuation'

/** 会话 sessionId 存取（供多轮原生续接）；缺省即每轮全新起。 */
export interface SessionBridge {
  get: (conversationId?: string) => string | undefined
  set: (conversationId: string | undefined, sessionId: string) => void
}

export interface OpsProducerConfig {
  runner: AgentRunner
  /** 默认 agent 外壳 id（settings.defaultAgent）；未配置时为 null → 抛错让编排核降级空提案。 */
  toolId: string | null
  /** 只读工作目录（项目主仓或 scratch）；不开 worktree。 */
  cwd: string
  model?: string
  /** 推理力度（全局默认；聊天无会话级覆盖）。 */
  effort?: EffortLevel
  /**
   * 额外可访问目录（映射为 agent CLI 的目录访问 flag——claude/cursor `--add-dir`、codex `-C` 尽力而为）。
   * 供自动 author 把项目各成员仓真实路径传入，使 agent 能实际读到 `.claude/`/`CLAUDE.md`/`git log` 推断习惯
   * （设计决策 #10 的根因修复：cwd 是 scratch，无此则 agent 对项目零文件系统访问）。只读探查由系统意图硬约束。
   */
  addDirs?: string[]
  timeoutMs?: number
  sessions?: SessionBridge
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
}

/**
 * 收敛 agent 产出的工作流：`workflow` 是对象才成立，经 `migrateWorkflowShape` 归一宽松/旧形状（不在此校验——
 * 校验由编排核做，非法定义仍带出供「修好再报」）；`baseId` 非空字符串才带上（= 改写覆盖目标）。
 */
function coerceProducedWorkflow(wf: unknown, baseId: unknown): ProducedOps['workflow'] {
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) return undefined
  const def = migrateWorkflowShape(wf)
  const bid = typeof baseId === 'string' && baseId.trim() !== '' ? baseId.trim() : undefined
  return { workflow: def, baseId: bid }
}

/** 收敛 suggestedProject：name 非空才成立；描述、工作流 id 可选。 */
function coerceSuggestedProject(v: unknown): { name: string; description?: string; workflowId?: string } | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name === '') return undefined
  const description = typeof o.description === 'string' ? o.description : undefined
  const workflowId = typeof o.workflowId === 'string' && o.workflowId.trim() !== '' ? o.workflowId.trim() : undefined
  return { name, description, workflowId }
}

/** 抠出 [start,end] 内最外层片段并 JSON.parse；失败返回 null。 */
function parseSlice(text: string, open: string, close: string): unknown {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * 从 agent 回复解析 `{ reply, ops }`：优先抠最外层 JSON 对象取 `ops`/`reply`；退而抠裸 JSON 数组当 ops。
 * ops 一律经 `normalizeOps` 逐条容错收敛。解析不出返回空 ops（上层按空提案处理）。
 */
/**
 * 取 agent 的**规范答案**：claude 流式会把最终答案同时出现在 assistant 文本与 result 事件（后者由展示层
 * 标 `[完成]`），二者内容相同——只取最后一次 `[完成]` 之后那份，避免「首{到末}」跨两个 JSON 对象解析失败；
 * 无标记则用全文。再去掉 `[工具] …` 噪音行。
 */
function canonicalAnswer(raw: string): string {
  const cleaned = stripFences(raw ?? '')
  const done = cleaned.lastIndexOf('[完成]')
  const body = done >= 0 ? cleaned.slice(done + '[完成]'.length) : cleaned
  return body
    .split('\n')
    .filter((l) => !l.trim().startsWith('[工具]'))
    .join('\n')
    .trim()
}

/**
 * 解析 agent 回复：优先从规范答案抠 `{ reply, ops, suggestedProject }`（有 reply/ops/suggestedProject 字段才认）；
 * 退而抠裸 ops 数组；**都没有 → 整段当作自然语言 reply**（自由聊天轮），ops 空。
 */
export function parseOpsReply(stdout: string): ProducedOps {
  const body = canonicalAnswer(stdout)
  const obj = parseSlice(body, '{', '}')
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>
    if ('reply' in o || 'ops' in o || 'suggestedProject' in o || 'workflow' in o) {
      return {
        ops: normalizeOps(o.ops),
        reply: typeof o.reply === 'string' ? o.reply : undefined,
        suggestedProject: coerceSuggestedProject(o.suggestedProject),
        workflow: coerceProducedWorkflow(o.workflow, o.baseId)
      }
    }
  }
  const arr = parseSlice(body, '[', ']')
  if (Array.isArray(arr)) return { ops: normalizeOps(arr) }
  // 自然语言兜底：没有结构化 JSON → 整段是自由聊天回复。
  return { ops: [], reply: body !== '' ? body : undefined }
}

/** 构造真实 producer：一次编排 = 一轮 agent 调用（有会话 sessionId 走原生续接，否则全新起）。 */
export function createOpsProducer(cfg: OpsProducerConfig): OpsProducer {
  return async (prompt, ctx) => {
    if (!cfg.toolId) throw new Error('未配置默认 agent')
    let out = ''
    const spec: AgentRunSpec = {
      toolId: cfg.toolId,
      cwd: cfg.cwd,
      model: cfg.model,
      effort: cfg.effort,
      // 复用 runner/adapter 既有的 extraDirs → CLI 目录访问 flag 链路（claude/cursor `--add-dir`、codex `-C`）。
      extraDirs: cfg.addDirs,
      onChunk: (stream, chunk) => {
        if (stream === 'stdout') out += chunk
      },
      sessionId: cfg.sessions?.get(ctx.conversationId),
      onSession: (id) => cfg.sessions?.set(ctx.conversationId, id)
    }
    // 续接阶梯：有 session 且支持 → resume（inject=本轮 prompt）；否则全新 start（prompt）。
    const launch = launchContinuation(cfg.runner, spec, { inject: prompt, rebuildPrompt: prompt })
    if (!launch) throw new Error(`无法拉起 agent「${cfg.toolId}」`)

    const timeoutMs = cfg.timeoutMs ?? 180_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        launch.kill()
        reject(new Error('agent 编排调用超时'))
      }, timeoutMs)
    })
    try {
      await Promise.race([launch.done, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
    return parseOpsReply(out)
  }
}
