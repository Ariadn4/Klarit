/**
 * 编排核：把全局 agent 的「意图 → 成套卡操作」收敛到一条可注入、可测的链路。装配全盘视野（board-context）
 * + 拼编排指令 → 注入的 producer 产出 ops（真=流式续接 runner，测试=假全局 agent）→ 逐 op 校验 → 提案。
 * 只**产出提案**、**只读**（不落盘、不碰 git）。是聊天入口与将来别处升级共用的单一编排核。
 */

import type {
  ArchiveDocEntry,
  CardOp,
  CardTypeDef,
  ConversationMessage,
  OrchestrationOutcome,
  StoredCard,
  SuggestedProject,
  WorkflowDefinition,
  WorkflowProposal,
  WorkflowSummary
} from '../shared/types'
import { validateOps } from '../shared/card-ops'
import { buildBoardContext, type WorkflowChoice } from '../shared/board-context'
import { typeArchetypeMap, coerceToRegisteredType, DEFAULT_CARD_TYPES } from '../shared/card-type'
import { buildAuthorWorkflowSkill, validateWorkflow, checkBranchPairing, repairWorkflow, buildScaffoldedWorkflow } from '../shared/workflow'
import { resolveLocalized } from '../shared/localized'
import { DEFAULT_LANGUAGE } from '../shared/language'

/** 编排核依赖（注入以便测试，不绑 Electron）。全盘数据 provider 限本项目。 */
export interface OrchestrateDeps {
  getCards: () => StoredCard[]
  getTypes: () => CardTypeDef[]
  getGoals: () => string
  getConstitution: () => string[]
  /** 可选工作流（供新项目挑一个 + 其类型）；缺省空数组。 */
  getWorkflows?: () => WorkflowChoice[]
  /** 可改写的工作流摘要（id + 名 + 是否无效），供 agent 认识可改哪些流、按 id 点名 baseId；缺省空。 */
  getWorkflowSummaries?: () => WorkflowSummary[]
  /** 当前项目的活动工作流完整定义（改写意图的默认基准起点）；无则 null。 */
  getActiveWorkflow?: () => WorkflowDefinition | null
  /** 当前项目成员仓（多仓上下文，供 agent 按仓组织 git 操作）；缺省/单仓空。 */
  getProjectRepos?: () => AuthoringRepo[]
  /** 某会话的历史（供多轮续接的 producer 用）；缺省空。 */
  getHistory?: (conversationId?: string) => ConversationMessage[]
  budgetChars?: number
}

/** producer 输出：已（由真实现内部 normalizeOps）解析为结构化 ops + 可选自然语言答复 + 可选新项目提议 + 可选工作流。 */
export interface ProducedOps {
  ops: CardOp[]
  reply?: string
  suggestedProject?: SuggestedProject
  /**
   * 写/改工作流意图时：agent 产出的**原始**完整定义（经 migrateWorkflowShape 归一形状）+ 可选 baseId。
   * **不含 issues**——校验（validateWorkflow/checkBranchPairing）在编排核做，producer 只解析（与 ops 同样职责分工）。
   */
  workflow?: { workflow: WorkflowDefinition; baseId?: string }
}

/**
 * producer：拿装配好的编排 prompt 与上下文产出 ops。真实现驱动配置的默认 agent（流式续接）并解析回复；
 * 测试注入**假全局 agent**返固定 ops（不触真 CLI）。失败/未配置由本服务优雅降级为空提案。
 */
export type OpsProducer = (
  prompt: string,
  ctx: { intent: string; conversationId?: string; history: ConversationMessage[] }
) => Promise<ProducedOps>

export interface OrchestrateInput {
  intent: string
  conversationId?: string
}

export interface OrchestrateSeam {
  orchestrate: (input: OrchestrateInput, projectId: string | null) => Promise<OrchestrationOutcome>
}

/**
 * 编排契约（喂给 agent）：把它塑造成**自由对话助手**——回复优先、纯聊天有效、识别到意图才按技能产卡操作。
 * 各操作技能内联（单一来源）。破坏性收边红线。
 */
const OPS_CONTRACT = `# 你是 Klarit 的需求助手（自由对话）

你像一个懂产品与架构的助手：可以**自由聊天**——和用户讨论想法、答疑、给建议、一起理清思路。
**你的自然语言回复永远放在 "reply" 里，是第一位的。** 如果用户只是聊天/提问、并不需要动卡，就**只回复**（"ops" 留空数组），这完全正常、不是失败——别为了凑操作而硬编需求。

你**只读、只编排卡**（管理状态）：绝不写代码、绝不碰 git；你产出的卡操作是**提案**，由用户确认后系统才应用。

## 什么时候动手：识别到「塑造需求」的意图 → 用对应技能

只有当你识别到用户确实想**塑造需求**时，才在自然回复之外、按下面对应**技能**的格式在 "ops" 里产出结构化操作：

### 技能·新建卡（create）
用户想加新需求 → 一个点子一张卡：\`{ "kind": "create", "card": { "proposedName", "title", "description", "typeId", "relations": [] } }\`

### 技能·改卡（adjust）
用户想改某卡的标题/描述/类型 → \`{ "kind": "adjust", "target": "<卡预取名>", "patch": { "title"?, "description"?, "typeId"? } }\`

### 技能·拆卡（split）
用户想把一张卡拆成几张 → \`{ "kind": "split", "source": "<卡预取名>", "into": [ <候选卡>, ... ], "edgeInherit": "all"|"none" }\`

### 技能·并卡（merge）
用户想把几张卡合并 → \`{ "kind": "merge", "sources": ["<预取名>", ...], "into": "<既有预取名>"|<候选卡>, "mergedDescription"? }\`

### 技能·关系（relate）
用户想建立/解除卡间关系 → \`{ "kind": "relate", "op": "add"|"remove", "from": "<预取名>", "edge": { "kind", "target" } }\`

### 技能·删卡（delete）
用户想删掉某张卡（作废/建错）→ \`{ "kind": "delete", "target": "<卡预取名>" }\`（破坏性，会删该卡并清其它卡指向它的关系边）。

### 技能·新建项目
当意图是一个**新项目/新东西**（与当前项目无关的全新目标），或**当前未绑定项目**（全盘视野为空）→ 在输出对象里给
\`"suggestedProject": { "name": "新项目名", "description": "一句话描述", "workflowId": "<从上面「可选工作流」里挑一个>" }\`，并把该项目的初始需求作为一批 \`create\` ops 一起给出（用户选定目录建好项目后种进去）。
新项目该用哪套卡类型**取决于你为它挑的工作流**：从上面「可选工作流」里选一个填进 \`workflowId\`，并**只用该工作流列出的类型 id** 给卡设 \`typeId\`。若上面没有可选工作流，则用默认类型 id：\`epic\`（容器）、\`feature\`（子叶）、\`bug\`（子叶）。

卡字段约束（同分解）：\`proposedName\` 为 git 友好 slug、\`typeId\` 取自项目在册类型、\`relations.kind\` 取 \`parent\`/\`child\`/\`blocked_by\`/\`blocks\`/\`coupled_with\`。

## 红线：破坏性收边

结构性操作（adjust/split/merge/relate/delete）**只能作用于「待办·可结构操作」的卡**。
对「已流动·仅建议新建」的卡，**不要**产出针对它的跨卡结构操作或 delete，请改为用 create 建议一个新需求来承载。
你**只看得到当前项目**，**不要**引用或操作任何别的已有项目。

## 输出格式

只输出一个 JSON 对象，不要任何解释或 markdown 围栏：
- 只是聊天 → \`{ "reply": "你的自然回复", "ops": [] }\`
- 要动卡 → \`{ "reply": "你的自然回复", "ops": [ ...按技能格式... ], "suggestedProject"?: { "name", "description" } }\``

/** 一个成员仓（多仓上下文）：名 + 可选标签 + 成员 id（供 agent 按 tag/仓收窄节点 target）。 */
export interface AuthoringRepo {
  name: string
  tag?: string
  memberId?: string
}

/** 写工作流上下文（供 agent 识别到写/改工作流意图时用）：可改写工作流摘要 + 活动工作流基准定义 + 成员仓。 */
export interface AuthoringContext {
  summaries: WorkflowSummary[]
  activeWorkflow: WorkflowDefinition | null
  /** 本项目成员仓（≥2 即多仓，供教 agent 按仓组织 git 操作）；缺省/单仓不输出该层。 */
  repos?: AuthoringRepo[]
}

/**
 * 拼「写工作流」段：内联写工作流 skill（自动生成、单一来源）+ 可改写工作流摘要（id/名/是否无效）+
 * 活动工作流的完整定义作改写基准起点。无摘要且无活动工作流时返回空串（不给 agent 徒增噪音）。
 */
function buildAuthoringSection(ctx: AuthoringContext): string {
  const { summaries, activeWorkflow } = ctx
  if (summaries.length === 0 && !activeWorkflow) return ''
  const parts: string[] = [
    '',
    '# 另一种产出：写/改工作流',
    '除了聊天与卡操作，你还可以帮用户**写或改工作流**。只有识别到明确的写/改工作流意图时才这么做——',
    '此时按下面的 skill 输出带 `workflow` 字段的对象（`ops` 留空）；否则照常聊天或产卡操作。',
    '',
    buildAuthorWorkflowSkill()
  ]
  if (summaries.length > 0) {
    parts.push(
      '',
      '## 可改写的工作流（改写时把 baseId 填成其中某个 id）',
      ...summaries.map((s) => {
        const name = resolveLocalized(s.name, DEFAULT_LANGUAGE) || s.id
        const invalid = s.invalidReason ? `（无效：${s.invalidReason}）` : ''
        return `- \`${s.id}\`「${name}」${invalid}`
      })
    )
  }
  // 多仓（≥2 成员仓）：列出成员仓与标签，供 agent 知晓并按 tag/仓收窄节点 target。
  const repos = (ctx.repos ?? []).filter((r) => r.name)
  if (repos.length > 1) {
    parts.push(
      '',
      '## 本项目成员仓（多仓：引擎 git 操作默认逐仓跑；可按 tag/仓给节点 target 收窄）',
      ...repos.map((r) => {
        const tag = r.tag ? `，标签「${r.tag}」` : ''
        const mid = r.memberId ? `，memberId=\`${r.memberId}\`` : ''
        return `- ${r.name}${tag}${mid}`
      })
    )
  }
  if (activeWorkflow) {
    parts.push(
      '',
      '## 当前活动工作流（改写的默认基准；以它为起点改，baseId 用它的 id）',
      '```json',
      JSON.stringify(activeWorkflow),
      '```'
    )
  }
  return parts.join('\n')
}

/** 拼编排指令：全盘视野 + 自由对话/技能契约 + （可选）写工作流段 + 用户这轮的话。unbound=当前未绑定项目。 */
export function buildOrchestratePrompt(
  board: string,
  intent: string,
  _types: CardTypeDef[],
  unbound = false,
  authoring?: AuthoringContext
): string {
  const head = unbound
    ? '# 当前未绑定任何项目\n用户尚未打开/绑定项目。可以自由聊；若意图是要做个新东西，走「新建项目」技能给出 suggestedProject + 初始 create ops。\n'
    : ''
  const authoringSection = authoring ? buildAuthoringSection(authoring) : ''
  return [head + board, '', OPS_CONTRACT, authoringSection, '', '# 用户这轮说', intent].join('\n')
}

/**
 * 从会话历史里取「最后一条 agent 消息携带的未存工作流草稿定义」——即 proposal.workflow.workflow。
 * 只看**末条** agent 消息（迭代改写场景下它正是刚产出的草稿）：命中则返回其定义，未带草稿或无 agent 消息则 null。
 */
function lastDraftWorkflow(history: ConversationMessage[]): WorkflowDefinition | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role !== 'agent') continue
    return m.proposal?.workflow?.workflow ?? null
  }
  return null
}

export function createOrchestrateSeam(deps: OrchestrateDeps, produce: OpsProducer): OrchestrateSeam {
  return {
    async orchestrate({ intent, conversationId }, projectId) {
      // 未绑定项目**不再是死空态**：空全盘视野照常跑，agent 可对话并提议新建项目。
      const board = buildBoardContext({
        cards: deps.getCards(),
        types: deps.getTypes(),
        goals: deps.getGoals(),
        constitution: deps.getConstitution(),
        workflows: deps.getWorkflows?.() ?? [],
        budgetChars: deps.budgetChars
      })
      const history = deps.getHistory?.(conversationId) ?? []
      // 改写基准：会话末条 agent 消息若带一份**未存库的工作流草稿**（proposal.workflow.workflow），
      // 以该草稿定义作基准（让用户就着刚产出的草稿改），覆盖默认的「库里活动工作流」；无草稿则回落活动工作流。
      // 草稿不落库（无库 id → baseId 由 producer 留空，整体替换新建，合「无 diff」契约），只在会话里滚动。
      const draftBase = lastDraftWorkflow(history)
      // 写工作流上下文：可改写工作流摘要（恒带）+ 基准完整定义（草稿优先，否则活动工作流）。缺省 provider 时为空态。
      const authoring: AuthoringContext = {
        summaries: deps.getWorkflowSummaries?.() ?? [],
        activeWorkflow: draftBase ?? deps.getActiveWorkflow?.() ?? null,
        repos: deps.getProjectRepos?.() ?? []
      }
      const prompt = buildOrchestratePrompt(board, intent, deps.getTypes(), !projectId, authoring)
      let produced: ProducedOps
      try {
        produced = await produce(prompt, {
          intent,
          conversationId,
          history
        })
      } catch (e) {
        // producerFailed 标记「agent 调用抛错」，供无头 author 区分它与「跑通无产出」（见设计决策 #11）。
        // 加性/可选，聊天路径（runOrchestrateTurn）不受影响。
        const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        console.error('[orchestrate] produce 抛错:', e)
        return {
          ops: [],
          issues: [],
          reply: `（未能产出提案：agent 调用失败——${detail}）`,
          producerFailed: true
        }
      }
      const rawOps = Array.isArray(produced?.ops) ? produced.ops : []
      // 新项目的卡将落进一个**全新项目**（默认类型、空看板）——按默认类型+空卡校验（否则会拿当前项目
      // 的类型集去校验新项目的卡，typeId 对不上被误判非法）。非新项目按当前项目。
      const isNew = !!produced?.suggestedProject
      // 新项目按**其选定工作流的类型集**校验（该工作流建议类型 + 默认；未选工作流则默认）；非新项目按当前项目。
      const wfId = produced?.suggestedProject?.workflowId
      const wf = isNew && wfId ? deps.getWorkflows?.().find((w) => w.id === wfId) : undefined
      const types = isNew ? (wf ? wf.types : [...DEFAULT_CARD_TYPES]) : deps.getTypes()
      const cards = isNew ? [] : deps.getCards()
      // 容错修复（避免可救的卡被误判非法丢弃）：
      // ① typeId 近似/越界 → 纠到在册类型；② 卡想挂子卡（有 child 关系）但类型不是容器 → 纠到容器类型（保住层级）。
      const reg = typeArchetypeMap(types)
      const containerId = types.find((t) => t.archetype === 'container')?.id
      const fix = <T extends { typeId: string; relations?: { kind: string }[] }>(c: T): T => {
        let typeId = coerceToRegisteredType(c.typeId, types)
        const wantsChildren = (c.relations ?? []).some((r) => r.kind === 'child')
        if (wantsChildren && reg.get(typeId) !== 'container' && containerId) typeId = containerId
        return { ...c, typeId }
      }
      const ops = rawOps.map((op) => {
        if (op.kind === 'create') return { ...op, card: fix(op.card) }
        if (op.kind === 'split') return { ...op, into: op.into.map(fix) }
        if (op.kind === 'merge' && typeof op.into !== 'string') return { ...op, into: fix(op.into) }
        return op
      })
      const { issues } = validateOps(ops, { cards, registry: typeArchetypeMap(types) })
      // 工作流提案（若有）：过 validateWorkflow + checkBranchPairing，**修好再报**——两闸独立收集原因，
      // 非法定义仍带出（不丢弃、不驳回重问），供人在只读预览里补齐后存库。
      const workflow = buildWorkflowProposal(produced?.workflow)
      return { ops, issues, reply: produced?.reply, suggestedProject: produced?.suggestedProject, workflow }
    }
  }
}

/**
 * 无头 author 的富结果：区分**成功**与三类**失败**，供调用方按种类记日志/有界重试/失败轻提示（设计决策 #11）——
 * 不再把不同失败一律抹成 `null`。
 * - `proposal` 存在 + `failure` 缺省 → 成功（issues 空、可存库）。
 * - `proposal` 存在 + `failure==='invalid'` → 校验不过（issues 非空，仍带出提案供调用方决定）。
 * - `proposal` 为 null + `failure==='threw'` → agent 调用抛错/未配置（seam `reply` 上浮到 `reply`）。
 * - `proposal` 为 null + `failure==='empty'` → 跑通但无工作流产出。
 */
export interface AuthorWorkflowResult {
  proposal: WorkflowProposal | null
  /** seam 的自然语言答复（失败原因上浮用）。 */
  reply?: string
  failure?: 'threw' | 'empty' | 'invalid'
}

/**
 * 无头写工作流核：以**显式 projectId** + **系统合成意图**跑编排 seam，抽出工作流提案并**区分失败种类**。
 * 不绑发送者事件、不追加任何用户会话——聊天路径之外、供后台任务（如导入后自动派工作流）复用的可注入核。
 * 复用同一 `createOrchestrateSeam` → `buildWorkflowProposal`（repairWorkflow + 两闸校验），不重复实现修复/校验，
 * 也**不丢弃** seam 能区分失败的信息（producerFailed / reply / issues）。producer 抛错经 seam 内部优雅降级，此处不抛。
 */
export async function authorWorkflow(
  deps: OrchestrateDeps,
  produce: OpsProducer,
  projectId: string,
  intent: string
): Promise<AuthorWorkflowResult> {
  const outcome = await createOrchestrateSeam(deps, produce).orchestrate({ intent }, projectId)
  if ('unbound' in outcome) return { proposal: null, failure: 'empty' }
  const proposal = outcome.workflow ?? null
  if (proposal) {
    // **固定脚手架规整**（仅自动路）：author 照旧产整份，此处确定性把它套到固定脚手架上——干活节点作
    // 中间，脊柱/验收门/归档由 buildScaffoldedWorkflow 丢弃并以固定头/尾替换（顺序钉死：中间→验收门→归档
    // →合并→清理），从结构上消灭脊柱排序问题（见 workflow-authoring）。聊天路（seam 直用）不经此，不受影响。
    const normalized = normalizeOntoScaffold(proposal)
    return { proposal: normalized, reply: outcome.reply, failure: normalized.issues.length > 0 ? 'invalid' : undefined }
  }
  if (outcome.producerFailed) return { proposal: null, reply: outcome.reply, failure: 'threw' }
  return { proposal: null, reply: outcome.reply, failure: 'empty' }
}

/**
 * 推断脚手架变体：author 产出里含引擎 `open-pr` 操作 → `'pr'`（推分支 + 开 PR，合并在平台上发生），
 * 否则 `'local-merge'`（本地直合）。纯结构判定，空/缺节点安全回落 `local-merge`。
 */
export function inferScaffoldVariant(def: WorkflowDefinition): 'local-merge' | 'pr' {
  const hasOpenPr = (def?.nodes ?? []).some(
    (n) => n.executor?.kind === 'engine' && n.executor.operation === 'open-pr'
  )
  return hasOpenPr ? 'pr' : 'local-merge'
}

/**
 * 从 author 产出抽出**分类归档配置**：取**第一个**引擎 `archive-docs` 节点的 `executor.archiveDocs`
 * （每条 `{ path, kind }`，缺省空数组）。规整时把它带进脚手架固定归档节点；无 archive-docs 节点或无配置
 * → `[]`（运行期回落扫描登记表兜底）。纯函数。
 */
export function extractArchiveDocs(def: WorkflowDefinition): ArchiveDocEntry[] {
  for (const n of def?.nodes ?? []) {
    if (n.executor?.kind === 'engine' && n.executor.operation === 'archive-docs') {
      return n.executor.archiveDocs ?? []
    }
  }
  return []
}

/**
 * 把 author 的整份产出**规整到固定脚手架**：推断变体、抽归档清单，将 author 的节点作 middle 喂给
 * `buildScaffoldedWorkflow`（丢弃脊柱/验收门/归档、以固定头/尾替换），再经 `buildWorkflowProposal`
 * （repairWorkflow + 两闸校验）重建提案。透传原 baseId。规整不可能产出 undefined（脚手架恒有骨架），
 * 但兜底回原提案以防御。
 */
function normalizeOntoScaffold(proposal: WorkflowProposal): WorkflowProposal {
  const authorDef = proposal.workflow
  const normalizedDef = buildScaffoldedWorkflow(
    inferScaffoldVariant(authorDef),
    authorDef.nodes,
    extractArchiveDocs(authorDef),
    { id: authorDef.id, name: authorDef.name, suggestedTypes: authorDef.suggestedTypes }
  )
  return buildWorkflowProposal({ workflow: normalizedDef, baseId: proposal.baseId }) ?? proposal
}

/**
 * 组装 `WorkflowProposal`：先**确定性修复到合法**（`repairWorkflow`——补删分支节点、纠 stageId、丢坏节点、
 * 过滤非法子结构；对齐卡操作「容错修复后再校验」的先例），**直接给用户合法工作流**；修复后再过两闸校验，
 * `issues` 作最后兜底（正常修复能补的情况下为空，仅无骨架的极端输入才残留）。无产出返回 undefined。
 */
function buildWorkflowProposal(produced: ProducedOps['workflow']): WorkflowProposal | undefined {
  if (!produced?.workflow) return undefined
  const def = repairWorkflow(produced.workflow)
  const issues: string[] = []
  const v = validateWorkflow(def)
  if (!v.ok) issues.push(v.reason)
  const bp = checkBranchPairing(def)
  if (!bp.ok) issues.push(bp.reason)
  return { workflow: def, baseId: produced.baseId, issues }
}
