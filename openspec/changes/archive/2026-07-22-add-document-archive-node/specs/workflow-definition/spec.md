## ADDED Requirements

### Requirement: 封闭引擎操作集含 archive-docs

封闭引擎操作集（`ENGINE_OPERATION_SPECS` / `ENGINE_OPERATIONS`，单一来源）SHALL 新增操作 `archive-docs`。它对外是引擎操作节点、内部委派 agent（同 `open-pr` 的分派范式）；它**不支持门**（门位为否）；它**产出文档写入**（与 `open-pr` 的"不产出、不提交"相反）。工作流数据模型的校验与迁移 MUST 识别 `archive-docs` 为合法引擎操作。

#### Scenario: archive-docs 是合法引擎操作
- **WHEN** 一个引擎节点的 `operation` 为 `archive-docs`
- **THEN** 校验通过，`ENGINE_OPERATIONS` 含之，下拉可选

#### Scenario: archive-docs 不支持门
- **WHEN** 查询 `archive-docs` 的引擎操作能力
- **THEN** 其门位为否（不可在其上挂门），产出位为是

#### Scenario: 旧包无 archive-docs 不受影响
- **WHEN** 加载一个不含 `archive-docs` 的既有工作流包
- **THEN** 加载与校验行为不变（纯增量）
