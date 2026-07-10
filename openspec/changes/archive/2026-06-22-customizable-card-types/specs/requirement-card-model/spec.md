## MODIFIED Requirements

### Requirement: 需求卡数据模型

系统 SHALL 以一份结构化定义表达一张**需求卡**，作为「需求→交付」的看板节点，对齐 `docs/project-goals.md`「需求卡与关系图」。一张需求卡 MUST 含：

- **预取名**：一个 git 友好的 slug（小写字母/数字/连字符，无空格与特殊字符、不以连字符起止）。它一物两用——**既作卡 id，也作该需求在各涉及成员仓里开的分支名**（见 project-goals「通信模型」）。
- **标题**：非空短文本。
- **描述**：markdown 文本（呈现时渲染、非源码）。
- **类型**：一个 **`typeId`**，引用项目类型注册表中的某个需求卡类型定义（见 `card-type-registry`）。类型背后的 archetype（`container`/`leaf`）决定该卡的流动与关系行为。**`typeId` 取代旧的封闭分类枚举 `epic`/`feature`/`bug`**——后者改由默认类型种子提供（`epic→container`、`feature→leaf`、`bug→leaf`）。
- **卡关系**：零或多条**带类型的边**，每条 `{ 类型, 目标 }`，类型取自 `parent` / `child` / `blocked_by` / `blocks` / `coupled_with`（对齐「关系图：带类型的三种边」），目标为另一张卡的预取名/ id。

需求卡的**持久化形态**另含系统字段：**生命周期状态**（封闭词表 `未开始`/`进行中`/`已完成`/`已暂停`/`等待决策`，新建默认 `未开始`）与创建/更新时间戳。本模型为**最小且前向兼容**：运行断点（当前节点、产出/门把进度、commit SHA）、活现状的执行期维护**不在本模型范围**，留待执行引擎以新增字段引入，不破坏既有读写。

#### Scenario: 完整需求卡可被表达并往返保持
- **WHEN** 构造一张含预取名、标题、描述、typeId、若干带类型关系边（及持久化形态的状态/时间戳）的需求卡并序列化后读回
- **THEN** 各字段完整保留、关系边的类型与目标不变

#### Scenario: 类型须在册
- **WHEN** 校验一张需求卡的类型，并提供项目在册 typeId 集合
- **THEN** `typeId` 在册方为合法；不在册的 typeId 判为非法、返回可读原因

#### Scenario: 关系边类型取自封闭词表
- **WHEN** 某需求卡声明一条关系边
- **THEN** 其类型为 `parent`/`child`/`blocked_by`/`blocks`/`coupled_with` 之一、目标为非空卡标识方为合法；否则判为非法

### Requirement: 需求卡校验为纯逻辑、主渲染共享

需求卡的校验 SHALL 实现为**无 fs / 无 IPC 的纯逻辑**，供主进程与渲染层共享（同 `src/shared/workflow.ts` 的定位），以便候选卡审阅期（渲染层）与将来落库期（主进程）复用同一套校验。校验失败 MUST 返回可读原因。**本能力不引入持久化、存储与 CRUD**——那归后续 change（点「创建任务」之后的工作）。

因类型已从封闭枚举改为引用注册表，**类型校验 SHALL 由调用方把「项目在册 typeId 集合」作为参数传入纯校验逻辑**（保持无 fs/无 IPC：纯逻辑不自行读注册表）。未提供在册集合或集合不含该卡 typeId 时，类型校验 MUST 判为非法。

#### Scenario: 校验在渲染层可用
- **WHEN** 渲染层在审阅候选卡时调用需求卡校验，并传入项目在册 typeId 集合
- **THEN** 无需主进程往返即可得到合法/非法及原因

#### Scenario: 在册集合作为参数注入
- **WHEN** 调用纯校验逻辑校验卡片类型
- **THEN** 校验仅依据传入的在册 typeId 集合判定，不自行访问 fs / IPC

#### Scenario: 本能力不落库
- **WHEN** 审阅完成、用户点击「创建任务」
- **THEN** 止于把候选卡交给创建接缝，不写入任何持久化存储（落库由后续 change 实现）

## ADDED Requirements

### Requirement: archetype 驱动的关系合法性

需求卡关系的合法性 SHALL 受类型 archetype 约束，而非仅看关系边词表：只有 archetype 为 `container` 的卡可作为 `parent`（挂子卡）；archetype 为 `leaf` 的卡 MUST NOT 挂子卡（它是叶子）。容器 MAY 嵌套容器（一个容器卡的子卡可以是另一个容器卡）。该校验同样以「在册 typeId 集合及其 archetype」为输入的纯逻辑形式提供。

#### Scenario: 子叶卡挂子卡非法
- **WHEN** 校验一条 `parent/child` 关系，其父卡类型 archetype 为 `leaf`
- **THEN** 判为非法、返回可读原因

#### Scenario: 容器卡可挂子卡
- **WHEN** 校验一条 `parent/child` 关系，其父卡类型 archetype 为 `container`
- **THEN** 校验通过

#### Scenario: 容器可嵌套容器
- **WHEN** 一个 container 卡的子卡也是 container 类型
- **THEN** 校验通过（v1 允许容器嵌套）
