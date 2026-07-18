## MODIFIED Requirements

### Requirement: 写工作流 skill 从数据模型自动生成

系统 SHALL 提供一个**写工作流 skill 生成器** `buildAuthorWorkflowSkill()`（纯函数，main 与 renderer 共享），从工作流数据模型的**单一来源**——`ENGINE_OPERATIONS`（含 `engineOpCapabilities`）、执行者类型集（`agent`/`engine`/`command`/`subworkflow`）、门把类型集（`auto`/`manual`/`external`）、`validateWorkflow`/`checkBranchPairing` 的约束——**自动合成** skill 文本。该 skill MUST 教会 agent 完整的 `WorkflowDefinition` 输出契约：阶段与节点结构、执行者联合、封闭引擎操作集及其能力（产出/门/可写范围）、**门把三类及其语义**、目标扇出、分支配对规则（建了分支必须有删分支节点），以及「只输出结构化工作流对象」的收尾约定。该生成 MUST 与 `buildDecomposeSkill(types)` 同一先例，使 skill 永不与 `validateWorkflow` 接受的形状漂移。

skill 文本 SHALL 讲清「引擎操作」是**平台预制的现成节点**——对外是 engine 操作、内部实现可由 git/agent/命令支撑（封装细节，作者无需关心内部）。对新增能力，skill SHALL 讲清其面向需求的语义：`open-pr`（在各仓所在托管平台开 PR/MR、逐涉及仓、平台无关）与**外部门** `external`（挂在如 `open-pr` 上，等平台把 PR 合并——`verify: 'pr-merged'`——合了才过门收尾，不满意在自由输入里写反馈即打回改代码），使 author 能把它们编入「真 PR」类工作流而不臆造平台细节。

#### Scenario: skill 覆盖当前引擎操作集与门把类型

- **WHEN** 生成写工作流 skill
- **THEN** skill 文本列出的可用引擎操作、执行者类型、门把类型与 `ENGINE_OPERATIONS` / 执行者联合 / 门把类型集一致，无遗漏、无越界项（含 `open-pr` 与门把 `external`）

#### Scenario: 数据模型改动即改 skill

- **WHEN** 引擎操作集、门把类型集或校验约束变化
- **THEN** 重新生成的 skill 随之更新，无需手改 skill 文本（单一来源）

#### Scenario: skill 讲清 open-pr 与外部门面向需求的语义

- **WHEN** 生成写工作流 skill
- **THEN** 文本说明 `open-pr` 逐涉及仓、平台无关地开 PR/MR，外部门 `external`（`pr-merged`）等平台合并才过门、打回即回退，且不要求 author 臆造 `gh` 等具体平台 CLI 细节
