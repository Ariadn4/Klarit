## ADDED Requirements

### Requirement: 卡操作提案的审阅呈现

系统 SHALL 把编排核产出的**卡操作提案**（`OrchestrationProposal.ops`）以**审阅**形态呈现，泛化自现有 decompose「审阅候选→落库」流：不再只列候选卡，而以**操作预览（diff 感）**逐条呈现每个 op 的效果——「建 X」「把 A、B 并成 C」「把 D 拆成 D1/D2」「给 E 加 blocked_by F」。每条 op SHALL 前置一个**勾选框**供用户**选择应用哪些**（合法项默认勾选）；`create` op SHALL 展示其**卡描述**（**markdown 渲染**、默认折叠可展开），agent 回复亦 **markdown 渲染**（非源码）。应用时 SHALL 只应用**勾选的**合法 op。审阅 UI SHALL 遵 `docs/brand` 与设计令牌（仅语义令牌、深浅双主题）。

#### Scenario: ops 以操作预览 + 卡描述呈现

- **WHEN** 编排核产出一组含 create/merge/split/relate 的提案
- **THEN** 审阅界面逐条呈现每个 op 的效果预览，create 卡另显其 markdown 描述（可展开），用户应用前可看清将改什么

#### Scenario: 勾选选择应用哪些

- **WHEN** 用户取消勾选某些卡
- **THEN** 应用时只落库勾选中的卡；全不勾时应用按钮禁用（提示用户勾选）

### Requirement: 非法 op 属系统问题、对用户剔除并记录

逐 op 校验（目标存在、`typeId` 在册、预取名不撞、`parent` 无环、结构性 op 目标在待办等，见 `requirement-orchestration`）产生的非法 op **属系统/agent 生成问题、用户无法解决**。编排核 SHALL 先尽力**容错修复**（typeId 纠到在册类型、想挂子卡的卡纠到容器类型，见 `requirement-orchestration`）；仍非法的 op MUST **从用户可见提案中剔除、不呈现红色错误、不应用**，改为**记录供开发排查**（如 console 日志）+ 一句**低调的「已跳过 N 项」提示**；当**全部**非法（无合法项）时提示 SHALL **建议用户重试**。审阅只呈现/应用**合法** op。

#### Scenario: 非法 op 不甩给用户、只留低调提示

- **WHEN** 提案里部分 op 仍非法（修复后仍不合规）
- **THEN** 这些 op 从用户可见提案剔除、不显红警告、不应用；记录供开发排查，并显示低调「已跳过 N 项」提示；合法 op 正常呈现可勾选应用

#### Scenario: 全部非法建议重试

- **WHEN** 本轮所有 op 都非法（无合法项）
- **THEN** 不显应用按钮，提示「本轮未能生成合规卡（系统问题，已记录），建议重试」

### Requirement: 破坏性操作二次确认

系统 SHALL 对**破坏性 op**（`merge`、`split`、删卡）施以比非破坏性 op **更足的确认力度**：应用前须经用户明确二次确认，确认提示 MUST 交代该 op 将删除/合并哪些卡。非破坏性 op（create、纯 adjust、加边 relate）无需额外二次确认。

#### Scenario: 合并前二次确认

- **WHEN** 提案含一个 merge（将删除被并卡）
- **THEN** 应用前弹出二次确认、交代将合并/删除哪些卡，用户确认后才应用

#### Scenario: 非破坏性 op 无需二次确认

- **WHEN** 提案只含 create 与加边 relate
- **THEN** 用户在常规审阅确认后即可应用，无额外二次确认

### Requirement: 人确认后经 cardStore 应用（apply-ops）

系统 SHALL 提供一个 **`applyOps` 接缝**：在用户审阅确认后，把提案里的合法 op 逐条派发到 `requirement-card-store`（create/update/remove/addRelation/removeRelation/splitCard/mergeCards）落库应用，并刷新看板。**agent MUST NOT 直接落盘应用任何 op**——恪守「agent 提议、人确认、系统执行」红线。现有 decompose「描述想法」的落库路 SHALL 收敛为 applyOps 的一个特例（全是 create），不再另走一套落库逻辑。应用完成后 SHALL 回报实际创建/修改/删除的结果与逐 op 问题。

#### Scenario: 确认后派发到 cardStore

- **WHEN** 用户确认一组含 create/merge/relate 的提案
- **THEN** 系统经 applyOps 逐条派发到 cardStore 落库，看板刷新可见结果

#### Scenario: agent 不旁路人确认落盘

- **WHEN** 编排核产出提案
- **THEN** 在用户确认前，任何 op 都不落盘应用（agent 只提案）

#### Scenario: decompose 落库收敛为 applyOps 特例

- **WHEN** 用户经「描述想法」审阅通过一批候选卡
- **THEN** 其落库经同一 applyOps 接缝（全 create）完成，与编排落库共用一套逻辑

### Requirement: 新项目提议确认后创建项目并种入需求卡

当提案含 `suggestedProject`（见 `requirement-orchestration`）时，审阅界面 SHALL 呈现「**创建项目并加入这些需求**」而非「应用到当前项目」。用户确认后系统 SHALL：**请用户选一个目录** → 复用既有项目导入/创建能力（`importProject`，选目录建/导入项目并绑定当前窗口）→ **激活 `suggestedProject.workflowId` 指定的工作流**（`setActiveWorkflow` + 播种该工作流的建议类型，使新项目拿到对应类型集）→ 随即把提案的 `create` ops 经 `applyOps` **种入该新项目**（校验用该项目激活工作流后的类型集）→ 刷新看板。未指定 workflowId 时按默认类型。目录选择失败/取消 MUST 优雅中止、不建半截项目、不落卡。agent MUST NOT 自行建项目——建项目由用户确认并选目录触发。

#### Scenario: 确认新项目提议后建项目并种卡

- **WHEN** 提案含 `suggestedProject`，用户确认并选定一个目录
- **THEN** 系统建/导入该目录为新项目、绑定当前窗口，并把提案的 create ops 种入其看板，看板刷新可见

#### Scenario: 取消选目录不建半截项目

- **WHEN** 用户在选目录环节取消
- **THEN** 不创建项目、不落任何卡，流程优雅中止

### Requirement: 外部 ops 可经同一接缝提交

系统 SHALL 使外部 AI 产出的卡操作**可经同一接缝**进入人审与应用：外部按编排 schema 产出结构化 ops、经接缝提交，MUST 复用同一逐 op 校验（不旁路），进入与聊天入口一致的审阅→apply 流。

#### Scenario: 外部 ops 经同一校验进人审

- **WHEN** 外部 AI 按编排 schema 产出 ops 并经接缝提交
- **THEN** ops 经同一逐 op 校验、进入与聊天入口一致的审阅→apply 流

#### Scenario: 外部路不旁路校验

- **WHEN** 外部提交的 ops 含非法项（目标不存在、越界结构 op 等）
- **THEN** 这些 op 被同一校验标记并附原因，不被当作合法应用
