/**
 * 续接阶梯第 2 层（喂回历史重建）用的转写：把**原始流记录**（agent stdout 逐行原样，claude 即
 * stream-json NDJSON）转成喂给 agent 的可读文本。
 *
 * 与展示转写（`adapter.ts` 的 `displayFromStreamLine`）**刻意解耦、取舍相反**：
 *
 * | | 展示（给人） | 重建（给机器） |
 * |---|---|---|
 * | `tool_result` | 整类丢弃（全量刷屏没法看） | **保留要点**——这正是「我读到了什么」 |
 * | `tool_use` 目标 | 截 80 字（一行放得下） | **完整**——半截路径等于没有 |
 * | 超长 | 直接砍尾 | 按**事件边界**取舍，优先保住工具动作与结果 |
 *
 * 原始 NDJSON 不直接糊进 prompt（既浪费预算又难读），故仍要转写——只是转写的**输入**是原始流，
 * 不再是被削过一轮的展示文本。
 */

/** 喂回历史的默认字符预算（prompt 有长度；超出按事件边界取舍，绝不按字符截尾）。 */
export const REBUILD_BUDGET = 12000

/** 单条事件自身的上限：超长工具结果按要点收敛，免得一条把整段记录挤爆。 */
const ENTRY_CAP = 1200

/** 工具目标常见的入参键（按优先级）：取到即用其**完整**值。 */
const TARGET_KEYS = ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'prompt']

/** 一条重建条目：`text` 是最终文本，`kind` 决定预算不够时谁先被丢。 */
interface Entry {
  kind: 'chat' | 'tool' | 'final'
  text: string
}

/** 超过单条上限就收敛为要点：留头部并注明省了多少（不静默截断，让 agent 知道这里不全）。 */
function clip(s: string, cap = ENTRY_CAP): string {
  const t = s.trimEnd()
  return t.length <= cap ? t : `${t.slice(0, cap)}…（省略 ${t.length - cap} 字）`
}

/** 把工具结果的 content（字符串 / 分块数组 / 任意结构）取成文本要点。 */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
    if (parts.length) return parts.join('\n')
  }
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

/** 工具调用的目标：优先常见入参键的**完整**值，都没有则整个入参压成一行。 */
function toolTarget(input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>
  for (const k of TARGET_KEYS) {
    const v = inp[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  try {
    const s = JSON.stringify(inp)
    return s === '{}' ? '' : s
  } catch {
    return ''
  }
}

/** 一行原始记录 → 若干重建条目（`toolNames` 跨行记住 tool_use id → 工具名，供结果挂回其调用）。 */
function entriesFromLine(line: string, toolNames: Map<string, string>): Entry[] {
  const s = line.trim()
  if (!s) return []
  let ev: Record<string, unknown>
  try {
    ev = JSON.parse(s) as Record<string, unknown>
  } catch {
    return [{ kind: 'chat', text: clip(s) }] // 非结构化外壳的普通 stdout：原样留着
  }
  const type = ev.type
  if (type === 'result') {
    const r = ev.result
    return typeof r === 'string' && r.trim() ? [{ kind: 'final', text: `[完成] ${clip(r)}` }] : []
  }
  if (type === 'assistant' || type === 'user') {
    const content = (ev.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) return []
    const out: Entry[] = []
    for (const c of content as Array<Record<string, unknown>>) {
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        out.push({ kind: 'chat', text: clip(c.text) })
      } else if (c.type === 'tool_use') {
        const name = String(c.name ?? '')
        if (typeof c.id === 'string') toolNames.set(c.id, name)
        const target = toolTarget(c.input)
        out.push({ kind: 'tool', text: `[工具] ${name}${target ? ` · ${clip(target)}` : ''}` })
      } else if (c.type === 'tool_result') {
        const name = typeof c.tool_use_id === 'string' ? (toolNames.get(c.tool_use_id) ?? '') : ''
        const label = c.is_error === true ? '[结果·失败]' : '[结果]'
        out.push({ kind: 'tool', text: `${label}${name ? ` ${name}` : ''} · ${clip(resultText(c.content))}` })
      }
    }
    return out
  }
  return [] // system（session 初始化等）不进重建历史：它讲的是外壳自己，不是「我做过什么」
}

/**
 * 把原始流记录转写成喂回 agent 的历史文本。超预算时**按事件边界**取舍：先丢较早的助手闲聊，
 * 仍超再丢较早的工具动作与结果，最终结论始终保留；丢过就留一条可辨认的省略标记（不假装历史完整）。
 */
export function transcriptForRebuild(raw: string, opts: { budget?: number } = {}): string {
  const budget = opts.budget ?? REBUILD_BUDGET
  const toolNames = new Map<string, string>()
  const entries: Entry[] = []
  for (const line of raw.split('\n')) entries.push(...entriesFromLine(line, toolNames))
  if (!entries.length) return ''

  const keep = entries.map(() => true)
  let total = entries.reduce((n, e) => n + e.text.length + 1, 0)
  // 丢弃次序：先较早的闲聊，再较早的工具动作/结果；最终结论不丢。
  const order = [
    ...entries.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'chat'),
    ...entries.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'tool')
  ]
  let dropped = 0
  for (const { e, i } of order) {
    if (total <= budget) break
    keep[i] = false
    total -= e.text.length + 1
    dropped++
  }
  const kept = entries.filter((_, i) => keep[i]).map((e) => e.text)
  return (dropped ? [`…（为控制长度，已省略较早的 ${dropped} 条记录）`, ...kept] : kept).join('\n')
}
