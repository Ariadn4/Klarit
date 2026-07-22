## ADDED Requirements

### Requirement: 阻塞门与关系边引入期校验一致

`blocked_by` 硬门 SHALL 与关系边的**引入期校验**保持一致:因为一条 `blocks` 边在被引入时 MUST NOT 指向已在跑的卡(见 `requirement-card-model`、`requirement-orchestration`),硬门永不需要对一张**已在飞行中**的卡追加未满足的阻塞——即系统 MUST NOT 出现「一张卡处于`进行中`却又新增一条未完成 `blocked_by`」的不一致态。硬门判定本身 SHALL **不变**:一张待办 leaf 卡的资格仍以其自身 `blocked_by` 目标是否**全部已「已完成」**为准(目标缺失按未满足保守处理)。

#### Scenario: 不会给在跑卡追加阻塞门
- **WHEN** 有意图想给一张在跑卡加一条会阻塞它的边(即 `blocks → 该在跑卡`)
- **THEN** 该边在引入期即被判非法、不落库,硬门不会面对一张「进行中却新增未满足阻塞」的卡

#### Scenario: 硬门判定口径不变
- **WHEN** 评估一张待办 leaf 卡是否可自动启动
- **THEN** 仍当且仅当其全部 `blocked_by` 目标已「已完成」时通过硬门(本 change 不改此判定)
