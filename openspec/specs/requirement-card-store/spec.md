# requirement-card-store Specification

## Purpose
需求卡的持久化与 CRUD：把每张卡落到 `userData` 里一卡一文件、按项目隔离，卡间带类型关系随卡双向落地。手动新建与外部分解候选两条落库路统一收口到单一创建接缝；从卡派生引擎运行请求先按单仓跑通，建立卡↔运行双向链并在开机时按卡恢复展示态。以上 CRUD 经 IPC 暴露给渲染层，使看板与卡详情无需直接访问 fs。
## Requirements
### Requirement: 需求卡的持久化形态与管理态字段

系统 SHALL 把需求卡持久化到用户数据目录(`userData`,不入 git),其**持久化形态**在 `requirement-card-model` 的最小模型(预取名/标题/描述/typeId/关系/状态/时间戳)之上,补一组**管理态字段**,且 MUST 保持对最小模型前向兼容(纯校验 `validateRequirementCard` 契约不变):

- **`projectId`**:该卡所属项目的身份标识。需求卡**属于且仅属于一个项目**(对齐 `docs/project-goals.md`「产物存储」:卡片数据挂在项目下、按成员仓身份关联)。
- **`repos`**:字符串数组,声明该卡**涉及哪些成员仓**(需求与成员仓多对多)。MAY 为空或含一到多个;本能力的运行集成只取首仓(见 `engine-execution` 与看板运行集成),数组本身为多仓留数据口。
- **`activeRunId`**(可选):该卡当前关联的引擎运行 id,作卡 → 运行的**反向链**(运行 → 卡的正向链 `cardId` 在 `engine-execution` 定义)。卡未在运行时为空。

`worktreePath` MUST NOT 存于卡(从其运行派生)。

#### Scenario: 持久化形态含管理态字段并往返保持
- **WHEN** 落库一张带 projectId、repos、(可选)activeRunId 的需求卡并读回
- **THEN** 最小模型各字段与管理态字段完整保留,且 `requirement-card-model` 的纯校验对其最小模型部分仍判合法

#### Scenario: 卡归属单一项目
- **WHEN** 读取任一落库的需求卡
- **THEN** 其 `projectId` 指向唯一一个项目;按项目查询时只返回该项目的卡

#### Scenario: worktreePath 不入卡
- **WHEN** 读取任一落库的需求卡
- **THEN** 卡结构不含 worktreePath 字段(worktree 路径从其运行派生)

### Requirement: 一卡一文件、按项目隔离的持久化布局

系统 SHALL 把每张需求卡持久化为**独立一个文件**,按项目分目录(布局形如 `userData/cards/<projectId>/<slug>.json`,`slug` 为卡预取名),以便为字段级合并 / 云同步多设备并发改动保留粒度(对齐「产物存储」)。读取损坏的单卡文件 MUST 容错跳过、不致整项目卡列表崩溃。同一项目内卡的预取名(= id)MUST 唯一。

#### Scenario: 每卡独立文件
- **WHEN** 在某项目创建两张卡
- **THEN** 各落为该项目目录下一个独立文件,互不影响

#### Scenario: 损坏单卡文件被容错跳过
- **WHEN** 某项目目录下有一个损坏的卡文件
- **THEN** 列出该项目卡时跳过损坏项、返回其余可读卡,不抛未捕获异常

#### Scenario: 同项目内预取名唯一
- **WHEN** 在同一项目创建一张预取名与在册卡重复的卡
- **THEN** 系统去重(加后缀)或拒绝,不产生两张同 id 卡

### Requirement: 需求卡的增删改查与关系维护

系统 SHALL 提供需求卡的**创建、读取(按项目列出 / 按 id 取单)、更新、删除**,并维护卡间**带类型关系**(`parent`/`child`/`blocked_by`/`blocks`/`coupled_with`)。写关系时 SHALL 落地**双向边**:声明一侧即在对侧落对应反向边(`parent`↔`child`、`blocked_by`↔`blocks`、`coupled_with` 自反);删除一张卡时 MUST 清理其它卡上指向它的悬挂边。所有写操作落库前 MUST 经 `requirement-card-model` 纯校验(注入项目在册 typeId 集合及 archetype),非法即拒绝并返回可读原因。

#### Scenario: 创建后可读回
- **WHEN** 创建一张卡
- **THEN** 该卡落库,按项目列出与按 id 取单都能读到它,状态默认「未开始」

#### Scenario: 关系双向落地
- **WHEN** 创建一张声明 `parent` 指向某容器卡的子卡
- **THEN** 子卡落 `parent` 边、父卡落对应 `child` 边(双向一致)

#### Scenario: 删卡清理悬挂边
- **WHEN** 删除一张被其它卡以关系边指向的卡
- **THEN** 其它卡上指向它的边被清理,不留悬挂引用

#### Scenario: 非法卡被拒不落库
- **WHEN** 创建一张 typeId 不在册或预取名非法的卡
- **THEN** 经纯校验判非法、拒绝落库并返回可读原因

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

### Requirement: 卡与运行的双向链及开机按卡恢复

系统 SHALL 在启动运行时建立卡↔运行**双向链**:运行请求带 `cardId`(正向)、卡记 `activeRunId`(反向)。开机自动恢复 SHALL 沿用引擎 `resumeAll`(续所有 `running` 断点);因被续的断点带 `cardId`,系统 MUST 据此把对应卡的展示态对上(进行中),无需引擎反向遍历卡。运行进入终局(`done`/`aborted`)时 SHALL 相应更新卡(完成 → 状态「已完成」并清 `activeRunId`,或保留以供回看,按生命周期定义)。

#### Scenario: 启动运行建立双向链
- **WHEN** 从某卡启动一个运行
- **THEN** 运行断点 `request.cardId` 指向该卡、该卡 `activeRunId` 指向该运行

#### Scenario: 开机恢复运行带回卡状态
- **WHEN** 应用重开,引擎 `resumeAll` 续起一个 `running` 且带 `cardId` 的运行
- **THEN** 对应卡据该断点呈现为进行中(在其当前节点所属列、带运行圆点),无需额外的按卡遍历

#### Scenario: 运行完成更新卡
- **WHEN** 一个绑卡运行抵达终局
- **THEN** 对应卡按生命周期更新(完成则状态「已完成」),双向链按定义清理或保留

### Requirement: 需求卡 CRUD 经 IPC 暴露给渲染层

系统 SHALL 把需求卡的创建(统一接缝)、按当前绑定项目列出、按 id 取单、更新、删除经 IPC 暴露给渲染层,使看板与卡详情无需直接访问 fs。未绑定项目时列出 MUST 返回空态而非报错。

#### Scenario: 渲染层经 IPC 拿到当前项目的卡
- **WHEN** 渲染层在已绑定项目下请求列出需求卡
- **THEN** 经 IPC 返回该项目全部可读卡

#### Scenario: 未绑定项目返回空态
- **WHEN** 渲染层在未绑定项目时请求列出需求卡
- **THEN** 返回空态,不抛错

### Requirement: 从卡派生运行请求(多仓扇出)

系统 SHALL 提供从一张需求卡**派生引擎运行请求**的逻辑:`branch` = 卡预取名(slug)、`workflowId` = 该卡所属项目的激活工作流、`cardId` = 卡 id;**仓库上下文取卡 `repos` 的全部涉及仓**(不再只取首仓)。派生结果 MUST 表达为**单个运行**绑该卡、其涉及仓集合为 `card.repos`(一卡一运行,由引擎在运行内对成员仓扇出,见 `engine-execution`);同名 slug 分支跨所有涉及仓。卡 `repos` 为空或激活工作流缺失时 MUST NOT 派生一个无效运行,而是返回可读原因(供卡上「运行」按钮禁用或提示)。

#### Scenario: 单仓卡派生运行请求
- **WHEN** 对一张 `repos` 恰含一个仓、所属项目有激活工作流的卡派生运行请求
- **THEN** 得到绑该卡的单个运行请求(`repos` = 该唯一仓、`branch` = 卡预取名、`cardId` = 卡 id、`workflowId` = 项目激活工作流),行为等价今日单仓

#### Scenario: 多仓卡派生一个扇出运行
- **WHEN** 对一张 `repos` 含多个仓的卡派生运行请求
- **THEN** 派生**单个**绑该卡的运行请求,其涉及仓集合为全部 `repos`;引擎在该运行内对各成员仓扇出(不为每仓拆多个运行)

#### Scenario: 缺前置条件时不派生无效运行
- **WHEN** 对一张 `repos` 为空或所属项目无激活工作流的卡派生运行请求
- **THEN** 不产生运行请求,返回可读原因

