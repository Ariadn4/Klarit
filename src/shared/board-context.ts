/**
 * 全盘视野装配（纯函数，main 与 renderer 共享、可测）：把本项目所有卡的活现状摘要 + 关系图 +
 * 项目目标/生效宪法拼成喂给全局 agent 的**编排上下文**。受 token 预算约束——超预算按确定性顺序
 * （createdAt→预取名）截断并**显式标注省略卡数**（no silent caps，对齐 requirement-orchestration）。
 */

import type { CardTypeDef, StoredCard } from './types'
import { typeArchetypeMap } from './card-type'
import { isTodoCard } from './requirement-card'

/** 一个可选工作流（供新项目选择）：id + 显示名 + 其可用类型（默认 + 建议类型）。 */
export interface WorkflowChoice {
  id: string
  name: string
  types: CardTypeDef[]
}

/** 全盘快照：编排上下文装配的全部输入（限本项目，调用方从库/设置读出后注入）。 */
export interface BoardSnapshot {
  cards: StoredCard[]
  types: CardTypeDef[]
  /** 项目目标要点（如 project-goals 关键段）。 */
  goals: string
  /** 该项目生效宪法（逐条）。 */
  constitution: string[]
  /** 可选工作流（供 agent 为**新项目**挑一个 + 用其类型 id 建卡）；缺省不列。 */
  workflows?: WorkflowChoice[]
  /** 字符预算（约当 token 预算）；缺省 12000。 */
  budgetChars?: number
}

const DEFAULT_BUDGET = 12_000

function excerpt(text: string, max: number): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** 装配编排上下文文本。 */
export function buildBoardContext(snap: BoardSnapshot): string {
  const budget = snap.budgetChars ?? DEFAULT_BUDGET
  const nameOf = new Map(snap.types.map((t) => [t.id, t.name]))
  const archetype = typeArchetypeMap(snap.types)

  const head: string[] = ['# 项目全盘视野']
  if (snap.goals.trim()) head.push('', '## 项目目标', snap.goals.trim())
  if (snap.constitution.length) head.push('', '## 生效宪法', ...snap.constitution.map((r) => `- ${r}`))
  // 可用类型：让 agent 产 create/adjust 时用**在册的 typeId**（否则会猜错 id 被校验挡下）。
  if (snap.types.length) {
    head.push(
      '',
      '## 可用类型（新建/改卡的 typeId 只能从这里选，用左侧的 id，别用显示名）',
      ...snap.types.map((t) => {
        const arche = t.archetype === 'container' ? '容器' : '子叶'
        const d = t.description?.trim() ? `：${t.description.trim()}` : ''
        return `- \`${t.id}\`（${t.name}·${arche}）${d}`
      })
    )
  }
  // 可选工作流：供 agent 为**新项目**挑一个（workflowId），并用其类型 id 建卡。
  if (snap.workflows && snap.workflows.length) {
    head.push(
      '',
      '## 可选工作流（新项目从中选一个 workflowId，并用其类型 id 建卡）',
      ...snap.workflows.map((w) => `- \`${w.id}\`「${w.name}」：类型 ${w.types.map((t) => t.id).join('/') || '（默认）'}`)
    )
  }
  head.push(
    '',
    '## 所有需求卡（活现状）',
    '标注「待办·可结构操作」的卡才可被 split/merge/adjust/relate；「已流动·仅建议新建」的卡不做跨卡结构操作，请改为建议新建需求。',
    ''
  )
  const headText = head.join('\n')

  const renderCard = (c: StoredCard): string => {
    const arche = archetype.get(c.typeId)
    const todo = isTodoCard(c, arche) ? '待办·可结构操作' : '已流动·仅建议新建'
    const typeName = nameOf.get(c.typeId) ?? c.typeId
    const rels = c.relations.length
      ? `\n  关系: ${c.relations.map((r) => `${r.kind}→${r.target}`).join(', ')}`
      : ''
    const desc = excerpt(c.description, 120)
    return `- \`${c.proposedName}\`（${c.title}｜${typeName}｜${c.status}｜${todo}）${rels}${desc ? `\n  ${desc}` : ''}`
  }

  const sorted = [...snap.cards].sort(
    (a, b) => a.createdAt - b.createdAt || a.proposedName.localeCompare(b.proposedName)
  )
  const lines: string[] = []
  let used = headText.length
  let omitted = 0
  for (let i = 0; i < sorted.length; i++) {
    const line = renderCard(sorted[i])
    if (used + line.length > budget && lines.length > 0) {
      omitted = sorted.length - lines.length
      break
    }
    lines.push(line)
    used += line.length + 1
  }

  const parts = [headText, lines.length ? lines.join('\n') : '（本项目暂无需求卡）']
  if (omitted > 0) parts.push('', `（受篇幅限制，省略 ${omitted} 张卡）`)
  return parts.join('\n')
}
