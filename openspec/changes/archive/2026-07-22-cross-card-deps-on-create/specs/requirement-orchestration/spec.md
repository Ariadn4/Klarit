## ADDED Requirements

### Requirement: 关系边校验走共享边谓词

编排核对 `relate`（加边）与 `create`（内嵌关系边）所**新引入的关系边** SHALL 走 `requirement-card-model` 的**共享边合法性谓词**（单一来源），MUST NOT 另写一份关系边判断。据此：

- 一条 **`blocks` 边若目标已在跑或已离开待办**（`进行中`/`已暂停`/`等待决策`/`已完成`，或有 `activeRunId`）MUST 被判非法、带可读原因、不应用——**补齐此前 `relate` 对 `blocks` 目标只查存在、不查状态的缺口**。
- `blocked_by` 边的目标 MAY 为在跑卡（放行）。
- `parent`/`child` 的成环检测 MUST 跨「现有落库卡 ∪ 本批新建卡」合并图。

此约束与「破坏性操作只作用于待办列的卡」并行：`relate` 的**发起卡**仍须在待办列（既有约束不变），本要求进一步约束**被 `blocks` 指向的目标**须未跑。

#### Scenario: relate 给待办卡加 blocks 指向在跑卡被判非法
- **WHEN** 一个 `relate add` op 从一张待办卡引出 `blocks → 一张在跑卡`
- **THEN** apply 前校验经共享谓词判其非法、带可读原因回报，不应用

#### Scenario: relate 加 blocked_by 指向在跑卡放行
- **WHEN** 一个 `relate add` op 从一张待办卡引出 `blocked_by → 一张在跑卡`
- **THEN** 校验通过（等待端是发起卡自己），op 可进入审阅与应用

#### Scenario: create 内嵌 blocks 指向在跑卡被判非法
- **WHEN** 一个 `create` op 的新卡内嵌 `blocks → 一张在跑卡`
- **THEN** 该边经共享谓词判非法、附可读原因，随该 op 进 issues
