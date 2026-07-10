# requirement-decomposition Specification

## Purpose
把一段自由描述（或某张卡触发的联动场景）按生效 prompt 分解成多张候选需求卡的能力：分解输入与结构化候选卡输出、生效 prompt 解析顺序（覆盖 skill → 由项目类型集自动生成的分解 skill 兜底）、分解 skill 的自动生成与可选覆盖，以及经 IPC 暴露。止于产出候选卡（落库归后续 change）。

## Requirements

### Requirement: 分解需求的输入与候选卡输出

系统 SHALL 提供一个**分解需求**能力：输入一段**自由描述文本**（用户可能一口气写很长、含多个点子，并可夹带截图/文件路径，见 `decompose-ui`）与一份**生效的分解 prompt**，由全局 agent 产出一组**候选需求卡**。每张候选卡 MUST 含 `requirement-card-model` 规定的全部 agent 生成字段：**标题**、**描述（markdown）**、**类型**（`typeId`，引用项目类型注册表中的某个类型，见 `card-type-registry`）、**卡关系**（带类型边，目标用本批候选卡的预取名引用）、**预取名**（git 友好 slug）。候选卡 MUST 是结构化、可逐张审阅的数据，而非一段自由文本。

候选卡是**未落库的中间产物**——它承载分解结论，止于产出与审阅，落库归后续 change（见 `requirement-card-model`、`global-agent`）。

#### Scenario: 一大段描述分解为多张候选卡
- **WHEN** 以一段含多个点子的自由描述与生效 prompt 触发分解
- **THEN** 系统产出一组结构化候选卡，每张含标题、描述、类型(typeId)、卡关系、预取名

#### Scenario: 候选卡字段符合卡模型
- **WHEN** 读取一次分解产出的候选卡
- **THEN** 每张卡的 typeId 引用项目在册类型、预取名为 git 友好 slug、关系边类型取自封闭词表且目标引用本批某张候选卡的预取名

#### Scenario: 候选卡预取名在本批内唯一
- **WHEN** 一次分解产出多张候选卡
- **THEN** 各候选卡的预取名互不相同（冲突时由取名工具加后缀去重）

### Requirement: 分解 prompt 的解析顺序

分解所用的 prompt SHALL 按确定顺序解析：**高级覆盖 skill（当前项目激活工作流的「新建需求」prompt，或全局手写/导入的覆盖 skill，若声明）→ 由项目类型集自动生成的分解 skill（兜底，始终可得）**。即：声明了覆盖 skill 时用覆盖 skill；否则用自动生成的分解 skill。解析 MUST 始终得到一份非空生效 prompt（自动生成的分解 skill 是兜底来源，只要至少有默认类型即非空，保证无工作流/无覆盖时分解仍可进行）。

#### Scenario: 优先用覆盖 skill
- **WHEN** 当前项目声明了覆盖 skill（工作流「新建需求」prompt 或全局手写/导入 skill），触发分解
- **THEN** 系统以该覆盖 skill 作为生效 prompt

#### Scenario: 无覆盖时用自动生成分解 skill
- **WHEN** 当前项目无任何覆盖 skill
- **THEN** 系统以由项目类型集自动生成的分解 skill 作为生效 prompt，分解仍可进行

### Requirement: 分解 skill 由项目类型集自动生成

系统 SHALL 把**生效分解 skill** 自动合成为两部分：**固定拆分模板**（写明怎么拆、输出候选卡字段结构〔标题/描述/类型/关系/预取名〕、预取名 slug 约束、保留用户描述里的附件路径到对应候选卡描述）+ 由项目**在册类型**的 `name + description` 生成的**分类段**（告诉 LLM 有哪些类型、各自何时用，使候选卡 `typeId` 取自在册类型）。该自动生成 skill MUST 覆盖在册类型全集，且改动某类型描述即改变生成结果（类型描述是分类规则的单一来源，不在别处重复维护）。当项目无可用类型上下文时（如未绑定项目），系统 SHALL 以默认类型集合作为可选类型。

用户 MAY 提供一份**覆盖 skill**（手写或导入），用于自定义拆分启发式；其落盘/记录/查看/越界拒绝行为 MUST 与工作流节点 prompt 的「使用文件」导入一致。覆盖 skill 存在时优先于自动生成 skill（见「分解 prompt 的解析顺序」）。系统 SHALL 提供读取**自动生成 skill 完整文本**的能力，供 `card-type-registry` 的设置页预览。

#### Scenario: 候选卡按在册类型分类
- **WHEN** 项目定义了自定义类型（如 `spike`），无覆盖 skill，触发分解
- **THEN** 自动生成 skill 含各在册类型的 name+description，LLM 产出的候选卡 typeId 取自在册类型集合

#### Scenario: 描述是分类规则单一来源
- **WHEN** 用户修改某类型的 description
- **THEN** 自动生成的分解 skill 的分类段相应变化，无需另行编辑 skill 文本

#### Scenario: 高级覆盖 skill 自定义拆分
- **WHEN** 用户手写/导入一份覆盖 skill
- **THEN** 其落盘/记录/查看/越界拒绝与节点 prompt「使用文件」导入一致，且分解时优先于自动生成 skill

#### Scenario: 自动生成 skill 文本可被读取预览
- **WHEN** 设置页请求自动生成分解 skill 的完整文本
- **THEN** 系统返回由拆分模板 + 当前在册类型合成的完整 skill 文本

### Requirement: 分解能力经 IPC 暴露

分解需求能力 SHALL 经 IPC 暴露给渲染层：给定自由描述与当前项目上下文，解析生效 prompt 并驱动全局 agent 产出结构化候选卡返回。该 IPC 契约 MUST 是稳定、结构化的，使「新建需求」入口、全局 agent 与外部 AI 都经同一契约调用（见 `global-agent`）。本能力的 IPC **只覆盖到产出候选卡**；候选卡落库的契约归后续 change。

候选卡校验 SHALL 以项目在册类型为依据：`typeId` 不在册的候选 MUST 被标记并附可读原因（同悬挂关系、空标题的待遇），**不静默回落**到某个默认类型。

#### Scenario: 经 IPC 请求分解
- **WHEN** 渲染层经 IPC 提交一段自由描述请求分解
- **THEN** 系统解析生效 prompt、驱动产出并返回结构化候选卡列表

#### Scenario: 候选卡校验随产出
- **WHEN** 分解产出候选卡
- **THEN** 不合卡模型的候选（如空标题、非法预取名、**typeId 不在册**）被标记并附可读原因，供审阅界面提示，不静默回落到默认类型
