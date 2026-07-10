/**
 * agent 外壳 adapter：把一次「启动 / 原生续接」声明式翻译成 CLI 调用式（命令 + 参数 + stdin 内容）。
 * **纯函数、无副作用**——只做 argv 翻译，便于测试；实际拉进程由 `runner.ts` 的共享运行器执行。
 *
 * 只接 agent 外壳（claude / codex / cursor），不接模型/后端。首发落地 claude 一家（里程碑 A），
 * codex/cursor 留阶段 B；接口已为多目录（一个 agent 跨仓 `extraDirs`）与续接预留。
 */

import type { AgentId } from '../../shared/agents'

/** 一次 agent CLI 启动的调用式（纯数据）。`input` 经 stdin 喂入（完整 prompt / 注入文本），不进 argv（避免长度/转义/注入）。 */
export interface AgentInvocation {
  command: string
  args: string[]
  input?: string
}

/** adapter 翻译所需的可选项：模型、透传参数、跨仓追加目录、续接会话 id。 */
export interface AgentInvokeOpts {
  model?: string
  extraArgs?: string
  /** 一个 agent 跨仓时，除 cwd 主目标仓外追加的其余目标仓 worktree 目录。 */
  extraDirs?: string[]
  /** 原生续接的**具体**会话 id（`--resume <id>`）；resume 时用（区别于「续最近一条」，支持暂停A/暂停B/恢复A）。 */
  sessionId?: string
}

/** 一个 agent 外壳的 adapter：把启动/续接翻成 CLI 调用式（纯函数）。 */
export interface AgentAdapter {
  id: AgentId
  /** 是否支持无头原生续接（供续接阶梯择优；不支持则回落自存重建）。 */
  supportsResume: boolean
  /** 起一次全新任务：喂完整 prompt（走 stdin）。 */
  start(prompt: string, opts: AgentInvokeOpts): AgentInvocation
  /** 原生续接（注入文本续上会话）；不支持返回 null。 */
  resume(inject: string, opts: AgentInvokeOpts): AgentInvocation | null
  /**
   * 可选：把该外壳的结构化流式输出（如 claude 的 stream-json NDJSON）一行转成**人可读**的展示文本；
   * 返回 null＝该行不展示（如工具结果噪音）。缺省＝直接展示原始 stdout。供 runner 按行喂入。
   */
  displayFromStreamLine?: (line: string) => string | null
  /**
   * 可选：从流式一行里抓出**会话 id**（如 claude stream-json 的 init 事件 `session_id`），供引擎存断点、
   * 下次 `--resume <id>` 精确续接。返回 null＝该行无会话 id。缺省＝该外壳不支持抓 id。
   */
  sessionIdFromStreamLine?: (line: string) => string | null
}

/** 从 claude stream-json 的 init 事件抓 `session_id`。 */
function claudeSessionId(line: string): string | null {
  const s = line.trim()
  if (!s || !s.includes('session_id')) return null
  try {
    const ev = JSON.parse(s) as Record<string, unknown>
    if (ev.type === 'system' && typeof ev.session_id === 'string') return ev.session_id
  } catch {
    /* 非 JSON 行忽略 */
  }
  return null
}

/** 解析 claude `--output-format stream-json` 的一行 NDJSON 为人可读进度（文本增量 + 工具动作 + 结果）。 */
function claudeStreamLine(line: string): string | null {
  const s = line.trim()
  if (!s) return null
  let ev: Record<string, unknown>
  try {
    ev = JSON.parse(s)
  } catch {
    return null
  }
  const type = ev.type
  if (type === 'assistant') {
    const content = (ev.message as { content?: unknown[] } | undefined)?.content ?? []
    const parts: string[] = []
    for (const c of content as Array<Record<string, unknown>>) {
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) parts.push(c.text)
      else if (c.type === 'tool_use') {
        const inp = (c.input ?? {}) as Record<string, unknown>
        const target = inp.file_path ?? inp.path ?? inp.command ?? ''
        parts.push(`\n[工具] ${String(c.name ?? '')}${target ? ` · ${String(target).slice(0, 80)}` : ''}`)
      }
    }
    return parts.length ? parts.join('') : null
  }
  if (type === 'result') {
    const r = ev.result
    return typeof r === 'string' && r.trim() ? `\n[完成] ${r}` : null
  }
  return null // system / tool_result 等噪音不展示
}

/** 把 extraArgs 字符串按空白切分为参数（工作流作者可信输入）。 */
function splitExtra(extraArgs?: string): string[] {
  const s = extraArgs?.trim()
  return s ? s.split(/\s+/) : []
}

/** claude 公共参数：无头 print + 流式 NDJSON（供实时展示）+ 跳权限 + 选模型 + 跨仓多目录 + 透传。 */
function claudeCommon(opts: AgentInvokeOpts): string[] {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
  if (opts.model) a.push('--model', opts.model)
  for (const d of opts.extraDirs ?? []) a.push('--add-dir', d)
  a.push(...splitExtra(opts.extraArgs))
  return a
}

/**
 * Claude Code adapter。start：`claude -p …`（prompt 走 stdin）。resume：`claude --continue -p …`
 * ——续 cwd 里最近一次会话（一 worktree 一条卡血缘，最近一次即本节点，故免抓 session id；里程碑 A.3 验证）。
 */
export const claudeAdapter: AgentAdapter = {
  id: 'claude-code',
  supportsResume: true,
  start: (prompt, opts) => ({ command: 'claude', args: claudeCommon(opts), input: prompt }),
  // 按**具体 session id** 精确续接（--resume <id>）；无 id 则无法原生续接，返回 null（引擎回落历史重建）。
  resume: (inject, opts) =>
    opts.sessionId
      ? { command: 'claude', args: ['--resume', opts.sessionId, ...claudeCommon(opts)], input: inject }
      : null,
  displayFromStreamLine: claudeStreamLine,
  sessionIdFromStreamLine: claudeSessionId
}

/** codex 公共参数：非交互 exec + 免审批沙箱写 + 选模型 + 透传。prompt 走 stdin（`-` 哨兵）。 */
function codexCommon(opts: AgentInvokeOpts): string[] {
  const a = ['--sandbox', 'workspace-write', '--ask-for-approval', 'never']
  if (opts.model) a.push('-m', opts.model)
  // 多目录（一个 agent 跨仓）：codex 无确认的 --add-dir，暂以 -C 追加（B 里程碑撞真 CLI 校准）。
  for (const d of opts.extraDirs ?? []) a.push('-C', d)
  a.push(...splitExtra(opts.extraArgs))
  return a
}

/** OpenAI Codex CLI adapter。start：`codex exec …`（stdin `-`）；resume：`codex exec resume --last …`。 */
export const codexAdapter: AgentAdapter = {
  id: 'codex',
  supportsResume: true,
  start: (prompt, opts) => ({ command: 'codex', args: ['exec', ...codexCommon(opts), '-'], input: prompt }),
  resume: (inject, opts) =>
    opts.sessionId
      ? { command: 'codex', args: ['exec', 'resume', opts.sessionId, ...codexCommon(opts), '-'], input: inject }
      : null
}

/** cursor 公共参数：print + 免确认写 + 信任 + 选模型 + 跨仓多目录 + json 输出 + 透传。 */
function cursorCommon(opts: AgentInvokeOpts): string[] {
  const a = ['-p', '--force', '--trust', '--output-format', 'json']
  if (opts.model) a.push('--model', opts.model)
  for (const d of opts.extraDirs ?? []) a.push('--add-dir', d)
  a.push(...splitExtra(opts.extraArgs))
  return a
}

/** Cursor CLI agent adapter。start：`cursor-agent -p …`（stdin）；resume：`cursor-agent --resume -p …`。 */
export const cursorAdapter: AgentAdapter = {
  id: 'cursor',
  supportsResume: true,
  start: (prompt, opts) => ({ command: 'cursor-agent', args: cursorCommon(opts), input: prompt }),
  resume: (inject, opts) =>
    opts.sessionId
      ? { command: 'cursor-agent', args: ['--resume', opts.sessionId, ...cursorCommon(opts)], input: inject }
      : null
}

/** 已落地的 adapter 注册表（首发三家 agent 外壳）。 */
const ADAPTERS: Partial<Record<AgentId, AgentAdapter>> = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter
}

/** 按 toolId 解析 adapter；未知/未落地返回 null（调用方按技术失败处理，不静默换外壳）。 */
export function resolveAdapter(toolId: string): AgentAdapter | null {
  return ADAPTERS[toolId as AgentId] ?? null
}
