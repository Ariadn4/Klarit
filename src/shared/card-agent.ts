/**
 * 单需求 agent（single-card-agent）的纯逻辑：只读咨询契约（技能内联，单一来源）、三岔输出解析
 * （parseCardTurn：reply / interventions / upshift）、干预容错收敛、以及只读读上下文的纯装配 + 预算截断。
 * 无 fs / 无 IPC，main 与 renderer 共享。git diff / 运行断点 / 溯源由主进程注入（本模块只做格式化与截断）。
 */

import type { CardAdjustPatch, CardIntervention, CardInterventionKind, CardAgentTurn } from './types'
import { DESTRUCTIVE_INTERVENTION_KINDS } from './types'

/**
 * 咨询契约（喂给 agent）：把它塑造成**本卡只读咨询助手**——回复优先、纯咨询有效、识别到意图才按技能产出。
 * 三类技能内联（各格式即单一来源）。只读红线 + 一卡一支范围 + 塑造需求一律上抛。
 */
export const CARD_CONSULT_CONTRACT = `# 你是这张需求卡的只读顾问（自由对话）

你只看得到**这一张卡**的资料与它在各涉及成员仓的分支，**不改任何文件、不写任何代码、不亲自执行**。
你的自然语言回复永远放在 "reply" 里，是第一位的。用户只是问进度/讨论/答疑时，就**只回复**（不产干预、不上抛），这完全正常、不是失败。

只有识别到明确意图时，才在自然回复之外按下面对应技能产出结构化输出：

## 技能·查进度（只回复）
用户问「跑到哪了/为什么卡住/这分支改了啥」→ 据上文的**活现状 + 运行断点 + 产物溯源 + 分支 diff** 作答，只填 "reply"。

## 技能·本卡执行干预（interventions，你只提议、引擎执行）
用户想干预**本卡怎么执行** → 在 "interventions" 里产结构化 op（节点用其 id 引用，取自上文断点）：
- 暂停/恢复（无损）：\`{ "kind": "pause" }\` / \`{ "kind": "resume" }\`
- 倒回到某节点前向修复（可带注入指令）：\`{ "kind": "reenter", "nodeId": "<节点id>", "instruction"?: "<给该节点的新指令>" }\`
- 就地给当前执行节点补一条指令：\`{ "kind": "inject", "instruction": "<新指令>" }\`
- 改本卡任务资料：\`{ "kind": "adjustCard", "patch": { "title"?, "description"?, "typeId"? } }\`

**干预必须互斥、每个都是独立完整的一步——不要出「分几步做」的方案。** \`interventions\` 里的多个项是**备选方案**（做法A / 做法B），用户**只选一个**执行，因此每个 op 都必须能**单独跑完、达成用户意图**。
- **禁止**把一件事拆成「①先改资料 ②再倒回」这种要挨个执行的多步序列。
- 需要**复合效果**就**合并成一个动作**：例如「倒回到规划节点、并把『步长改成2』作为新指令重跑」应产出**一个** \`reenter\`：\`{ "kind": "reenter", "nodeId": "<规划节点id>", "instruction": "把步长改成2，PLAN.md 同步更新" }\`，而不是 adjustCard + reenter 两项。
- 通常一个意图**只给一个**最合适的干预；只有当确有**互斥的不同做法**可选时才给多个，且每个都自成一体。
- **你的 reply 里也不要说「给你两步/分几步做」**——直接说你建议的那**一个**动作（或那几个互斥备选各是什么），用户选一个执行即可。

## 技能·上抛塑造需求（upshift）
用户的意图属于**塑造需求**（新增/扩范围/牵动别卡/新建）→ 你**无全盘视野、不裁决落哪张卡**，一律上抛全局：
给 \`"upshift": { "intent": "<把用户意图凝练成一句>" }\`，不要自己产卡操作。歧义时**倾向上抛**（让全局裁决其实属本卡还是该新建）。

## 输出格式
只输出一个 JSON 对象，不要解释或 markdown 围栏：
- 只答疑/查进度 → \`{ "reply": "..." }\`
- 干预本卡 → \`{ "reply": "...", "interventions": [ ... ] }\`
- 塑造需求 → \`{ "reply": "...", "upshift": { "intent": "..." } }\`
（interventions 与 upshift 互斥；塑造需求一律走 upshift。）`

/**
 * 门语境的**反偏置**说明（门自由输入分类前置用）：卡对话默认歧义→上抛；但用户在**评审本卡产出**的门里，
 * 默认语境是「对本卡不满意」，故歧义→留在本地（当驳回），只有**明确**的塑造需求才上抛。见 content-driven-rollback。
 */
export const GATE_LOCAL_BIAS_NOTE = `# 当前语境：用户正在评审本卡的产出
除非用户**明确**表达「新增需求/扩大范围/牵动别的卡/新建项目」这类**塑造需求**的意图，否则**不要** upshift——
把含糊或针对本卡产出的意见一律当作对本卡的驳回/反馈，只回复即可（不产 upshift、不产干预）。`

/** 拼咨询指令：本卡只读读上下文 + 咨询契约（+ 门语境反偏置）+ 用户这轮的话。 */
export function buildCardConsultPrompt(context: string, intent: string, opts: { biasLocal?: boolean } = {}): string {
  const contract = opts.biasLocal ? `${CARD_CONSULT_CONTRACT}\n\n${GATE_LOCAL_BIAS_NOTE}` : CARD_CONSULT_CONTRACT
  return [context, '', contract, '', '# 用户这轮说', intent].join('\n')
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function coerceAdjustPatch(v: unknown): CardAdjustPatch | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const patch: CardAdjustPatch = {}
  if (typeof o.title === 'string') patch.title = o.title
  if (typeof o.description === 'string') patch.description = o.description
  if (typeof o.typeId === 'string' && o.typeId.trim() !== '') patch.typeId = o.typeId.trim()
  return Object.keys(patch).length > 0 ? patch : null
}

/** 逐条容错把原始对象收敛为一个合规 CardIntervention；无法收敛（缺关键字段/未知 kind）返回 null。 */
function coerceIntervention(raw: unknown): CardIntervention | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  switch (o.kind as CardInterventionKind) {
    case 'pause':
      return { kind: 'pause' }
    case 'resume':
      return { kind: 'resume' }
    case 'reenter': {
      const nodeId = str(o.nodeId)
      if (!nodeId) return null
      const instruction = str(o.instruction)
      return instruction ? { kind: 'reenter', nodeId, instruction } : { kind: 'reenter', nodeId }
    }
    case 'inject': {
      const instruction = str(o.instruction)
      return instruction ? { kind: 'inject', instruction } : null
    }
    case 'adjustCard': {
      const patch = coerceAdjustPatch(o.patch)
      return patch ? { kind: 'adjustCard', patch } : null
    }
    default:
      return null
  }
}

/** 把原始数组逐条容错收敛为 CardIntervention[]；非数组 → []。 */
export function normalizeInterventions(raw: unknown): CardIntervention[] {
  if (!Array.isArray(raw)) return []
  const out: CardIntervention[] = []
  for (const item of raw) {
    const iv = coerceIntervention(item)
    if (iv) out.push(iv)
  }
  return out
}

/** 破坏性干预（执行前须二次确认）：倒回/就地注入/改卡字段。 */
export function isDestructiveIntervention(iv: CardIntervention): boolean {
  return DESTRUCTIVE_INTERVENTION_KINDS.includes(iv.kind)
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
}

/** 取 agent 的规范答案：去 markdown 围栏、只取最后一次 `[完成]` 之后那份、剔除 `[工具] …` 噪音行。 */
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

/** 抠出 [open,close] 内最外层片段并 JSON.parse；失败返回 null。 */
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

function coerceUpshift(v: unknown): { intent: string } | undefined {
  if (!v || typeof v !== 'object') return undefined
  const intent = str((v as Record<string, unknown>).intent)
  return intent ? { intent } : undefined
}

/**
 * 解析 agent 回复为三岔输出：优先从规范答案抠 `{ reply, interventions, upshift }`；无结构化 JSON → 整段当 reply。
 * upshift 与 interventions **互斥**：upshift 存在时忽略 interventions（塑造需求一律上抛，单卡不产干预）。
 */
export function parseCardTurn(stdout: string): CardAgentTurn {
  const body = canonicalAnswer(stdout)
  const obj = parseSlice(body, '{', '}')
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>
    if ('reply' in o || 'interventions' in o || 'upshift' in o) {
      const reply = typeof o.reply === 'string' ? o.reply : ''
      const upshift = coerceUpshift(o.upshift)
      if (upshift) return { reply, upshift }
      const interventions = normalizeInterventions(o.interventions)
      return interventions.length ? { reply, interventions } : { reply }
    }
  }
  // 自然语言兜底：没有结构化 JSON → 整段是自由咨询回复。
  return { reply: body }
}

// ── 只读读上下文装配（纯，预算截断） ──────────────────────────────────────

/** 装配读上下文的输入：主进程已把断点/溯源渲成文本、把各仓 diff 备好；本模块只格式化 + 截断。 */
export interface CardConsultContextInput {
  card: { title: string; typeId: string; status: string; description?: string; relations?: string }
  /** 运行断点摘要（当前节点/阶段/最远进展/门进度）；卡未运行为 null。 */
  breakpoint: string | null
  /** 产物溯源渲染文本（renderLineage）；卡未运行/无产物为 null。 */
  lineage: string | null
  /** 各涉及成员仓的分支 diff 概要。 */
  branchDiffs: Array<{ repo: string; diff: string }>
}

const DEFAULT_BUDGET_CHARS = 12_000

/**
 * 纯装配 + 预算截断：活现状/断点/溯源为「必留」段，**分支 diff 最先截**（最重）。截断时显式标注省略量。
 * 未运行卡（breakpoint/lineage 为 null）标明「尚未运行」。
 */
export function buildCardConsultContext(input: CardConsultContextInput, opts: { budgetChars?: number } = {}): string {
  const budget = opts.budgetChars ?? DEFAULT_BUDGET_CHARS
  const c = input.card
  const head = [
    '# 本卡活现状（只读，范围仅这一张卡）',
    `- 标题：${c.title}`,
    `- 类型：${c.typeId}`,
    `- 状态：${c.status}`,
    ...(c.description ? [`- 描述：${c.description}`] : []),
    ...(c.relations ? [`- 关系：${c.relations}`] : [])
  ].join('\n')

  const runSection =
    input.breakpoint || input.lineage
      ? [
          '',
          '# 运行断点',
          input.breakpoint ?? '（无断点）',
          '',
          '# 产物溯源',
          input.lineage ?? '（本卡暂无可溯源的产物记录）'
        ].join('\n')
      : '\n（本卡尚未运行——无运行断点、无产物溯源、无分支。）'

  // 必留段（活现状 + 断点 + 溯源）；分支 diff 用剩余预算，超则截并标注。
  const mustKeep = head + runSection
  let out = mustKeep
  const remaining = Math.max(0, budget - mustKeep.length)

  if (input.branchDiffs.length) {
    const diffHeader = '\n\n# 各涉及成员仓分支 diff（base..branch）\n'
    let used = 0
    const parts: string[] = []
    let omitted = 0
    for (const d of input.branchDiffs) {
      const block = `## ${d.repo}\n${d.diff}\n`
      if (used + block.length <= remaining) {
        parts.push(block)
        used += block.length
      } else {
        // 预算内尽量放该仓的截断片段，其余标省略。
        const room = remaining - used
        if (room > d.repo.length + 20) {
          const slice = d.diff.slice(0, Math.max(0, room - d.repo.length - 30))
          parts.push(`## ${d.repo}\n${slice}\n…（该仓 diff 已截断）\n`)
          used = remaining
        }
        omitted++
      }
    }
    out += diffHeader + parts.join('')
    if (omitted > 0) out += `\n（预算所限，省略/截断了 ${omitted} 个成员仓的分支 diff。）`
  }

  return out
}
