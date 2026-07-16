## Context

全局 agent 已有一条跑通的产出 rail：`GlobalChat → orchestrate-service → orchestrate-producer → agent CLI → parseOpsReply → OrchestrationProposal → 人审 → apply`。两个「skill」骑在上面：**orchestrate**（内联 system prompt，产 `{reply, ops, suggestedProject}`）与 **decompose**（可解析 skill，产候选卡）。skill 的本质 = 一段定义结构化输出契约的 prompt；agent 产出结构化 JSON，经解析、校验、人审后落地。

工作流数据模型（`shared/workflow.ts`）已相当完整：封闭执行者联合、8 个引擎操作、门语义、`validateWorkflow` + `checkBranchPairing` 校验、`workflowSummary`。工作流存于库（`workflow-store.ts`，`save()` 已带校验闸）。今天工作流只能在 `WorkflowEditor` 手搭。

本变更把「写工作流」接到同一条 rail：新增第三个 skill 骑手（**author-workflow**），产出物是 `WorkflowDefinition` 而非卡。explore 阶段已定死全部关键取舍，本设计只记落地方式。

## Goals / Non-Goals

**Goals:**
- 全局 agent 在对话里 create 或 edit 工作流，产出经人审后存库。
- 最大化复用现有 rail、校验、编辑器、存储——新增面尽量薄。
- skill 从数据模型单一来源自动生成，永不与校验器漂移。
- 工作流作为卡片的姊妹管理态，走同一条只读/提案/人审/落库红线。

**Non-Goals:**
- **不做 diff/patch**：edit 一律整体替换（agent 返回完整定义）。
- **不做单独分类器/两跳**：agent 在一轮内自路由。
- 不动引擎执行、不跑工作流；只写工作流**定义**。
- 不做跨项目工作流路由（限当前项目可见库）。
- 不新造工作流预览控件（复用 `WorkflowEditor` 只读态）。

## Decisions

### D1. 一轮自路由，skill 就地拼进编排 prompt（不另开 CLI 调用）

编排 prompt 追加 `buildAuthorWorkflowSkill()` 生成的 skill 段；agent 在同一轮里于 `{ops, workflow, 自由聊天}` 之间自选——与它现在在 `ops`/`suggestedProject`/纯回复之间自选同构。`parseOpsReply` 多认一个 `workflow` 字段。

- **为何**：hon“像 decompose 那样调一个 skill”的心智，但保持单跳；与现有路由机制一致，实现最薄。
- **备选**：先跑便宜分类器判是否工作流意图、再用只含工作流 skill 的第二次调用。省 token 但多一跳、加延迟。
- **代价**：每轮编排 prompt 都背工作流 schema（prompt 变胖）。v1 先吃这个胖；prompt 撑不住再拆成两跳。

### D2. edit = 整体替换，基准默认活动工作流

edit 时把基准工作流的**完整定义**注入 prompt 当起点，agent 返回全新完整定义，落库覆盖 `baseId`。基准默认取 `getActiveWorkflowId()`（decompose 已在用）；agent 可从上下文的**工作流摘要**点名另一个 `baseId`。

- **为何**：「在我的流里加个门」是最常见需求，活动工作流是最自然的默认；整体替换免去 diff 机制、校验/落库路径唯一。
- **备选**：diff/patch。更安全但需要 diff 机制、且工作流节点重排下 diff 语义复杂。v1 不值当。
- **上下文成本**：摘要恒带（便宜）；完整定义只在改写轮注入一份（可控）。

### D3. 产出解析 —— 复用 parseOpsReply 的判别式

`parseOpsReply` 抠最外层 JSON 对象，现认 `reply`/`ops`/`suggestedProject`，增认 `workflow`（对象含完整定义 + 可选 `baseId`）。工作流收敛复用 `migrateWorkflowShape`（读宽松形状归一），再过 `validateWorkflow` + `checkBranchPairing`。

- **为何**：判别式已在那，加一个 key 即可；`migrateWorkflowShape` 已能容错归一旧/宽松形状，天然当收敛器。

### D4. 自动修复到合法 —— 直接给用户合法工作流（不要用户回话调整）

产出先过 `repairWorkflow` **确定性修复到合法**，再过 `validateWorkflow` + `checkBranchPairing`。修复补：空 id/名、至少一个阶段、纠节点 stageId、丢执行者非法的节点（不臆造）、过滤产出/门/可写范围/目标为合法子集、**按分支配对补 `delete-branch` 节点**。`issues` 仅作兜底，正常修复能补则为空。

- **为何**：用户要的是「直接拿到一份能用的合法工作流」，而不是「产出带毛病、再回一句话让 agent 调」。LLM 产这个 schema 最常见的失手就是「搭了漂亮的流却忘了删分支节点」——这类确定性可补的，就别丢回给用户。
- **先例**：完全对齐编排核对卡操作的「容错修复后再校验」（`coerceToRegisteredType` + 层级纠正），同一条 rail 的同一套哲学。
- **权衡**：修复只做「可确定性补救」的；无骨架的极端输入（无任何合法节点）不臆造内容，`issues` 兜底、存库禁用——但这是罕见退化路径，非正常路径。

### D5. 预览/落库 UI —— proposal.workflow + 紧凑只读预览（不复用 WorkflowEditor）

工作流提案挂在 `OrchestrationProposal.workflow`（消息经 `proposal` 字段整体持久化，故不另加消息字段——单一来源）。`GlobalChatPanel` 遇到它就渲染一个**紧凑只读预览**（按阶段列节点、各带执行者短标签与门标记）+ 列 issues + 「存库」按钮。存库经既有 `saveWorkflow` IPC 落库，成功标记已存防重复（`savedWorkflowAt`，仿 `appliedAt`）。

- **不复用 `WorkflowEditor`**（原设想）：它是 ~1700 行、按 `workflowId` 载入的**全编辑器**，不适合承载未落库、可能非法的内存定义。紧凑只读预览更轻、更贴合卡片 `ProposalReview` 的既有 pattern。
- **落库通道**：直接复用既有 `saveWorkflow` IPC——`workflow-store.save(def)` 按 `def.id` 建/覆盖包，故改写只需在渲染层把 `def.id` 强制为 `baseId` 再调，**无需新通道**。
- **issues 修复走对话**：紧凑预览非编辑器，有 issues 时禁用存库、提示经对话续接让 agent 重出（而非原设想的「预览编辑器里补齐」）。半成品仍显示，"修好再报" 的价值（看清近似结果 + 引导修复）保留。

### D6. skill 自动生成 —— buildAuthorWorkflowSkill()（shared 纯函数）

从 `ENGINE_OPERATIONS`/`engineOpCapabilities`/执行者联合/校验约束合成 skill 文本，与 `buildDecomposeSkill(types)` 同构。放 `shared/workflow.ts`（与被引用的常量同文件，天然单一来源）。

- **为何**：skill 与校验器同源，改引擎操作集即改 skill，杜绝漂移。

## Risks / Trade-offs

- **[prompt 膨胀]** 每轮编排都背工作流 schema → 保持 skill 段精炼（只列操作/类型/关键约束，不灌满例子）；真撑不住再退到 D1 备选的两跳。
- **[agent 误路由]** 把闲聊当工作流意图、或反之 → skill 段写清「仅识别到明确写/改工作流意图才产 `workflow`」，与现有 ops 路由的意图门槛同调；纯聊天轮不产 `workflow`（有测试守）。
- **[大对象产出不稳]** 完整 `WorkflowDefinition` 比候选卡大得多，agent 更易产出瑕疵 → D4 修好再报问题兜底，半成品不丢；`migrateWorkflowShape` 容错归一降低脆性。
- **[edit 基准歧义]** 用户没点名、有多个工作流 → 默认活动工作流并在 reply 里说明「基于 X 改」，让人一眼看出改的是哪个；点名走 baseId。
- **[覆盖误伤]** edit 覆盖 `baseId` 是破坏性 → 落库前只读预览 + 人确认；预览里能看清覆盖的是哪个包。

## Migration Plan

纯增量，无数据迁移：既有卡编排路径与 `parseOpsReply` 对旧回复行为不变（无 `workflow` 字段即老路径）。`workflowProposal` 是新消息类型，旧会话无此字段、呈现不受影响。回滚 = 撤掉 skill 段拼接与 `workflow` 分支解析，面板忽略 `workflowProposal`。

## 第二轮（dogfood 反馈）：技能形态、多仓、预览重构

dogfood 暴露三个问题，据此演进设计。

### D7. 技能第三形态：引用「已装技能」（installed）

**问题**：author agent 想让某节点用运行时 agent 已有的能力（如 Claude Code 的 `opsx:explore`），但 `AgentInstruction` 只有 `inline`/`file`（file = 包内相对路径）。于是它臆造相对路径、还误判「opsx explore 只产出 explore.md」——把一个已装 CLI 技能当成要本地嵌入的东西。

**决策**：`AgentInstruction` 增加第三种 `installed`：`{ kind: 'installed', name: string }`——引用用户 CLI 里**已安装**的技能，按名字调用。Klarit 不嵌入、不指路径；运行时让 CLI 自己 invoke。三态并存：`inline`（临时文本）/ `file`（用户设进包的外部技能文件）/ `installed`（已装技能，引用即用）。

- 数据模型（`shared/types.ts` 的 `AgentInstruction`）+ 校验（`shared/workflow.ts` `validateInstruction`：name 非空）+ 编辑器执行者详情三态选择 + 运行期解析（engine 把 `installed` 转成「让 CLI 调该技能」的调用形态，按 agent 适配器；无该机制则回落把「请使用你已安装的 X 技能」写进 prompt）。
- author-workflow skill **教它**：要用运行时 agent 已有的能力就用 `installed` 给名字，别臆造路径、别臆测技能产物。上下文给出**用户已装技能清单**供它挑。

### D8. Klarit 自己的全局对话技能，安装进用户 CLI

**问题/方向**（用户）：分解 / 写工作流 / 编排人格这些 Klarit 自己用的技能，也应作为「已装技能」装进用户使用的 CLI，而非每轮内联进 prompt。

**决策**：加一个**按 CLI 的技能安装适配器**——把 Klarit 自带技能幂等安装/更新进当前默认 agent 的技能目录（Claude Code → 其 skills 目录；其它工具 → 各自机制或**回落内联**，不回归）。装好后 Klarit 按名字引用；用户也能看到/改/自己调。这是较重、且 CLI 特定的一块，**独立成一个实现切片**，落地前需定「装到哪个 scope（个人 `~/.claude` vs 项目 `.claude`）+ 覆盖哪些 CLI」——见 Open Questions。

### D9. 多仓目标（target）教学与可见

**问题**：多仓项目里看不出生成的工作流 git 操作是否按多仓来。实则引擎 git 操作**默认逐涉及仓**跑（`target` 缺省 = 全集），已是多仓；只是不可见、且 author 不会主动按仓收窄。

**决策**：author-workflow skill 教 `target`（`all`/`tag`/`repo`/`fromUpstream`）；编排上下文带**本项目成员仓/标签清单**（新 dep `getProjectRepos`）让它知道是多仓、能按 tag 收窄。可见性由 D10 的完整编辑器预览解决（NodeDetail 本就显/编辑每节点 target）。

### D10. 预览改为「打开完整工作流编辑器」（可编辑、顶部保存入库）

**问题**：聊天里的紧凑只读预览看不清门具体验收什么、看不到多仓 target、不能手动改。

**决策**（推翻 D5）：聊天提案里**只留一个「预览工作流」按钮**；点击打开一个**浮层窗口，复用设置里的完整 `WorkflowEditor`**（与设置观感一致、可手动编辑），顶部**保存**即入库。为此给 `WorkflowEditor` 加 `initialDef?`（草稿态：用传入的内存定义种子、不按 id 从库读；保存仍走 `saveWorkflow`，改写时 `def.id` 已强制为 baseId）。这样门/产出/多仓 target 全部可见可改，保存前不落库（人确认＝点保存）。

### 实现切片（按依赖 & 独立性排序）

1. **installed 指令 + 多仓教学**（D7 数据模型/校验/prompt-assembly/skill 教学 + D9 上下文）——自包含、直接修 opsx bug，先做。
2. **编辑器草稿预览**（D10：`WorkflowEditor` 加 `initialDef` + 聊天「预览工作流」浮层）——渲染重构。
3. **installed 的运行期解析**（engine 把 `installed` 转 CLI 调用；含回落）。
4. **Klarit 技能装进 CLI**（D8：按 CLI 适配器）——最重、CLI 特定，待定 scope/覆盖面后做。

## Migration Plan

纯增量，无数据迁移：既有卡编排路径与 `parseOpsReply` 对旧回复行为不变（无 `workflow` 字段即老路径）。`workflowProposal` 是新消息类型，旧会话无此字段、呈现不受影响。`AgentInstruction` 加 `installed` 是判别联合扩展，旧包只含 inline/file、读取不受影响。回滚 = 撤掉 skill 段拼接与 `workflow` 分支解析，面板忽略 `workflowProposal`。

## Open Questions

- ~~落库通道是复用既有 workflow 保存 IPC 还是加薄通道~~ → **已定：复用 `saveWorkflow`**，改写在渲染层强制 `def.id = baseId`，无需新通道。
- ~~预览用紧凑只读还是完整编辑器~~ → **已定（D10）：完整 `WorkflowEditor` 浮层草稿态，可编辑、顶部保存入库。**
- **D8（切片 4）暂缓**（用户 2026-07-15）：覆盖面已定 = **三个 CLI 都做**（Claude Code / Codex / Cursor）；但**先不做**，待前三个切片（installed 指令 + 多仓 + 编辑器预览 + 运行期解析）完成后再回头。scope（个人 vs 项目）与无头调用可靠性落地时再定。已记入记忆 `install-klarit-skills-into-cli`。
