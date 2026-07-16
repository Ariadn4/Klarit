## ADDED Requirements

### Requirement: 写工作流 skill 教可靠搭流、避免臆造

写工作流 skill SHALL 教 author agent 正确使用现实能力、避免臆造与脆弱写法：

- **已装技能（installed）**：当某 agent 节点想用运行时编程 agent **已经具备**的能力（如 Claude Code 的 `opsx:explore`），skill SHALL 指导它用 `installed` 形态**给出技能调用名**，而 MUST NOT 臆造本地相对路径、MUST NOT 臆测该技能的产物或行为。skill SHALL 说明：运行时 agent 自带其已装技能，Klarit 只按名引用。
- **多仓——谁逐仓要分清**：skill SHALL 讲清引擎 git 操作**默认逐涉及仓**（`target` 缺省 = 涉及仓全集，可按 `tag`/`repo` 收窄）、agent 节点能看到所有涉及仓（主仓 cwd + 其余 `--add-dir`）；但 **command 节点与 auto 门的校验命令只在主仓 worktree 跑一次、不逐仓**。编排上下文 SHALL 提供**本项目成员仓与标签清单**。skill SHALL 因此劝阻：别假设单条 `npm test` 覆盖多仓、别硬编跨仓相对路径（如 `../<repo>--wt--<名>`），要跨仓测改用 agent 节点。
- **门不要脆弱**：skill SHALL 讲清 auto 门是「命令退 0 才放行、无反着判」，MUST 劝阻「必须失败」的红门（会因套件已有失败/xfail 把后续绿门永久卡死）；「测试先行（先红）」写进 agent 节点指令、auto 门只用绿门。
- **reply/description 面向需求**：skill SHALL 要求 `reply` 与工作流 `description` 只讲为需求做了什么，MUST NOT 复述引擎既定机制（多仓逐仓、门/分支配对怎么工作）。

#### Scenario: 用已装技能而非臆造路径

- **WHEN** 用户意图里某节点要用运行时 agent 已装的技能（如 `opsx:explore`）
- **THEN** author 产出该节点为 `installed` 形态、只给调用名，不带本地路径、不臆测其产物

#### Scenario: 多仓——不硬编跨仓命令路径

- **WHEN** 多仓项目里要在非主仓做测试/检查
- **THEN** skill 使 author 知晓 command/门命令只在主仓跑、改用 agent 节点覆盖多仓，而非硬编 `../<repo>--wt--<名>` 路径

#### Scenario: 不搭「必须失败」的红门

- **WHEN** author 想表达「测试先行/先红」
- **THEN** 它把先红写进 agent 节点指令、auto 门只用绿门，而非搭一个「npm test 必须失败」的红门

#### Scenario: reply 不复述引擎机制

- **WHEN** author 产出工作流提案
- **THEN** `reply`/`description` 只面向需求，不复述多仓逐仓、门机制等既定行为

### Requirement: 写工作流 skill 从数据模型自动生成

系统 SHALL 提供一个**写工作流 skill 生成器** `buildAuthorWorkflowSkill()`（纯函数，main 与 renderer 共享），从工作流数据模型的**单一来源**——`ENGINE_OPERATIONS`（含 `engineOpCapabilities`）、执行者类型集（`agent`/`engine`/`command`/`subworkflow`）、`validateWorkflow`/`checkBranchPairing` 的约束——**自动合成** skill 文本。该 skill MUST 教会 agent 完整的 `WorkflowDefinition` 输出契约：阶段与节点结构、执行者联合、封闭引擎操作集及其能力（产出/门/可写范围）、门语义、目标扇出、分支配对规则（建了分支必须有删分支节点），以及「只输出结构化工作流对象」的收尾约定。该生成 MUST 与 `buildDecomposeSkill(types)` 同一先例，使 skill 永不与 `validateWorkflow` 接受的形状漂移。

#### Scenario: skill 覆盖当前引擎操作集

- **WHEN** 生成写工作流 skill
- **THEN** skill 文本列出的可用引擎操作与执行者类型与 `ENGINE_OPERATIONS` / 执行者联合一致，无遗漏、无越界项

#### Scenario: 数据模型改动即改 skill

- **WHEN** 引擎操作集或校验约束变化
- **THEN** 重新生成的 skill 随之更新，无需手改 skill 文本（单一来源）

### Requirement: 意图产出为完整工作流定义（整体替换）

当全局 agent 识别到**写/改工作流**的意图时，系统 SHALL 让其产出一份**完整的** `WorkflowDefinition`（永不产出增量/patch）。产出 SHALL 区分两种语义：

- **create**（无 `baseId`）：从零产出一份全新工作流定义。
- **edit**（带 `baseId`）：以某份现有工作流定义为**起点**改写，产出一份全新的完整定义，落库时**覆盖** `baseId` 对应的工作流。

编辑基准 SHALL 默认取**当前项目的活动工作流**（复用 `getActiveWorkflowId()`）；agent 亦可从上下文的工作流摘要里点名另一个 `baseId`。v1 MUST NOT 引入 diff/patch 形态——一律整体替换。

#### Scenario: 从零产出新工作流

- **WHEN** 用户表达一个不针对既有工作流的意图（如「做个带评审门的 PR 工作流」）
- **THEN** agent 产出一份不带 `baseId` 的完整 `WorkflowDefinition`，落库为新工作流包

#### Scenario: 改写活动工作流

- **WHEN** 用户表达改现有流的意图（如「在我的流里加个 typecheck 门」）且未点名具体工作流
- **THEN** 系统以活动工作流的完整定义为起点注入，agent 返回带该工作流 id 作 `baseId` 的完整新定义，落库时覆盖它

#### Scenario: 点名改写另一个工作流

- **WHEN** 用户点名改上下文摘要里的另一个工作流
- **THEN** 系统注入该工作流的完整定义作基准，agent 产出带该 `baseId` 的完整新定义

### Requirement: 工作流产出自动修复到合法

系统 SHALL **直接给用户一份合法的工作流**，而非产出瑕疵定义再要用户回话调整。为此，对 agent 产出的工作流定义，系统 SHALL 先做**确定性容错修复**（`repairWorkflow`，对齐编排「意图→卡操作」那条「容错修复后再校验」的先例）：填补空 id/显示名、保证至少一个阶段、把节点无效 `stageId` 纠到有效阶段、丢弃执行者非法的节点（不臆造）、过滤产出/门/可写范围/目标为合法子集、并按分支配对**自动补一个 `delete-branch` 节点**。修复 SHALL 覆盖 LLM 产出的常见瑕疵（尤以「建了分支忘了删」为首），使定义能过 `validateWorkflow` + `checkBranchPairing`。修复后系统仍走两闸校验，把任何残留问题收进 `issues` 作**兜底**——正常修复能补的情况下 `issues` 为空；仅对无骨架的极端输入才残留，此时存库入口禁用（不写非法定义）。校验 MUST NOT 被旁路。

#### Scenario: 合法工作流原样有效

- **WHEN** agent 产出的工作流已过 `validateWorkflow` 与 `checkBranchPairing`
- **THEN** 修复幂等、`issues` 为空，可直接存库

#### Scenario: 建了分支忘了删 → 自动补删分支节点

- **WHEN** agent 产出的工作流有 `create-branch` 却无 `delete-branch`
- **THEN** 系统自动补一个 `delete-branch` 节点，定义变合法、`issues` 为空，无需用户回话调整

#### Scenario: 常见瑕疵自动纠正

- **WHEN** 节点 `stageId` 越界、显示名为空、或带非法产出/门/可写范围
- **THEN** 系统纠 stageId、填名、过滤为合法子集，定义变合法、`issues` 为空

#### Scenario: 无骨架的极端输入 → 兜底禁用存库

- **WHEN** 产出无任何可救的合法节点、修复后仍不过校验
- **THEN** `issues` 非空、存库入口禁用（不写非法定义），半成品仍显示供参考

### Requirement: 工作流提案经完整编辑器预览、可编辑、保存入库、设为项目工作流

系统 SHALL 把工作流产出表达为一个 `workflowProposal`（含完整 `WorkflowDefinition`、可选 `baseId`、校验 `issues`），并遵全局 agent 红线——**只提案、人确认后才落库**。聊天里的提案 SHALL 只呈现**一个「预览草稿」入口**（及「工作流提案」标签，不在聊天内铺开细节）。点击 SHALL 打开一个**浮层窗口，复用设置里的完整 `WorkflowEditor`**（与设置观感一致），使门具体验收什么、每节点的执行者与多仓 `target`、产出等**全部可见**，且用户**可手动编辑**。

为承载未落库的内存定义，`WorkflowEditor` SHALL 支持**草稿态**（`initialDef` 种子）。**再次打开的取值**：未入库过 → 用草稿；已入库过 → **优先从库读**（含上次编辑），读不到（如已在设置里被删）**回落到草稿**（不得卡「加载中」）。

浮层 SHALL 用**底部固定横栏**承载动作（顶栏不放返回/保存）：**关闭** + **保存为正式工作流**（已存过显**更新工作流**）+（仅在已保存为正式后出现、且这份**尚不是**当前项目激活工作流时）**设置为本项目工作流**。「保存」经 `workflow-store.save()` 落库——落库前 SHALL 把 `def.id` 强制为 `baseId`（若有）覆盖对应包，无 `baseId` 则按 `def.id` 新建；`save()` 校验为最终闸，非法则回报、不写盘；保存前 MUST NOT 改动工作流库（人确认 = 点保存）。「设置为本项目工作流」SHALL **二次确认**后先保存、再经 `setActiveWorkflow` 激活到当前项目；激活后该按钮 SHALL 消失（已是激活工作流）。

#### Scenario: 聊天里只给「预览草稿」入口

- **WHEN** agent 产出一个 `workflowProposal`
- **THEN** 聊天消息里呈现「工作流提案」+「预览草稿」按钮，不在聊天内铺开节点细节

#### Scenario: 预览打开完整可编辑编辑器

- **WHEN** 用户点「预览草稿」
- **THEN** 打开浮层窗口，以完整 `WorkflowEditor`（草稿态）呈现该工作流，门/产出/多仓 target 均可见且可手动编辑

#### Scenario: 底部横栏保存即入库

- **WHEN** 用户在编辑器里（改或不改后）点底部「保存为正式工作流」
- **THEN** 经 `workflow-store.save()` 落库（无 `baseId` 按 `def.id` 新建、有 `baseId` 强制覆盖该包），保存前工作流库不变

#### Scenario: 已入库后再次预览读库版本、库中已删则回落草稿

- **WHEN** 一份已保存的提案被再次「预览草稿」
- **THEN** 优先从库读回（含上次编辑）；若该工作流已在设置里删除、库中读不到，则回落到草稿定义呈现，不卡「加载中」

#### Scenario: 设置为本项目工作流（保存后、二次确认）

- **WHEN** 工作流已保存为正式、用户点「设置为本项目工作流」并二次确认
- **THEN** 先保存入库、再 `setActiveWorkflow` 激活到当前项目；该按钮随后消失（已是激活工作流）

#### Scenario: 未保存或已是激活工作流则不显该按钮

- **WHEN** 工作流尚未保存为正式，或它已是当前项目的激活工作流
- **THEN** 不呈现「设置为本项目工作流」按钮

#### Scenario: 保存校验不过回报原因

- **WHEN** 保存时 `save()` 判定定义非法
- **THEN** 编辑器回报可读原因、不写盘，草稿保留供改后再存
