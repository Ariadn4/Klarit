## ADDED Requirements

### Requirement: 待决策的产生时刻随断点持久化

引擎置 `pendingDecision` 时 SHALL 在同一断点上一并记录该决策的**产生时刻** `pendingSince`（毫秒时间戳）；清空 `pendingDecision` 时 MUST 一并清空 `pendingSince`。二者 MUST **同生共死**——断点上 MUST NOT 出现「有决策无时刻」或「有时刻无决策」。适用于一切来源的待决策（失败决策 / 人工评审门 / 外部门 / `sourceKind='agent'` 的提问），不分来源。

该字段供决策的**观察方**（见 `decision-inbox`）排序与计算等待时长。它 MUST NOT 影响引擎自身行为：决策回路、续跑语义、断点恢复与开机自动续跑 MUST 与不带该字段时逐字一致。

`pendingSince` 为**可选**字段——本能力扩展前写下的老断点没有它。读取方遇到缺省 MUST 优雅回落而非报错或丢弃该运行。

#### Scenario: 置决策时一并记录时刻

- **WHEN** 引擎为某运行置 `pendingDecision`（任一来源）
- **THEN** 该运行断点上同时写入 `pendingSince`，并随断点持久化

#### Scenario: 回应决策时一并清空时刻

- **WHEN** 用户经 `decideRun` 回应了待决策、引擎清空 `pendingDecision`
- **THEN** 同一断点上的 `pendingSince` 一并被清空

#### Scenario: 运行转终局时一并清空

- **WHEN** 一个停在待决策上的运行被中止（转 `aborted`）
- **THEN** `pendingDecision` 与 `pendingSince` 一并被清空

#### Scenario: 时刻不影响恢复行为

- **WHEN** 一个带 `pendingSince` 的断点被开机恢复
- **THEN** 恢复与续跑行为与不带该字段时一致（该字段只被观察方读取，不参与引擎决策）

#### Scenario: 老断点缺字段不报错

- **WHEN** 读取一个 `pendingDecision !== null` 但无 `pendingSince` 的老断点
- **THEN** 读取方回落到次优时间来源、该运行照常可见与可恢复，不报错
