# requirement-orchestration Specification

## Purpose
需求编排核：把全局 agent 的上下文扩为本项目全盘视野，用自由对话助手把用户意图解读为一组卡操作（create/adjust/split/merge/relate），经容错修复与逐 op 校验产出 `OrchestrationProposal`。编排核只读、只产提案、限本项目，破坏性操作只作用于待办列的卡，可提议新建项目并种入需求卡；产出者注入式可替换、失败时优雅降级，接口可程序化调用。
## Requirements
### Requirement: 全盘视野的编排上下文装配

系统 SHALL 提供一个**编排上下文装配器**，把全局 agent 的上下文从「一段自由文本」扩为**本项目的全盘视野**：项目**所有需求卡的活现状摘要** + **关系图** + **项目目标 / 该项目生效宪法**。装配 MUST **限本项目**（不跨项目取卡）。每张卡的摘要 SHALL 至少含预取名（id）、标题、类型名、状态、是否在「待办」列（未开始/无 `activeRunId`）、其关系边；描述按预算截断。关系图 SHALL 表达为卡间带类型边（`parent`/`child`/`blocked_by`/`blocks`/`coupled_with`）的可读列表。装配 SHALL 受 **token 预算**约束：超预算时按确定性顺序截断，并**显式标注被省略的卡数**（不静默截断）。

#### Scenario: 上下文含全盘卡摘要与关系图

- **WHEN** 在已绑定项目下装配编排上下文
- **THEN** 上下文含该项目全部卡的活现状摘要（含状态与是否在待办列）、卡间关系边列表、项目目标/生效宪法，且不含任何其它项目的卡

#### Scenario: 超预算时显式截断

- **WHEN** 项目卡数或内容超出 token 预算
- **THEN** 装配器按确定性顺序截断，并在上下文中标注「省略 N 张卡」，不静默丢弃

#### Scenario: 限本项目

- **WHEN** 存在多个项目、当前窗口绑定其一
- **THEN** 装配的全盘视野只含当前项目的卡与关系，不泄漏其它项目

### Requirement: 全局 agent 是自由对话助手（回复优先、技能内联）

全局 agent SHALL 是一个**自由对话助手**（对齐用户「像 Claude Code 那样能自由聊天、识别意图才调技能干活」的诉求），而非「每轮强制产出卡操作」。编排 prompt SHALL 把它塑造为 Klarit 需求助手：**自然语言回复永远是第一位**（`reply`）；**纯聊天/讨论/答疑是有效轮次**——此时 `ops` 为空、`issues` 为空、**不算失败、不显「本轮没产出」占位**（该占位仅在 `reply` 也为空时兜底）。仅当 agent **识别到可执行意图**（新建/改/拆/并/关联卡、新建项目、或**写/改工作流**）时，才按对应**技能**的输出格式在 `ops`（及新项目 `suggestedProject`、或**工作流** `workflow`）里产出结构化产出。各操作的技能说明 SHALL **内联进同一 agent 的 prompt**（每个技能格式即该操作输出的单一来源；`create` 沿用分解的卡字段约定；写工作流沿用 `buildAuthorWorkflowSkill()` 生成的契约），一次 agent 调用完成「聊天、产卡操作、或产工作流」的自路由。

#### Scenario: 纯聊天轮只回复、不产操作

- **WHEN** 用户发一条对话/提问（非塑造需求或工作流的意图，如「你觉得这个方向如何」）
- **THEN** agent 给出自然语言回复，`ops` 为空、无 `workflow`、无 issue、不显「本轮没产出」占位

#### Scenario: 识别到卡意图才按技能产出操作

- **WHEN** 用户表达一个卡意图（如「把 A、B 合并」/「新增一个导出需求」）
- **THEN** agent 在自然回复之外，按对应技能格式产出相应卡操作（merge/create 等）交审阅

#### Scenario: 识别到工作流意图才产出工作流

- **WHEN** 用户表达一个写/改工作流的意图（如「做个带评审门的 PR 工作流」）
- **THEN** agent 在自然回复之外，按写工作流技能格式产出一份完整 `workflow` 定义交预览

#### Scenario: prompt 内联各操作技能

- **WHEN** 装配编排 prompt
- **THEN** prompt 含「自由聊天优先」的角色说明、各卡操作（create/split/merge/relate/新建项目）技能格式、以及写工作流 skill，供 agent 识别意图后据以自路由产出

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

### Requirement: 编排产出的容错修复（typeId / 层级）

agent 产出的卡操作可能有可救的小瑕疵（非确定性）。编排核 SHALL 在校验前**尽力容错修复**，避免可救的卡被误判非法丢弃：

- **typeId 纠正**：`create`/`split`/`merge` 新卡的 `typeId` 若不在（该新项目所选工作流 / 当前项目 的）类型集在册，SHALL 纠到在册类型——按 id / 显示名不区分大小写匹配，再兜底到第一个 `leaf` 类型（见 `coerceToRegisteredType`）。
- **层级纠正**：一张卡若**想挂子卡**（含 `child` 关系）但其类型不是 `container`，SHALL 把其 `typeId` 纠到**容器类型**（保住层级、不丢卡），而非剔除。

修复后仍非法的才按「非法 op 属系统问题」处理（见 `card-ops-review-apply`）。

#### Scenario: 未知 typeId 纠到在册类型

- **WHEN** create 卡的 typeId 是近似名或越界值（如 `Feat`、`story`）
- **THEN** 纠到在册类型（如 `feature`），卡合法可用，不被丢弃

#### Scenario: 想挂子卡的叶子卡纠到容器

- **WHEN** 一张叶子类型的卡带了 `child` 子卡关系
- **THEN** 其类型纠到容器类型（如 `epic`），层级保住、卡不丢

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

### Requirement: 注入式编排产出者与优雅降级

系统 SHALL 以**注入式产出者**（ops producer）产出卡操作，把推理外包给用户配置的默认 agent——**真实调用**（复用用户订阅、不自建模型通道），拿编排上下文 + 意图 + 会话历史产出结构化卡操作。产出者 MUST 可被替换为**假实现**（测试注入固定 ops，不依赖真 CLI）。当未配置 agent、调用失败/超时、或回复无法解析为合法 ops 时，MUST **优雅降级**为空 ops 提案（附可读提示），不报错、不崩溃。

#### Scenario: 真实调用配置的 agent 产出 ops

- **WHEN** 已配置默认 agent，经编排核提交一段意图
- **THEN** 系统把编排上下文 + 意图喂给该 agent，解析其回复为结构化 CardOp 提案

#### Scenario: 调用失败时优雅空提案

- **WHEN** 未配置 agent，或调用失败/超时/回复不可解析
- **THEN** 编排核返回空 ops 提案并附可读提示，不报错、不崩溃

#### Scenario: 假产出者供测试

- **WHEN** 测试注入一个返回固定 ops 的假产出者
- **THEN** 编排核据其产出走通「意图→提案」全链路，不触真 CLI

### Requirement: 可程序化调用的编排接口

系统 SHALL 暴露一个**编排核接口** `orchestrate(intent, projectId, conversationId?) → OrchestrationProposal`，作为全局 agent 自身聊天入口与将来别处升级（单卡对话/门自由输入识别出「塑造需求」时上抛）**共用的单一编排核**。`OrchestrationProposal` SHALL 含 `ops`（卡操作数组）、`issues`（逐 op 校验问题）、`reply`（给用户看的自然语言答复，可选）、`suggestedProject`（新项目提议，可选）、`workflow`（工作流提案，可选——含完整 `WorkflowDefinition`、可选 `baseId` 与工作流校验 issues，见 `workflow-authoring`）。编排核 MUST 只**产出提案**、**只读**（不碰 git/代码、不落盘应用任何 op、不写工作流库）。当 `projectId` **未绑定项目**时，编排核 MUST **仍可运行**（不再是死空态）——全盘视野为空，agent 据意图对话，并**可提议新建项目**承载新项目需求（见「编排可提议新建项目」）。

#### Scenario: 编排核产出提案

- **WHEN** 以 (intent, 已绑定 projectId) 调用编排核
- **THEN** 返回含 ops + issues + reply（且按意图可含 workflow）的提案，未改动任何卡、工作流库、git 或代码

#### Scenario: 工作流意图产出 workflow 提案

- **WHEN** 以一段写/改工作流意图调用编排核
- **THEN** 返回的 `OrchestrationProposal` 带 `workflow`（完整定义 + 可选 baseId + 校验 issues），`ops` 为空

#### Scenario: 未绑定项目仍可对话与提议新建

- **WHEN** 以未绑定项目调用编排核
- **THEN** 编排核仍运行（空全盘视野），产出 reply 与（若意图是新项目）`suggestedProject` 提议，不报错、不静默无响应

#### Scenario: 聊天入口与升级调用共核

- **WHEN** 全局 agent 聊天入口与（将来）别处上抛分别发起编排
- **THEN** 两者经同一 `orchestrate` 核完成，行为一致

### Requirement: 编排可提议新建项目并种入需求卡

由于一张需求卡必须归属某个项目，当意图属于**一个新项目**（用户绑定的当前项目之外的新东西，或当前未绑定项目）时，编排核 SHALL 产出 `OrchestrationProposal.suggestedProject { name, description?, workflowId? }` 连同一批 `create` ops（该新项目的初始需求卡）。全盘视野**仍限当前项目**——agent 永不看别的项目的卡，故 MUST NOT 把需求投向另一个**已有**项目（不做跨项目路由）。

新项目该用哪套卡类型**取决于它激活的工作流**（该工作流的建议类型 + 默认类型），因此：编排 prompt SHALL 给出**可选工作流清单**（含各自类型 id），agent SHALL 为新项目**挑一个工作流**（`suggestedProject.workflowId`）并用**该工作流的类型 id** 给卡设 `typeId`；编排核对新项目 ops 的**校验 SHALL 用所选工作流的类型集**（未选工作流则用默认类型），而非当前项目的类型集——避免「在当前项目里建新项目、卡类型对不上被误判非法」。`suggestedProject` 的落地（选目录建/导入项目 + 激活该工作流 + 种入 create ops）归 `card-ops-review-apply`；编排核只**提议**、不建项目、不落盘。

#### Scenario: 新项目挑工作流并按其类型校验

- **WHEN** agent 为新项目提议某工作流（workflowId）并用该工作流的类型 id 建卡
- **THEN** 编排核用**该工作流的类型集**校验这些卡（合规），而非当前项目的类型集

#### Scenario: 新项目意图产出 suggestedProject

- **WHEN** 用户表达一个属于新项目的意图（如「我要做个全新的 X 工具」）
- **THEN** 编排核产出 `suggestedProject`（名/描述）+ 该项目的初始 `create` ops，交审阅流

#### Scenario: 当前项目意图不误提新项目

- **WHEN** 已绑定项目、意图明显属于当前项目
- **THEN** 编排核产出针对当前项目的卡操作，不产出 `suggestedProject`

#### Scenario: 不路由到别的已有项目

- **WHEN** 意图听起来像另一个已有项目的活
- **THEN** 编排核不引用/操作别的已有项目（它看不到），要么编排当前项目、要么提议新建项目

### Requirement: 编排上下文带工作流摘要与基准定义

为让全局 agent 能写/改工作流，编排上下文装配器 SHALL 在全盘视野之外**带上当前项目可见的工作流摘要**——每条至少含 id、显示名、是否无效（复用 `workflowSummary`）。摘要 MUST 恒带（便宜），供 agent 认识可改哪些工作流、按 id 点名 `baseId`。当本轮意图指向**改写**某工作流时，装配器 SHALL 注入**基准定义的完整内容**作起点：默认取当前项目的**活动工作流**（`getActiveWorkflowId()`），或 agent 点名的 `baseId` 对应工作流。基准定义注入 MUST 限当前项目可见的工作流，不跨项目。

#### Scenario: 上下文恒带工作流摘要

- **WHEN** 装配编排上下文
- **THEN** 上下文含当前项目可见工作流的摘要（id/名/是否无效），供 agent 认识与点名

#### Scenario: 改写意图注入活动工作流定义

- **WHEN** 意图指向改现有流且未点名具体工作流、项目有活动工作流
- **THEN** 装配器注入活动工作流的完整定义作基准起点

#### Scenario: 点名 baseId 注入对应定义

- **WHEN** agent 点名某 `baseId` 改写
- **THEN** 装配器注入该工作流的完整定义作基准，且限当前项目可见范围

