## Why

全局 agent 现在只会编排卡片。可工作流本身也是管理态、也需要被塑造——用户想要一套「带评审门的 PR 流」或「在现有流里加个 typecheck 门」时，只能自己去 `WorkflowEditor` 里一个节点一个节点手搭。工作流的数据模型（阶段 / 节点 / 执行者联合 / 引擎操作集 / 门语义 / 分支配对）门槛不低，手搭既慢又容易搭出过不了校验的形状。

工作流跟卡片一样是**管理态**（库里的 `workflow.yaml`，不是 agent 要写的交付代码），完全能走全局 agent 已经跑通的那条红线：**agent 提议 → 人审 → 系统落库 → 绝不碰代码/git**。所以把「帮用户写工作流」接到现有 decompose/orchestrate 的「skill → 结构化产出 → 校验 → 人审」rail 上，是一次自然的能力扩张，而非另起炉灶。

## What Changes

- **全局 agent 多一项平行能力：在对话里创建或改写工作流**。用户在全局对话面板说「帮我做个带评审门的 PR 工作流」，agent 在**一轮**内自行在 `{卡操作, 工作流提案, 自由聊天}` 之间选（与它现在在 `ops`/`suggestedProject`/纯回复之间选同构），识别到工作流意图就产出一份完整的 `WorkflowDefinition` 提案。
- **create 与 edit 都支持，但一律整体替换**：agent 永远返回**完整**的 `WorkflowDefinition`。编辑时把作为基准的现有定义注入当起点，agent 返回全新完整定义覆盖保存。v1 **不做 diff/patch**。
- **编辑基准默认取活动工作流**（复用已有 `getActiveWorkflowId()`）。编排上下文恒带便宜的**工作流摘要**（id + 名字 + 是否无效）；要改别的工作流则 agent 从摘要里点名一个 `baseId`，编排核再注入那份完整定义。无 `baseId` 即 create 新工作流。
- **新增 `buildAuthorWorkflowSkill()`（shared）**：从 `ENGINE_OPERATIONS` / 执行者类型 / 校验规则**自动生成**写工作流 skill 文本——与 `buildDecomposeSkill(types)` 同一先例，保证 skill 永不跟 `validateWorkflow` 漂移。该 skill 就地拼进编排 prompt。
- **编排产出解析加一个 `workflow` 分支**：`parseOpsReply` 除 `reply`/`ops`/`suggestedProject` 外多认一个 `workflow` 字段，收敛为 `WorkflowDefinition`（含可选 `baseId`）。
- **校验闸复用、不旁路**：产出的工作流过既有 `validateWorkflow` + `checkBranchPairing`。校验失败**修好再报问题**——把没过校验的点像 `validateCandidateBatch` 的 issues 那样列出来，连同那份不完美但可看的工作流一起放进预览，让人在存库前自己补，半成品不丢（不驳回重问）。
- **预览 / 落库 UI**：新增与卡片 `proposal` 平行的 `workflowProposal` 消息类型；用 `WorkflowEditor` **只读预览**提案的工作流；「存库」按钮调 `workflow-store.save()` 落库（create 新包，或覆盖 `baseId` 对应的包）。

## Capabilities

### New Capabilities

- `workflow-authoring`：全局 agent 把用户意图产出为一份完整 `WorkflowDefinition` 提案的端到端能力——自动生成的写工作流 skill、产出解析为工作流、校验并容错修复后报问题、`workflowProposal` 的预览与人确认后存库。

### Modified Capabilities

- `global-agent`：把全局 agent 的定位从「只编排卡」扩成「也能编排工作流」——同一条只读 / 只提案 / 人确认 / 系统落库的红线，工作流作为卡片的姊妹管理态。
- `requirement-orchestration`：编排核产出多一个 `workflow` 分支（`OrchestrationProposal.workflow`）；上下文装配多带**工作流摘要**并按 `baseId`/活动工作流注入基准定义；prompt 内联技能新增写工作流 skill。
- `global-agent-chat`：面板呈现 `workflowProposal` 消息（`WorkflowEditor` 只读预览 + 存库按钮），与卡操作提案审阅并列。

## Impact

- **shared**：`shared/workflow.ts` 加 `buildAuthorWorkflowSkill()`；`shared/types.ts` 加 `workflow` 产出型 / `workflowProposal` 消息型（含 `baseId`、校验 issues）。
- **main**：`orchestrate-producer.ts` 的 `parseOpsReply` 加 `workflow` 分支与收敛；`orchestrate-service.ts` 上下文装配带工作流摘要 + 注入基准定义、产出走 `validateWorkflow`/`checkBranchPairing`；落库经 `workflow-store.save()`。编排 prompt 装配处拼入写工作流 skill。
- **renderer**：`GlobalChatPanel` 呈现 `workflowProposal`（复用 `WorkflowEditor` 只读预览）；`globalChat` store 加落库动作；i18n 文案。
- **IPC/preload**：新增「保存提案工作流」通道（或复用既有 workflow 保存通道）。
- **复用、不重造**：orchestrate rail、`parseOpsReply`、`validateWorkflow`/`checkBranchPairing`/`workflowSummary`、`WorkflowEditor`、`workflow-store.save()`、`getActiveWorkflowId()`、`buildDecomposeSkill` 的自动生成先例。
- 无破坏性变更：既有卡编排路径行为不变，工作流分支是纯增量。
