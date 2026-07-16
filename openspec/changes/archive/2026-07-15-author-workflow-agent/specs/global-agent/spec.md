## MODIFIED Requirements

### Requirement: 全局 agent 只读且挂当前项目

全局 agent SHALL **只读、只产出提案、限本项目**（对齐三层结构中全局 agent 的定位）：

- **只读代码、绝不写代码**：全局 agent MUST NOT 触碰项目代码 / git（写代码是后台执行 agent 的职责），它只编排**管理态**——需求**卡**与**工作流**（二者皆为管理状态，非交付代码）。驱动全局 agent 的运行 MUST 以只读姿态进行，系统 MUST NOT 消费它对文件的任何写动作。
- **提案不直接落盘**：全局 agent MUST 只**提案**（卡操作或工作流定义），由用户**确认**后经系统落地——卡操作经 `card-ops-review-apply` 的 `applyOps` 落库、工作流经 `workflow-store.save()` 存库（见 `workflow-authoring`），与单卡红线一致：agent 提议、人确认、系统执行。
- **全盘限当前项目、不跨项目**：全局 agent 的全盘视野 MUST 限**当前窗口绑定的那个项目**（所有卡）与该项目可见的工作流库，**永不看别的项目**——故不能在当前项目的对话里操作另一个已有项目（不做跨项目路由）。当窗口**未绑定任何项目**时，agent **仍可对话**（全盘视野为空），并可**提议新建项目**承载新项目需求（不再是死空态；见 `requirement-orchestration` / `global-agent-chat`）。
- **破坏性收边**：全局 agent 的结构性卡操作（split/merge/adjust/relate）MUST 只作用于「待办」列的卡；对已离开待办的卡改为建议新建需求（见 `requirement-orchestration`）。

#### Scenario: 只读不碰代码/git

- **WHEN** 全局 agent 处理任意意图
- **THEN** 它只产出提案（卡操作或工作流定义），未改动任何项目代码 / git，系统不消费其文件写

#### Scenario: 提案经人确认才落盘

- **WHEN** 全局 agent 产出一组卡操作提案或一份工作流提案
- **THEN** 在用户确认前不落盘，确认后卡操作经 applyOps 应用、工作流经 workflow-store.save() 存库

#### Scenario: 未绑定项目仍可对话与提议新建

- **WHEN** 当前窗口未绑定任何项目，用户跟全局 agent 对话
- **THEN** agent 仍响应（空全盘视野），可提议新建项目承载新项目需求，不静默无反应、不报错

## ADDED Requirements

### Requirement: 全局 agent 亦作工作流作者

系统 SHALL 把全局 agent 的职责从「只编排卡」扩为**也能编排工作流**：除把用户意图解读为卡操作外，agent SHALL 在识别到**写/改工作流**意图时产出一份完整的 `WorkflowDefinition` 提案（见 `workflow-authoring`）。此能力 MUST 复用与卡编排**同一条红线与同一编排核**（只读、只提案、人确认后落地、绝不碰代码/git），工作流作为需求卡的**姊妹管理态**，而非另起一套产出逻辑。

#### Scenario: 识别工作流意图产出工作流提案

- **WHEN** 用户表达一个写/改工作流的意图（如「帮我做个带评审门的 PR 工作流」）
- **THEN** 全局 agent 产出一份完整的 `WorkflowDefinition` 提案，交预览与人确认后存库

#### Scenario: 工作流编排与卡编排共核同红线

- **WHEN** 用户在同一对话里既提需求卡意图又提工作流意图
- **THEN** 两类意图经同一编排核处理，均只产提案、只读、人确认后才落地
