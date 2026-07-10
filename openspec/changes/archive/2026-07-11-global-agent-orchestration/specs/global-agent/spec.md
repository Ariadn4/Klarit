## MODIFIED Requirements

### Requirement: 全局 agent 作为「新建需求」产出者的接缝

系统 SHALL 把**全局 agent** 从「新建需求」的最小产出接缝扩成完整的**需求编排 agent**，对齐 `docs/project-goals.md`「三层 Agent 结构」中全局 agent「用户咨询项目任意事宜 / 用户新建需求卡 / 编排需求」的职责。全局 agent SHALL 具备**全盘视野**（本项目所有卡的活现状摘要 + 关系图 + 项目目标/生效宪法，见 `requirement-orchestration`），把用户自由意图解读成一组**卡操作**（`create`/`adjust`/`split`/`merge`/`relate`），而不再只产出 `create` 候选卡。「新建需求」SHALL 成为编排的一个特例（全 `create`）。全局 agent 的入口（自身聊天面板，见 `global-agent-chat`）、现有「描述想法」入口、以及外部 AI 调用 MUST 走**同一编排核**（`orchestrate`，见 `requirement-orchestration`），不各自实现一套产出逻辑。

产出卡操作时 SHALL **真实调用用户配置的默认 agent**（无头/流式 CLI、复用用户订阅、不自建模型通道）跑编排推理并解析其回复为结构化卡操作；未配置 agent 或调用失败/超时/不可解析 MUST 优雅降级为空提案（附可读提示），不报错、不崩溃。

#### Scenario: 意图产出成套卡操作

- **WHEN** 用户提交一段自由意图（如「把 A、B 合并」/「这卡拆两半」/「新增需求 X」）
- **THEN** 全局 agent over 全盘视野产出对应卡操作提案（merge/split/create 等），交审阅流

#### Scenario: 新建需求为编排特例

- **WHEN** 用户经「描述想法」或对话面板表达一个新需求
- **THEN** 全局 agent 产出全为 `create` 的提案，与其它编排走同一核

#### Scenario: 真实调用配置的 agent

- **WHEN** 当前已配置默认 agent，用户提交意图
- **THEN** 接缝调用该 agent 跑编排推理，并把回复解析为结构化卡操作提案

#### Scenario: 未配置或调用失败时优雅空态

- **WHEN** 未配置默认 agent，或 agent 调用失败/超时/回复不可解析
- **THEN** 接缝返回空提案（审阅显空态），不报错、不崩溃

#### Scenario: 入口与调用共用同一编排核

- **WHEN** 对话面板、「描述想法」入口、外部调用分别发起编排
- **THEN** 三者经同一 `orchestrate` 核完成，行为一致

### Requirement: 全局 agent 只读且挂当前项目

全局 agent SHALL **只读、只产出提案、限本项目**（对齐三层结构中全局 agent 的定位）：

- **只读代码、绝不写代码**：全局 agent MUST NOT 触碰项目代码 / git（写代码是后台执行 agent 的职责），它只编排**卡**（管理状态）。驱动全局 agent 的运行 MUST 以只读姿态进行，系统 MUST NOT 消费它对文件的任何写动作。
- **卡操作不直接落盘**：全局 agent MUST 只**提案**卡操作，由用户**确认**后经 `card-ops-review-apply` 的 `applyOps` 落库（与单卡红线一致：agent 提议、人确认、系统执行）。
- **全盘限当前项目、不跨项目**：全局 agent 的全盘视野 MUST 限**当前窗口绑定的那个项目**（所有卡），**永不看别的项目**——故不能在当前项目的对话里操作另一个已有项目（不做跨项目路由）。当窗口**未绑定任何项目**时，agent **仍可对话**（全盘视野为空），并可**提议新建项目**承载新项目需求（不再是死空态；见 `requirement-orchestration` / `global-agent-chat`）。
- **破坏性收边**：全局 agent 的结构性操作（split/merge/adjust/relate）MUST 只作用于「待办」列的卡；对已离开待办的卡改为建议新建需求（见 `requirement-orchestration`）。

#### Scenario: 只读不碰代码/git

- **WHEN** 全局 agent 处理任意意图
- **THEN** 它只产出卡操作提案，未改动任何项目代码 / git，系统不消费其文件写

#### Scenario: 提案经人确认才落盘

- **WHEN** 全局 agent 产出一组卡操作提案
- **THEN** 在用户确认前不落盘，确认后经 applyOps 应用

#### Scenario: 未绑定项目仍可对话与提议新建

- **WHEN** 当前窗口未绑定任何项目，用户跟全局 agent 对话
- **THEN** agent 仍响应（空全盘视野），可提议新建项目承载新项目需求，不静默无反应、不报错
