## ADDED Requirements

### Requirement: 关系边的增删原语

系统 SHALL 在既有创建/删除的双向关系维护之上，提供**针对单条关系边的增删原语** `addRelation` / `removeRelation`，供编排应用（`card-ops-review-apply` 的 `applyOps`）在既有卡之间新增/移除关系而无需重建卡。写入 SHALL 维护**双向边**（`parent`↔`child`、`blocked_by`↔`blocks`、`coupled_with` 自反）：加边时在对侧落反向边、删边时清对侧反向边。增边 MUST 经校验：只有 `container` 原型卡能作 `parent`、禁自环、去重（重复加边幂等），非法即拒绝并返回可读原因。

#### Scenario: 加边双向落地

- **WHEN** 对两张既有卡 `addRelation`（如 A `blocked_by` B）
- **THEN** A 落 `blocked_by` 边、B 落对应 `blocks` 边，双向一致

#### Scenario: 删边清对侧反向

- **WHEN** 对存在某关系边的两张卡 `removeRelation`
- **THEN** 两侧的正/反向边都被移除，不留单侧悬挂

#### Scenario: 非法加边被拒

- **WHEN** 试图给一张非 `container` 卡加 `parent` 子卡，或加一条自环边
- **THEN** 经校验判非法、拒绝并返回可读原因，不落非法边

### Requirement: 拆卡与并卡复合原语（仅未跑卡、纯管理态）

系统 SHALL 提供**拆卡** `splitCard`（一张源卡 → N 张新卡）与**并卡** `mergeCards`（多张卡 → 一张目标卡）复合原语，供编排应用派发。二者 SHALL 只在**纯管理态**上操作、**MUST NOT 触碰 git / 分支 / worktree / 产物**，且 MUST 只作用于**「待办」列的卡**（leaf 未开始/无 `activeRunId`，或 container）——任一参与卡已离开待办（进行中/已暂停/等待决策/已完成，或有 `activeRunId`）时 MUST 拒绝并返回可读原因（对齐 `requirement-orchestration` 破坏性收边）。

- **`splitCard`**：建 N 张新卡、按给定规则再分配源卡的外部关系边（默认所有子卡继承源卡外部边）、删源卡；全程维护双向边。
- **`mergeCards`**：产出目标卡（既有卡或新建卡，带合并后描述）、把参与卡的关系边**并集重指到目标**（去重、丢弃并集内部边、邻居反向边随之重指）、删被并卡；全程维护双向边。

每个复合原语 MUST 原子式回报结果与逐项问题；对非法输入（参与卡不存在、越界、成环）返回可读原因、不部分落一半破坏一致性。

#### Scenario: 拆未跑卡

- **WHEN** 对一张待办列的源卡 `splitCard` 成 N 张新卡
- **THEN** N 张新卡落库、源卡外部边按规则分配到子卡、源卡删除，双向边一致，未触碰任何 git/分支

#### Scenario: 并未跑卡

- **WHEN** 对两张待办列的卡 `mergeCards` 成一张目标卡
- **THEN** 目标卡落库（含合并描述）、参与卡关系边并集重指目标、被并卡删除、邻居反向边随之重指，未触碰任何 git/分支

#### Scenario: 参与卡已离开待办被拒

- **WHEN** `splitCard`/`mergeCards` 的任一参与卡已进行中或有 `activeRunId`
- **THEN** 原语拒绝、返回可读原因，不做任何落库

## MODIFIED Requirements

### Requirement: 两条落库路统一收口到单一创建接缝

系统 SHALL 让**手动新建**(看板「待办」+ 入口经 `useNewRequirementStore` 的落库路)、**外部分解候选**(`submitDecomposedCandidates` 审阅通过)、以及**全局 agent 编排提案**(`card-ops-review-apply` 的 `applyOps`)三条路,在**审阅通过后**收口到**同一套落库逻辑**:创建型操作对每张候选以 `newRequirementCard(candidate, now)` 构造持久化形态(状态「未开始」、时间戳)、经纯校验、落库、并落地其关系双向边;编排的非创建操作(adjust/relate/split/merge)派发到对应的更新/关系/复合原语。三条路 MUST NOT 各自实现独立的落库逻辑;「描述想法」的纯 create 落库 SHALL 成为 `applyOps` 的一个特例。

#### Scenario: 手动新建经统一接缝落库

- **WHEN** 用户在看板手动新建需求、审阅通过后应用
- **THEN** 候选卡经统一落库逻辑（applyOps 的 create 特例）落库到当前项目,看板可见

#### Scenario: 外部分解候选经同一接缝落库

- **WHEN** 外部 AI 经 `submitDecomposedCandidates` 推来候选并审阅通过
- **THEN** 候选卡经**同一套**落库逻辑落库,与手动路结果一致(同样的校验、状态默认、关系双向)

#### Scenario: 编排提案经同一接缝应用

- **WHEN** 全局 agent 的编排提案经审阅确认
- **THEN** 其 create/adjust/relate/split/merge 各 op 经同一 `applyOps` 派发到 cardStore,与其它落库路共用创建/关系逻辑

#### Scenario: 一批候选含非法项时的处理

- **WHEN** 提交一批候选或 ops,其中个别非法(typeId 不在册等)
- **THEN** 接缝按校验逐项判定,合法者落库、非法者带可读原因回报,不静默丢弃
