## ADDED Requirements

### Requirement: 引擎内置操作的能力声明

引擎内置操作集 SHALL 是一个**封闭操作集**，且每个操作 MUST 携带一份**能力声明**，声明该操作是否：**产出**文档（`producesOutputs`）、需要**检查/门**（`supportsGate`）、需要**可写范围**（`supportsWritableScope`）。该能力声明是 UI 决定节点设置块显隐（见 `workflow-editor`）与将来引擎执行的**单一来源**，main 与 renderer 共享同一份。

当前所有引擎操作（`create-branch` / `open-worktree` / `merge-branch` / `delete-branch-worktree`）均为确定性 git/worktree 动作，其三项能力 MUST 全部为否——它们不交付文档、不跑客观门、不写业务文件。

能力声明是 UI/校验侧的**元数据**，MUST NOT 写入工作流定义文件（`workflow.yaml`），不改变工作流定义的读写往返；引擎节点的产出/门/可写范围字段照旧为空。本能力的引入为**向后兼容**——既有工作流包（其引擎节点 `outputs: []`、无门、无可写范围）行为不变。系统 SHALL 提供按操作查询其能力声明的纯函数；对未知/未选操作，查询 MUST 返回三项能力均为否。

#### Scenario: 现有引擎操作三项能力皆为否
- **WHEN** 查询 `create-branch` / `open-worktree` / `merge-branch` / `delete-branch-worktree` 任一操作的能力声明
- **THEN** 其 `producesOutputs`、`supportsGate`、`supportsWritableScope` 均为否

#### Scenario: 未选/未知操作回落为无能力
- **WHEN** 以空字符串或不在封闭集内的操作名查询能力声明
- **THEN** 返回三项能力均为否的声明，不抛异常

#### Scenario: 能力声明不进定义文件
- **WHEN** 保存一个含引擎节点的工作流再读回
- **THEN** `workflow.yaml` 不含任何能力声明字段，定义读写往返与未引入该能力时等价
