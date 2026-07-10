## ADDED Requirements

### Requirement: 分解需求的输入与候选卡输出

系统 SHALL 提供一个**分解需求**能力：输入一段**自由描述文本**（用户可能一口气写很长、含多个点子，并可夹带截图/文件路径，见 `decompose-ui`）与一份**生效的分解 prompt**，由全局 agent 产出一组**候选需求卡**。每张候选卡 MUST 含 `requirement-card-model` 规定的全部 agent 生成字段：**标题**、**描述（markdown）**、**分类**（`epic`/`feature`/`bug`）、**卡关系**（带类型边，目标用本批候选卡的预取名引用）、**预取名**（git 友好 slug）。候选卡 MUST 是结构化、可逐张审阅的数据，而非一段自由文本。

候选卡是**未落库的中间产物**——它承载分解结论，本 change 止于产出与审阅，落库归下一个 change（见 `requirement-card-model`、`global-agent`）。

#### Scenario: 一大段描述分解为多张候选卡
- **WHEN** 以一段含多个点子的自由描述与生效 prompt 触发分解
- **THEN** 系统产出一组结构化候选卡，每张含标题、描述、分类、卡关系、预取名

#### Scenario: 候选卡字段符合卡模型
- **WHEN** 读取一次分解产出的候选卡
- **THEN** 每张卡的分类取自 `epic`/`feature`/`bug`、预取名为 git 友好 slug、关系边类型取自封闭词表且目标引用本批某张候选卡的预取名

#### Scenario: 候选卡预取名在本批内唯一
- **WHEN** 一次分解产出多张候选卡
- **THEN** 各候选卡的预取名互不相同（冲突时由取名工具加后缀去重）

### Requirement: 分解 prompt 的解析顺序

分解所用的 prompt SHALL 按确定顺序解析：**当前项目激活工作流的「新建需求」prompt（若声明）→ 全局默认分解 skill**。即：项目激活了带「新建需求」prompt 的工作流时用该 prompt；未激活、或激活工作流未声明该 prompt 时回落到全局默认分解 skill。解析 MUST 始终得到一份非空生效 prompt（全局默认分解 skill 是兜底来源，保证无工作流上下文时分解仍可进行）。

#### Scenario: 优先用激活工作流的新建需求 prompt
- **WHEN** 当前项目激活的工作流声明了「新建需求」prompt，触发分解
- **THEN** 系统以该工作流的「新建需求」prompt 作为生效 prompt

#### Scenario: 无工作流 prompt 时回落全局默认分解 skill
- **WHEN** 当前项目未激活工作流，或激活工作流未声明「新建需求」prompt
- **THEN** 系统以全局默认分解 skill 作为生效 prompt，分解仍可进行

### Requirement: 全局默认分解 skill 的存储与手写/导入

系统 SHALL 维护一份**全局默认分解 skill**（一份 markdown skill 文件），存于 Klarit 管理数据目录（userData）、不入 git，作为无工作流上下文时的兜底分解 prompt。用户 SHALL 能**手写**（在应用内撰写并保存）或**导入**（选中外部文件拷入）该 skill，其交互与约束 MUST **与工作流 agent 节点 prompt 的「使用文件」导入一致**（导入即拷入受管目录、按相对受管路径记录、可查看内容、越界路径被拒）。系统 SHALL 提供读取该 skill 内容的能力供查看与执行，并在首次需要时种入一份内置默认分解 skill 文本（保证兜底永远非空）。该内置 skill 文本 MUST 写明分解产出的候选卡字段结构（标题/描述/分类/关系/预取名），作为「怎么分解 + 输出什么结构」的单一来源。

#### Scenario: 手写全局默认分解 skill
- **WHEN** 用户在应用内撰写一份分解 skill 内容并保存
- **THEN** 系统将其存为 userData 下的 markdown 文件，作为全局默认分解 skill，可被读回查看

#### Scenario: 导入全局默认分解 skill
- **WHEN** 用户选中一个外部 skill 文件作为全局默认分解 skill
- **THEN** 系统将该文件拷入受管目录并记录引用（不依赖原外部路径），其后作为全局默认分解 skill 生效

#### Scenario: 首次种入内置默认 skill
- **WHEN** userData 下尚无全局默认分解 skill 且首次需要分解
- **THEN** 系统种入一份写明候选卡字段结构的内置默认分解 skill，使兜底 prompt 非空

#### Scenario: 导入约束与节点 prompt 一致
- **WHEN** 用户导入全局默认分解 skill
- **THEN** 其落盘/记录/查看/越界拒绝的行为与工作流节点 prompt 的「使用文件」导入一致

### Requirement: 分解能力经 IPC 暴露

分解需求能力 SHALL 经 IPC 暴露给渲染层：给定自由描述与当前项目上下文，解析生效 prompt 并驱动全局 agent 产出结构化候选卡返回。该 IPC 契约 MUST 是稳定、结构化的，使「新建需求」入口、全局 agent 与外部 AI 都经同一契约调用（见 `global-agent`）。本 change 的 IPC **只覆盖到产出候选卡**；候选卡落库的契约归下一个 change。

#### Scenario: 经 IPC 请求分解
- **WHEN** 渲染层经 IPC 提交一段自由描述请求分解
- **THEN** 系统解析生效 prompt、驱动产出并返回结构化候选卡列表

#### Scenario: 候选卡校验随产出
- **WHEN** 分解产出候选卡
- **THEN** 不合卡模型的候选（如空标题、非法预取名、未知分类）被标记并附可读原因，供审阅界面提示
