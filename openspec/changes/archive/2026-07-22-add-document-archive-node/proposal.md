## Why

`add-document-registry` 落成后，每个成员仓有了一张**带审批过习惯 prompt 的文档登记表**（哪些是动态文档、哪些是快照文档、各自该怎么续写），`exclude-planning-docs` 又把计划类文档剔了出去，登记表只剩**归档目标**。但这张表现在**没有消费者**——它只是躺着的知识。

用户要的是一个**「归档」引擎操作节点**：挂在工作流交付段，任务收尾时读这张表，把本次任务产生/该沉淀的内容**按用户习惯各归各位**——动态文档就地更新（只留最新现状）、快照文档追加一条冻结记录（如按用户 ADR 习惯，仅重大改动才落）。它照的是**审批过**的 `habitPrompt` 与项目级公约，未审批的至多按 `kind` 兜底。

文档往往不止一处，且彼此独立（更 README、追 ADR、写 changelog 互不相干）。所以在**模型支持子 agent** 时，这个节点 SHALL **派多个子 agent 并行**处理不同文档，各干各的、互不阻塞；模型不支持子 agent 时**退化为串行**（一个 agent 顺次处理），行为等价、只是慢。

这与现有 `open-pr` 同构——都是「对外是引擎操作节点、内部委派 agent」的平台预制节点。本 change 顺着那条已铺好的分派路径加一个 `archive-docs` 操作。

## What Changes

- **新引擎操作 `archive-docs`（内部委派 agent）**：封闭引擎操作集新增一项。对外是引擎操作节点，内部读当前成员仓的文档登记表 + 审批过的 habitPrompt/公约，委派 agent 把本次内容归档到位。**多仓**：每个涉及成员仓归档自己的文档。与 `open-pr` 不同，`archive-docs` **产生文档写入并提交**（不是 `commitChanges:false` 的纯外部动作）。
- **子 agent 并行（能力门控）**：当运行时 agent/模型**支持子 agent** 时，`archive-docs` 派多个子 agent 并行处理不同文档条目；**不支持时退化为单 agent 串行**。能力探测复用现有 capability 门控思路，探测不准时保守走串行。
- **归档路由语义**：按 `ManagedDoc.kind` 决定动作——`dynamic`→就地更新/覆写（只留现状、不留旧版）、`snapshot`→追加冻结记录（照 habitPrompt 的意图，可判定"本次不落"）。委派指令由登记表合成。
- **登记表缺失/未审批的兜底**：无登记表或无 agent 时失败挂起给清楚提示（比照 `open-pr`）；有登记表但某条未审批时，该条至多按 `kind` 兜底、不照未审批习惯；空表 noop 过。
- **写工作流 skill 同步**：`buildAuthorWorkflowSkill` 从数据模型自动带上新操作 `archive-docs`（读登记表、按习惯归档、子 agent 并行/串行退化、产生提交）。

## Capabilities

### New Capabilities
- `document-archive`: **归档语义**——读文档登记表 + 审批过 habitPrompt/公约，按 `kind` 路由（动态就地更新 / 快照追加冻结）、照习惯决定写不写与怎么写；子 agent 支持时并行、否则串行退化；多仓各归各仓；缺表/无 agent/空表的兜底。

### Modified Capabilities
- `workflow-definition`: 封闭引擎操作集加 `archive-docs`（内部委派 agent、**产生文档写入并提交**、不支持门）；`ENGINE_OPERATION_SPECS`/`ENGINE_OPERATIONS` 随之扩展；校验/迁移覆盖新操作。
- `engine-execution`: 引擎 ensure 执行器加 `archive-docs`——读登记表、按能力派子 agent（并行/串行）、按 kind 路由归档、提交文档改动；缺表/无 agent 挂起决策（比照 `open-pr` 失败路由）。
- `workflow-authoring`: `buildAuthorWorkflowSkill` 覆盖 `archive-docs`（读登记表、按习惯归档、子 agent 语义）。

## Impact

- **依赖**：**依赖 `add-document-registry`（已落）与 `exclude-planning-docs` 先落**——读其 `document-store` 与 `DocRegistry`/`ManagedDoc` 模型，且靠 `exclude-planning-docs` 保证登记表里没有计划稿、归档 agent 不会去碰计划文档。归档委派依赖已配置的 agent（Klarit 本就依赖）；子 agent 并行依赖运行时/模型能力，缺则串行。
- **代码**：`src/shared/workflow.ts`（`ENGINE_OPERATION_SPECS` 加 `archive-docs`、`buildAuthorWorkflowSkill`、归档委派指令合成器，比照 `open-pr` 的委派包装）、`src/main/engine/engine.ts`（`runEngineOpForMember` 加 `archive-docs` 委派；子 agent 能力探测与并行/串行分派；归档**产生提交**，不同于 open-pr 的丢弃 worktree 改动）、`src/main/engine/decisions.ts`（缺表/无 agent 挂起决策）、i18n 文案。
- **兼容**：纯增量。旧包无 `archive-docs`、加载不变；既有引擎操作与门类不动。工作流作者可选择在交付段加一个 `archive-docs` 节点（非强制）。
- **不在本 change**：登记表随归档**自动增量更新**（归档若新建文档是否回写登记表——留待后续）；习惯漂移重扫；归档的 dry-run 预览/diff 审阅门（可作后续增强）。
