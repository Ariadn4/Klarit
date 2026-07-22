/** 分解结果（候选卡批）的纯逻辑：批校验与预取名去重规整。无 fs / 无 IPC，main 与 renderer 共享。 */

import type {
  CandidateCard,
  CandidateIssue,
  CardRelation,
  CardRelationKind,
  CardTypeDef,
  StoredCard
} from './types'
import type { TypeArchetypeMap } from './card-type'
import {
  validateCandidateCard,
  dedupeProposedName,
  isValidProposedName,
  toProposedName,
  isRelationEdgeLegal,
  type EdgeCardView,
  CARD_RELATION_KINDS
} from './requirement-card'

export type { CandidateIssue }

/** 逐条容错收敛关系边数组：丢弃 kind 非法或 target 空的项。 */
export function coerceRelations(v: unknown): CardRelation[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((r): r is { kind: unknown; target: unknown } => !!r && typeof r === 'object')
    .filter(
      (r) =>
        CARD_RELATION_KINDS.includes(r.kind as CardRelationKind) &&
        typeof r.target === 'string' &&
        r.target.trim() !== ''
    )
    .map((r) => ({ kind: r.kind as CardRelationKind, target: String(r.target) }))
}

/**
 * 逐条容错把 LLM 产出的一个对象收敛为合规候选卡（无标题即丢弃、预取名非法则由标题派生、
 * 兼容旧 `category` 字段作 typeId）。类型在册与否不在此判定——交 validateCandidateCard/validateOps。
 * 供分解（agent-runner）与编排（card-ops）两路共用同一收敛逻辑（单一来源）。
 */
export function coerceCandidateCard(raw: unknown): CandidateCard | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (title === '') return null
  const description = typeof o.description === 'string' ? o.description : ''
  const typeRaw = o.typeId ?? o.category
  const typeId = typeof typeRaw === 'string' ? typeRaw.trim() : ''
  const proposed =
    typeof o.proposedName === 'string' && isValidProposedName(o.proposedName)
      ? o.proposedName
      : toProposedName(title)
  return { proposedName: proposed, title, description, typeId, relations: coerceRelations(o.relations) }
}

/** 自动生成分解 skill 的固定拆分模板（怎么拆 + 输出结构 + slug/附件约束）；类型分类段由 buildDecomposeSkill 拼接。 */
const DECOMPOSE_TEMPLATE_HEAD = `# 分解需求 skill

你是 Klarit 的全局 agent。输入内容可能包含大段「想法」，可能夹着多个点子、截图与文件路径；
也可能是某张卡触发的联动场景（如判断是否拆卡 / 新增卡）。
你的任务：把它分解成若干张**候选需求卡**，每张是一个聚焦、可独立推进的需求。

## 怎么分解

- 一个点子一张卡；同一点子的细节并进同一张卡，不要拆得过碎。
- 需要拆成多张子卡的大目标用**容器类型**，其下的具体卡用 \`parent\`/\`child\` 关系挂上去（只有容器类型能挂子卡）。
- 有先后依赖的用 \`blocked_by\`/\`blocks\`；必须一起发布的用 \`coupled_with\`。
- **可引用现有卡建立跨卡依赖**：若上下文给了「项目全盘视野」（现有需求卡及其状态），关系 \`target\` 既可指本批候选卡、也可指**现有卡的 id**。尤其当新需求依赖某张**正在跑或未完成**的现有卡时，给新卡加一条 \`blocked_by → 该现有卡 id\`，让它排在其后。注意：\`blocks\` 的目标只能是**尚未启动**的卡，别用 \`blocks\` 去挂一张已经在跑的卡。
- 标题简短点题；描述用 markdown，把意图、范围、验收要点写清楚（呈现时会渲染，不要写成代码块包整段）。
- **保留附件路径**：用户描述里若出现附件路径（图片/文件，如 \`C:\\...\\paste-xxx.png\`），把相关附件的**完整路径**原样写进对应候选卡的描述里（例如「参见附件：\`<完整路径>\`」），**不要只写"截图/附件"而丢掉路径**——下游 agent 要靠这个路径打开它才能理解任务。`

const DECOMPOSE_TEMPLATE_TAIL = `## 输出什么结构

只输出一个 JSON 数组，每个元素是一张候选卡：

\`\`\`json
[
  {
    "proposedName": "add-dark-mode",
    "title": "增加暗色模式",
    "description": "## 目标\\n给整个界面增加一套暗色主题……",
    "typeId": "feature",
    "relations": [{ "kind": "parent", "target": "theme-revamp-epic" }]
  }
]
\`\`\`

字段约束：

- \`proposedName\`：git 友好 slug（小写字母/数字/连字符、不以连字符起止），本批内唯一；它既作卡 id，也作分支名。
- \`title\`：非空短标题。
- \`description\`：markdown 文本。
- \`typeId\`：取自上面「可用类型」列表里的某个 id（不要发明列表外的 typeId）。
- \`relations\`：零或多条 \`{ kind, target }\`；\`kind\` 取 \`parent\`/\`child\`/\`blocked_by\`/\`blocks\`/\`coupled_with\`，\`target\` 引用本批某张卡的 \`proposedName\` **或全盘视野里某张现有卡的 id**。\`blocks\` 的目标必须是尚未启动的卡。`

/**
 * 由项目在册类型自动合成「生效分解 skill」：固定拆分模板 + 由各类型 name/description 生成的「可用类型」分类段。
 * 类型描述是分类规则的单一来源——改类型描述即改本文本。纯函数，main 与 renderer（设置页预览）共享。
 */
export function buildDecomposeSkill(types: CardTypeDef[]): string {
  const lines = (Array.isArray(types) ? types : []).map((t) => {
    const archetype = t.archetype === 'container' ? '容器·可挂子卡' : '子叶·流通单位'
    const desc = typeof t.description === 'string' && t.description.trim() !== '' ? t.description.trim() : '（无描述）'
    return `- \`${t.id}\`（${t.name}，${archetype}）：${desc}`
  })
  const classification =
    '## 可用类型\n\n按下列类型给每张卡选一个最贴切的 `typeId`（只能从这些里选）：\n\n' +
    (lines.length > 0 ? lines.join('\n') : '（项目暂无可用类型）')
  return `${DECOMPOSE_TEMPLATE_HEAD}\n\n${classification}\n\n${DECOMPOSE_TEMPLATE_TAIL}\n`
}

/** 候选卡批校验结果：ok 为真即整批可落库，否则 issues 列出每处问题。 */
export interface BatchValidation {
  ok: boolean
  issues: CandidateIssue[]
}

/**
 * 校验一批候选卡：每张过卡模型校验、预取名本批内唯一、关系边过**共享边谓词** `isRelationEdgeLegal`
 * （引用宇宙为「现有落库卡 ∪ 本批新卡」——target 可指现有卡；含「blocks 目标须未跑」与跨图成环）。
 * 不抛异常，把每处问题收进 issues（带 index 与可读原因），供审阅界面逐条提示。
 * `existing` 为当前项目现有落库卡（缺省空数组即退化为纯批内校验，向后兼容）。
 */
export function validateCandidateBatch(
  cards: CandidateCard[],
  registry?: TypeArchetypeMap,
  existing: StoredCard[] = []
): BatchValidation {
  const issues: CandidateIssue[] = []
  if (!Array.isArray(cards)) return { ok: false, issues: [{ index: -1, proposedName: '', reason: '候选卡批不是数组' }] }
  // 引用宇宙：现有落库卡 ∪ 本批新卡（统一到 EdgeCardView）——关系边合法性对标编排路。
  const universe = new Map<string, EdgeCardView>()
  for (const s of existing ?? []) {
    if (s?.proposedName) {
      universe.set(s.proposedName, {
        typeId: s.typeId,
        status: s.status,
        activeRunId: s.activeRunId,
        relations: s.relations ?? []
      })
    }
  }
  for (const c of cards) {
    if (c?.proposedName) universe.set(c.proposedName, { typeId: c.typeId, status: '未开始', relations: c.relations ?? [] })
  }
  const seen = new Set<string>()
  cards.forEach((c, index) => {
    const v = validateCandidateCard(c, registry)
    if (!v.ok) {
      issues.push({ index, proposedName: c?.proposedName ?? '', reason: v.reason })
      return
    }
    if (seen.has(c.proposedName)) {
      issues.push({ index, proposedName: c.proposedName, reason: `预取名「${c.proposedName}」在本批内重复（须唯一）` })
    }
    seen.add(c.proposedName)
    for (const r of c.relations) {
      const ev = isRelationEdgeLegal(c.proposedName, r, universe, registry)
      if (!ev.ok) issues.push({ index, proposedName: c.proposedName, reason: ev.reason })
    }
  })
  return { ok: issues.length === 0, issues }
}

/**
 * 规整一批候选卡：把重复的预取名按出现顺序加后缀去重（首张保留原名）。
 * 关系 target 按名引用——首张保留原名故指向它的关系不变；不改写关系。
 */
export function normalizeCandidateBatch(cards: CandidateCard[]): CandidateCard[] {
  const taken = new Set<string>()
  return cards.map((c) => {
    const unique = dedupeProposedName(c.proposedName, taken)
    taken.add(unique)
    return unique === c.proposedName ? c : { ...c, proposedName: unique }
  })
}
