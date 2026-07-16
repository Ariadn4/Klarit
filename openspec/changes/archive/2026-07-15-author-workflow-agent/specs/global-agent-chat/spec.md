## ADDED Requirements

### Requirement: 工作流提案经「预览草稿」入口打开完整编辑器

系统 SHALL 在全局对话面板呈现编排核产出的**工作流提案**（`OrchestrationProposal.workflow`），与卡操作提案审阅**并列**，且**置于 agent 消息气泡框内**（不铺全宽）。一条带工作流提案的 agent 消息 SHALL 承载一个 `workflowProposal`（完整 `WorkflowDefinition` + 可选 `baseId` + 校验 `issues`），并：

- 聊天里 SHALL 只呈现「工作流提案」标签 +**一个「预览草稿」按钮**（已存则旁标已存态），不在聊天内铺开节点细节；
- 点击 SHALL 打开一个**浮层窗口，复用完整 `WorkflowEditor`（草稿态）**——`baseId` 时其 `def.id` 已强制为 baseId；未入库过用草稿种子，已入库过优先从库读、库中已删则回落草稿（不卡加载）——使门验收内容、每节点执行者与多仓 `target`、产出全部可见且**可手动编辑**；
- 浮层用**底部固定横栏**（非顶栏）承载：**关闭** / **保存为正式工作流**（已存显**更新工作流**，经 `saveWorkflow` 落库、成功标记已存）/（仅保存后且尚非激活工作流时）**设置为本项目工作流**（二次确认 → 保存 → `setActiveWorkflow` 激活、随后按钮消失）；
- 工作流已由编排核**自动修复到合法**（见 `workflow-authoring`），`issues` 正常为空；若残留 `issues`，SHALL 在入口旁可读列出。

呈现 MUST 遵 `docs/brand` 与设计令牌（仅用语义令牌、深浅双主题）。

#### Scenario: 聊天只给「预览草稿」入口（在气泡内）

- **WHEN** agent 回复带一个 `workflowProposal`
- **THEN** 面板在该 agent 气泡内呈现「工作流提案」+「预览草稿」按钮，不铺全宽、不铺开节点细节

#### Scenario: 点预览打开完整可编辑编辑器

- **WHEN** 用户点「预览草稿」
- **THEN** 打开浮层窗口，以完整 `WorkflowEditor`（草稿态）呈现，门/产出/多仓 target 可见且可手动编辑

#### Scenario: 底部横栏保存入库并防重复

- **WHEN** 用户在编辑器底部横栏点「保存为正式工作流」
- **THEN** 经 `saveWorkflow` 落库（按 `def.id` 新建，或强制覆盖 `baseId` 对应包），成功后标记已存、按钮改「更新工作流」

#### Scenario: 设置为本项目工作流仅保存后出现、二次确认后激活

- **WHEN** 工作流已保存为正式且尚非激活工作流，用户点「设置为本项目工作流」并确认
- **THEN** 先保存、再 `setActiveWorkflow` 激活到当前项目，按钮随后消失
