## ADDED Requirements

### Requirement: 写工作流 skill 覆盖 archive-docs

`buildAuthorWorkflowSkill` 从数据模型自动合成时 SHALL 带上新引擎操作 `archive-docs`，讲清其面向需求的语义：读文档登记表、按 `kind` 归档（动态就地更新 / 快照按习惯追加）、照审批过的习惯 prompt、子 agent 支持时并行否则串行退化、产生并提交文档改动。skill 文案 MUST 从引擎操作集单一来源派生，不手写漂移。

#### Scenario: skill 含 archive-docs 及其语义
- **WHEN** 合成写工作流 skill
- **THEN** 引擎操作段列出 `archive-docs` 并说明其读登记表、按习惯归档、并行/串行、提交语义

#### Scenario: skill 随操作集单一来源
- **WHEN** `ENGINE_OPERATIONS` 含 `archive-docs`
- **THEN** skill 自动包含它，无需手写维护
