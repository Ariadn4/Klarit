## MODIFIED Requirements

### Requirement: 全局 agent 是自由对话助手（回复优先、技能内联）

全局 agent SHALL 是一个**自由对话助手**（对齐用户「像 Claude Code 那样能自由聊天、识别意图才调技能干活」的诉求），而非「每轮强制产出卡操作」。编排 prompt SHALL 把它塑造为 Klarit 需求助手：**自然语言回复永远是第一位**（`reply`）；**纯聊天/讨论/答疑是有效轮次**——此时 `ops` 为空、`issues` 为空、**不算失败、不显「本轮没产出」占位**（该占位仅在 `reply` 也为空时兜底）。仅当 agent **识别到可执行意图**（新建/改/拆/并/关联卡、新建项目、或**写/改工作流**）时，才按对应**技能**的输出格式在 `ops`（及新项目 `suggestedProject`、或**工作流** `workflow`）里产出结构化产出。各操作的技能说明 SHALL **内联进同一 agent 的 prompt**（每个技能格式即该操作输出的单一来源；`create` 沿用分解的卡字段约定；写工作流沿用 `buildAuthorWorkflowSkill()` 生成的契约），一次 agent 调用完成「聊天、产卡操作、或产工作流」的自路由。

#### Scenario: 纯聊天轮只回复、不产操作

- **WHEN** 用户发一条对话/提问（非塑造需求或工作流的意图，如「你觉得这个方向如何」）
- **THEN** agent 给出自然语言回复，`ops` 为空、无 `workflow`、无 issue、不显「本轮没产出」占位

#### Scenario: 识别到卡意图才按技能产出操作

- **WHEN** 用户表达一个卡意图（如「把 A、B 合并」/「新增一个导出需求」）
- **THEN** agent 在自然回复之外，按对应技能格式产出相应卡操作（merge/create 等）交审阅

#### Scenario: 识别到工作流意图才产出工作流

- **WHEN** 用户表达一个写/改工作流的意图（如「做个带评审门的 PR 工作流」）
- **THEN** agent 在自然回复之外，按写工作流技能格式产出一份完整 `workflow` 定义交预览

#### Scenario: prompt 内联各操作技能

- **WHEN** 装配编排 prompt
- **THEN** prompt 含「自由聊天优先」的角色说明、各卡操作（create/split/merge/relate/新建项目）技能格式、以及写工作流 skill，供 agent 识别意图后据以自路由产出

### Requirement: 可程序化调用的编排接口

系统 SHALL 暴露一个**编排核接口** `orchestrate(intent, projectId, conversationId?) → OrchestrationProposal`，作为全局 agent 自身聊天入口与将来别处升级（单卡对话/门自由输入识别出「塑造需求」时上抛）**共用的单一编排核**。`OrchestrationProposal` SHALL 含 `ops`（卡操作数组）、`issues`（逐 op 校验问题）、`reply`（给用户看的自然语言答复，可选）、`suggestedProject`（新项目提议，可选）、`workflow`（工作流提案，可选——含完整 `WorkflowDefinition`、可选 `baseId` 与工作流校验 issues，见 `workflow-authoring`）。编排核 MUST 只**产出提案**、**只读**（不碰 git/代码、不落盘应用任何 op、不写工作流库）。当 `projectId` **未绑定项目**时，编排核 MUST **仍可运行**（不再是死空态）——全盘视野为空，agent 据意图对话，并**可提议新建项目**承载新项目需求（见「编排可提议新建项目」）。

#### Scenario: 编排核产出提案

- **WHEN** 以 (intent, 已绑定 projectId) 调用编排核
- **THEN** 返回含 ops + issues + reply（且按意图可含 workflow）的提案，未改动任何卡、工作流库、git 或代码

#### Scenario: 工作流意图产出 workflow 提案

- **WHEN** 以一段写/改工作流意图调用编排核
- **THEN** 返回的 `OrchestrationProposal` 带 `workflow`（完整定义 + 可选 baseId + 校验 issues），`ops` 为空

#### Scenario: 未绑定项目仍可对话与提议新建

- **WHEN** 以未绑定项目调用编排核
- **THEN** 编排核仍运行（空全盘视野），产出 reply 与（若意图是新项目）`suggestedProject` 提议，不报错、不静默无响应

#### Scenario: 聊天入口与升级调用共核

- **WHEN** 全局 agent 聊天入口与（将来）别处上抛分别发起编排
- **THEN** 两者经同一 `orchestrate` 核完成，行为一致

## ADDED Requirements

### Requirement: 编排上下文带工作流摘要与基准定义

为让全局 agent 能写/改工作流，编排上下文装配器 SHALL 在全盘视野之外**带上当前项目可见的工作流摘要**——每条至少含 id、显示名、是否无效（复用 `workflowSummary`）。摘要 MUST 恒带（便宜），供 agent 认识可改哪些工作流、按 id 点名 `baseId`。当本轮意图指向**改写**某工作流时，装配器 SHALL 注入**基准定义的完整内容**作起点：默认取当前项目的**活动工作流**（`getActiveWorkflowId()`），或 agent 点名的 `baseId` 对应工作流。基准定义注入 MUST 限当前项目可见的工作流，不跨项目。

#### Scenario: 上下文恒带工作流摘要

- **WHEN** 装配编排上下文
- **THEN** 上下文含当前项目可见工作流的摘要（id/名/是否无效），供 agent 认识与点名

#### Scenario: 改写意图注入活动工作流定义

- **WHEN** 意图指向改现有流且未点名具体工作流、项目有活动工作流
- **THEN** 装配器注入活动工作流的完整定义作基准起点

#### Scenario: 点名 baseId 注入对应定义

- **WHEN** agent 点名某 `baseId` 改写
- **THEN** 装配器注入该工作流的完整定义作基准，且限当前项目可见范围
