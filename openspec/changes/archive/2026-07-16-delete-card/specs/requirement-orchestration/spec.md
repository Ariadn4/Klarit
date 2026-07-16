## MODIFIED Requirements

### Requirement: 意图到卡操作的编排 schema

系统 SHALL 定义一套**卡操作（CardOp）schema**，把全局 agent 对自由意图的解读表达为一组有序操作，覆盖六类：

- **`create`**：新建一张或多张卡（承载现有候选卡字段：预取名/标题/描述/typeId/关系）。
- **`adjust`**：改一张既有卡的 `title` / `description` / `typeId`；MUST NOT 改其 `proposedName`（= id 与分支名）、MUST NOT 改其 `status` 或运行关联（那些非编排职责）。
- **`split`**：把一张源卡拆成 N 张新卡；产物为 N 张新卡 + 源卡关系边的再分配（默认所有子卡继承源卡的外部边，供审阅裁剪）+ 删源卡。
- **`merge`**：把多张卡并成一张目标卡（既有卡或新卡）；产物为目标卡（合并描述）+ 参与卡关系边并集重指到目标（去重、丢弃并集内部边）+ 删被并卡。
- **`relate`**：新增或删除一条卡间关系边，维护 `parent`/`child`/`blocked_by`/`blocks`/`coupled_with` 及其反向。
- **`delete`**：按 id 删除一张既有卡（`{ kind: 'delete'; target }`，`target` = 被删卡 `proposedName`）；应用时经 `cardStore.remove` 删卡文件并清其它卡指向它的悬挂边。`delete` 为**破坏性 op**（应用前须二次确认，见 `card-ops-review-apply`），且受「破坏性结构操作只作用于待办列的卡」约束（见下）。缺 `target` 的 `delete` 原始项 MUST 在容错收敛时丢弃、不产出。

每个 op MUST 是**自描述**的（含目标卡 id 与操作载荷），使审阅与 apply 无需回看对话即可确定其效果。

#### Scenario: 意图解读为一组卡操作

- **WHEN** 全局 agent over 全盘视野解读一段自由意图
- **THEN** 产出一组有序 CardOp（可含 create/adjust/split/merge/relate/delete 任意组合），每个 op 自描述其目标与载荷

#### Scenario: adjust 不改身份与运行态

- **WHEN** 一个 `adjust` op 试图改某卡
- **THEN** 只允许改 title/description/typeId；对 proposedName、status、运行关联的改动被拒绝或忽略

#### Scenario: delete 自描述其目标卡

- **WHEN** 意图为「删掉卡 X」
- **THEN** 产出 `{ kind: 'delete', target: 'X' }`，审阅无需回看对话即可确定其将删除卡 X

### Requirement: 破坏性操作只作用于待办列的卡

为免除分支/产物重分配的破坏性，全局 agent 编排的**结构性操作**（`split`/`merge`/`adjust`/`relate`/`delete`）SHALL **只作用于「待办」列的卡**——leaf 原型且状态「未开始」或无 `activeRunId` 的卡，以及 `container` 原型卡。对**已离开待办**的卡（进行中/已暂停/等待决策/已完成，或有 `activeRunId`），系统 MUST NOT 产出针对它的跨卡结构操作或 `delete`，而 SHALL 转为**建议新建需求**（`create`）来承载该意图。此约束 MUST 体现在编排上下文喂给 agent 的指令中，且 MUST 在 apply 前的校验里强制（越界的结构性/删除 op 被标记为非法、不应用）。

#### Scenario: 对待办卡允许结构操作

- **WHEN** 目标卡在待办列（未开始/无运行，或为容器）
- **THEN** 针对它的 split/merge/adjust/relate/delete op 合法、可进入审阅与应用

#### Scenario: 对已跑卡改为建议新建

- **WHEN** 意图涉及一张已离开待办（进行中/已完成/有 activeRunId）的卡
- **THEN** 编排不产出针对它的跨卡结构 op 或 delete，而产出一个 `create` 建议新需求来承载该意图

#### Scenario: 越界结构 op 被校验挡下

- **WHEN** 一个 split/merge/adjust/relate/delete op 的目标是已离开待办的卡
- **THEN** apply 前校验判其非法、带可读原因回报，不应用
