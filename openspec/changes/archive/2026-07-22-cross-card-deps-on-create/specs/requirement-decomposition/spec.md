## MODIFIED Requirements

### Requirement: 分解需求的输入与候选卡输出

系统 SHALL 提供一个**分解需求**能力：输入一段**自由描述文本**（用户可能一口气写很长、含多个点子，并可夹带截图/文件路径，见 `decompose-ui`）、一份**生效的分解 prompt**，以及**本项目的全盘快照**（现有卡的活现状摘要 + 关系图，装配同 `requirement-orchestration` 的编排上下文/`board-context`），由全局 agent 产出一组**候选需求卡**。每张候选卡 MUST 含 `requirement-card-model` 规定的全部 agent 生成字段：**标题**、**描述（markdown）**、**类型**（`typeId`，引用项目类型注册表中的某个类型，见 `card-type-registry`）、**卡关系**（带类型边，目标 MAY 引用**本批候选卡的预取名**或**现有落库卡的 id**——不再仅限本批）、**预取名**（git 友好 slug）。候选卡 MUST 是结构化、可逐张审阅的数据，而非一段自由文本。

候选卡批校验的**引用宇宙** SHALL 为「现有落库卡 ∪ 本批新卡」，关系边合法性 SHALL 走 `requirement-card-model` 的**共享边谓词**（含「`blocks` 引入时目标须未跑」与跨图成环检测）；`blocked_by` 目标 MAY 为在跑卡（放行）。

候选卡是**未落库的中间产物**——它承载分解结论，止于产出与审阅，落库归后续 change（见 `requirement-card-model`、`global-agent`）。

#### Scenario: 一大段描述分解为多张候选卡
- **WHEN** 以一段含多个点子的自由描述与生效 prompt 触发分解
- **THEN** 系统产出一组结构化候选卡，每张含标题、描述、类型(typeId)、卡关系、预取名

#### Scenario: 候选卡字段符合卡模型
- **WHEN** 读取一次分解产出的候选卡
- **THEN** 每张卡的 typeId 引用项目在册类型、预取名为 git 友好 slug、关系边类型取自封闭词表且目标引用本批某张候选卡的预取名**或现有落库卡的 id**

#### Scenario: 候选卡可 blocked_by 现有在跑卡
- **WHEN** 一段描述表达「这条新需求依赖某个正在跑的任务」，分解产出一张候选卡带 `blocked_by → 该在跑卡`
- **THEN** 该边通过校验（等待端是新候选卡自己），候选卡可进入审阅

#### Scenario: 候选卡 blocks 现有在跑卡被标记非法
- **WHEN** 分解产出一张候选卡带 `blocks → 一张在跑卡`
- **THEN** 该边经共享边谓词判为非法、附可读原因进 issues，供审阅界面提示，不静默落下

#### Scenario: 候选卡预取名在本批内唯一
- **WHEN** 一次分解产出多张候选卡
- **THEN** 各候选卡的预取名互不相同（冲突时由取名工具加后缀去重）

### Requirement: 分解 skill 由项目类型集自动生成

系统 SHALL 把**生效分解 skill** 自动合成为两部分：**固定拆分模板**（写明怎么拆、输出候选卡字段结构〔标题/描述/类型/关系/预取名〕、预取名 slug 约束、保留用户描述里的附件路径到对应候选卡描述、**并说明关系边 `target` 既可引用本批候选卡、也可引用全盘快照里的现有卡 id 以建立跨卡依赖，尤其用 `blocked_by` 挂到在跑/未完成的现有卡上**）+ 由项目**在册类型**的 `name + description` 生成的**分类段**（告诉 LLM 有哪些类型、各自何时用，使候选卡 `typeId` 取自在册类型）。该自动生成 skill MUST 覆盖在册类型全集，且改动某类型描述即改变生成结果（类型描述是分类规则的单一来源，不在别处重复维护）。当项目无可用类型上下文时（如未绑定项目），系统 SHALL 以默认类型集合作为可选类型。

用户 MAY 提供一份**覆盖 skill**（手写或导入），用于自定义拆分启发式；其落盘/记录/查看/越界拒绝行为 MUST 与工作流节点 prompt 的「使用文件」导入一致。覆盖 skill 存在时优先于自动生成 skill（见「分解 prompt 的解析顺序」）。系统 SHALL 提供读取**自动生成 skill 完整文本**的能力，供 `card-type-registry` 的设置页预览。

#### Scenario: 候选卡按在册类型分类
- **WHEN** 项目定义了自定义类型（如 `spike`），无覆盖 skill，触发分解
- **THEN** 自动生成 skill 含各在册类型的 name+description，LLM 产出的候选卡 typeId 取自在册类型集合

#### Scenario: skill 引导引用现有卡建跨卡依赖
- **WHEN** 装配自动生成分解 skill 且随分解提供了本项目全盘快照
- **THEN** skill 文本说明 `target` 可引用现有卡 id、并引导用 `blocked_by` 把新需求挂到相关现有卡上

#### Scenario: 描述是分类规则单一来源
- **WHEN** 用户修改某类型的 description
- **THEN** 自动生成的分解 skill 的分类段相应变化，无需另行编辑 skill 文本

#### Scenario: 高级覆盖 skill 自定义拆分
- **WHEN** 用户手写/导入一份覆盖 skill
- **THEN** 其落盘/记录/查看/越界拒绝与节点 prompt「使用文件」导入一致，且分解时优先于自动生成 skill

#### Scenario: 自动生成 skill 文本可被读取预览
- **WHEN** 设置页请求自动生成分解 skill 的完整文本
- **THEN** 系统返回由拆分模板 + 当前在册类型合成的完整 skill 文本
