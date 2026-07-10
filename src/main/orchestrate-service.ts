/**
 * 编排核：把全局 agent 的「意图 → 成套卡操作」收敛到一条可注入、可测的链路。装配全盘视野（board-context）
 * + 拼编排指令 → 注入的 producer 产出 ops（真=流式续接 runner，测试=假全局 agent）→ 逐 op 校验 → 提案。
 * 只**产出提案**、**只读**（不落盘、不碰 git）。是聊天入口与将来别处升级共用的单一编排核。
 */

import type {
  CardOp,
  CardTypeDef,
  ConversationMessage,
  OrchestrationOutcome,
  StoredCard,
  SuggestedProject
} from '../shared/types'
import { validateOps } from '../shared/card-ops'
import { buildBoardContext, type WorkflowChoice } from '../shared/board-context'
import { typeArchetypeMap, coerceToRegisteredType, DEFAULT_CARD_TYPES } from '../shared/card-type'

/** 编排核依赖（注入以便测试，不绑 Electron）。全盘数据 provider 限本项目。 */
export interface OrchestrateDeps {
  getCards: () => StoredCard[]
  getTypes: () => CardTypeDef[]
  getGoals: () => string
  getConstitution: () => string[]
  /** 可选工作流（供新项目挑一个 + 其类型）；缺省空数组。 */
  getWorkflows?: () => WorkflowChoice[]
  /** 某会话的历史（供多轮续接的 producer 用）；缺省空。 */
  getHistory?: (conversationId?: string) => ConversationMessage[]
  budgetChars?: number
}

/** producer 输出：已（由真实现内部 normalizeOps）解析为结构化 ops + 可选自然语言答复 + 可选新项目提议。 */
export interface ProducedOps {
  ops: CardOp[]
  reply?: string
  suggestedProject?: SuggestedProject
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

### 技能·新建项目
当意图是一个**新项目/新东西**（与当前项目无关的全新目标），或**当前未绑定项目**（全盘视野为空）→ 在输出对象里给
\`"suggestedProject": { "name": "新项目名", "description": "一句话描述", "workflowId": "<从上面「可选工作流」里挑一个>" }\`，并把该项目的初始需求作为一批 \`create\` ops 一起给出（用户选定目录建好项目后种进去）。
新项目该用哪套卡类型**取决于你为它挑的工作流**：从上面「可选工作流」里选一个填进 \`workflowId\`，并**只用该工作流列出的类型 id** 给卡设 \`typeId\`。若上面没有可选工作流，则用默认类型 id：\`epic\`（容器）、\`feature\`（子叶）、\`bug\`（子叶）。

卡字段约束（同分解）：\`proposedName\` 为 git 友好 slug、\`typeId\` 取自项目在册类型、\`relations.kind\` 取 \`parent\`/\`child\`/\`blocked_by\`/\`blocks\`/\`coupled_with\`。

## 红线：破坏性收边

结构性操作（adjust/split/merge/relate）**只能作用于「待办·可结构操作」的卡**。
对「已流动·仅建议新建」的卡，**不要**产出针对它的跨卡结构操作，请改为用 create 建议一个新需求来承载。
你**只看得到当前项目**，**不要**引用或操作任何别的已有项目。

## 输出格式

只输出一个 JSON 对象，不要任何解释或 markdown 围栏：
- 只是聊天 → \`{ "reply": "你的自然回复", "ops": [] }\`
- 要动卡 → \`{ "reply": "你的自然回复", "ops": [ ...按技能格式... ], "suggestedProject"?: { "name", "description" } }\``

/** 拼编排指令：全盘视野 + 自由对话/技能契约 + 用户这轮的话。unbound=当前未绑定项目。 */
export function buildOrchestratePrompt(board: string, intent: string, _types: CardTypeDef[], unbound = false): string {
  const head = unbound
    ? '# 当前未绑定任何项目\n用户尚未打开/绑定项目。可以自由聊；若意图是要做个新东西，走「新建项目」技能给出 suggestedProject + 初始 create ops。\n'
    : ''
  return [head + board, '', OPS_CONTRACT, '', '# 用户这轮说', intent].join('\n')
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
      const prompt = buildOrchestratePrompt(board, intent, deps.getTypes(), !projectId)
      let produced: ProducedOps
      try {
        produced = await produce(prompt, {
          intent,
          conversationId,
          history: deps.getHistory?.(conversationId) ?? []
        })
      } catch {
        return { ops: [], issues: [], reply: '（未能产出提案：agent 调用失败或未配置默认 agent）' }
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
      return { ops, issues, reply: produced?.reply, suggestedProject: produced?.suggestedProject }
    }
  }
}
