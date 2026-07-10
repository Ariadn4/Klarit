## ADDED Requirements

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

### Requirement: 两条落库路统一收口到单一创建接缝

系统 SHALL 让**手动新建**(看板「待办」+ 入口经 `useNewRequirementStore.createTasks()`)与**外部分解候选**(`submitDecomposedCandidates` 审阅通过)两条路,在**审阅通过后**收口到**同一个创建接缝**:接受一批候选卡(`CandidateCard[]`)与目标项目,对每张以 `newRequirementCard(candidate, now)` 构造持久化形态(状态「未开始」、时间戳)、经纯校验、落库、并落地其关系双向边。两条路 MUST NOT 各自实现独立的落库逻辑。

#### Scenario: 手动新建经统一接缝落库
- **WHEN** 用户在看板手动新建需求、审阅通过后点「创建任务」
- **THEN** 候选卡经统一创建接缝落库到当前项目,看板可见(此前 `createTasks` 只清状态、不落库的缺口被补上)

#### Scenario: 外部分解候选经同一接缝落库
- **WHEN** 外部 AI 经 `submitDecomposedCandidates` 推来候选并审阅通过
- **THEN** 候选卡经**同一个**创建接缝落库,与手动路结果一致(同样的校验、状态默认、关系双向)

#### Scenario: 一批候选含非法项时的处理
- **WHEN** 提交一批候选,其中个别非法(typeId 不在册等)
- **THEN** 创建接缝按校验逐张判定,合法者落库、非法者带可读原因回报,不静默丢弃

### Requirement: 从卡派生运行请求(单仓先跑通)

系统 SHALL 提供从一张需求卡**派生引擎运行请求**的逻辑:`branch` = 卡预取名(slug)、`repoPath` = 解析卡 `repos` 首仓的工作目录、`workflowId` = 该卡所属项目的激活工作流、`cardId` = 卡 id。本能力**仅支持单仓**派生(取 `repos[0]`);卡涉及多仓时其余仓为多仓并行预留、本期不派生运行。卡 `repos` 为空或激活工作流缺失时 MUST NOT 派生一个无效运行,而是返回可读原因(供卡上「运行」按钮禁用或提示)。

#### Scenario: 单仓卡派生运行请求
- **WHEN** 对一张 `repos` 含至少一个仓、所属项目有激活工作流的卡派生运行请求
- **THEN** 得到 `{ workflowId: 项目激活工作流, repoPath: 首仓工作目录, branch: 卡预取名, cardId: 卡 id }`

#### Scenario: 多仓卡本期只取首仓
- **WHEN** 对一张 `repos` 含多个仓的卡派生运行请求
- **THEN** 仅按首仓派生单个运行请求,其余仓不派生(多仓并行留扩展)

#### Scenario: 缺前置条件时不派生无效运行
- **WHEN** 对一张 `repos` 为空或所属项目无激活工作流的卡派生运行请求
- **THEN** 不产生运行请求,返回可读原因

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
