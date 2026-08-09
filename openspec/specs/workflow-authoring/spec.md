# workflow-authoring Specification

## Purpose
TBD - created by archiving change author-workflow-agent. Update Purpose after archive.
## Requirements
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


### Requirement: 写工作流 skill 覆盖 archive-docs

`buildAuthorWorkflowSkill` 从数据模型自动合成时 SHALL 带上新引擎操作 `archive-docs`，讲清其面向需求的语义：读文档登记表、按 `kind` 归档（动态就地更新 / 快照按习惯追加）、照审批过的习惯 prompt、子 agent 支持时并行否则串行退化、产生并提交文档改动。skill 文案 MUST 从引擎操作集单一来源派生，不手写漂移。

#### Scenario: skill 含 archive-docs 及其语义
- **WHEN** 合成写工作流 skill
- **THEN** 引擎操作段列出 `archive-docs` 并说明其读登记表、按习惯归档、并行/串行、提交语义

#### Scenario: skill 随操作集单一来源
- **WHEN** `ENGINE_OPERATIONS` 含 `archive-docs`
- **THEN** skill 自动包含它，无需手写维护

### Requirement: author 支持系统合成意图的无头调用

除经全局聊天由用户打字触发外,系统 SHALL 支持一个**无头写工作流入口**——以**显式 projectId** 与**系统合成的意图字符串**驱动 author,产出与聊天路径同构的 `WorkflowProposal`。该入口 MUST NOT 依赖聊天发送者事件取 projectId,MUST NOT 强制把结果追加进某个用户会话(是否留痕由调用方决定)。产出 SHALL 仍走现有 `buildWorkflowProposal`(`repairWorkflow` + `validateWorkflow` + `checkBranchPairing`),返回永远合法的定义 + `issues[]`;`buildAuthorWorkflowSkill()` 契约不变、照旧注入。

系统意图为「针对某已有项目、照其习惯写工作流」时,措辞 SHALL 指示 author **自行查看项目里的 agent 使用与 git/交付习惯**并据此产出——author 依赖其自身探查能力,不由调用方预抽取并喂入痕迹内容。

#### Scenario: 无头以系统意图产出提案

- **WHEN** 后台任务以显式 projectId + 系统合成意图调用 author 入口
- **THEN** author 产出一份经修复与两闸校验的 `WorkflowProposal`,不追加到用户会话、不依赖发送者事件

#### Scenario: 无头产出与聊天路径同构

- **WHEN** 无头入口与聊天入口对等价意图产出工作流
- **THEN** 两者产出的都是完整 `WorkflowDefinition` + `issues[]`,经同一 `repairWorkflow`/校验,提案形态一致

#### Scenario: 系统意图指示 author 自探项目习惯

- **WHEN** 系统意图为「照这项目的习惯写工作流」
- **THEN** 意图指示 author 自行查看 `.claude/`、`CLAUDE.md`、`.cursor` 等与 git/交付习惯,而非要求调用方预先抽取喂入

### Requirement: 写工作流 skill 以正向讲原因的措辞给搭流约束

`buildAuthorWorkflowSkill` 生成的新增搭流约束 SHALL 以**正向、讲清原因**的措辞表达:说明**应当怎么做及其缘由**,而非以负向禁止句罗列「不要做什么」;举例 SHALL 仅作轻点、不写满,以免 agent 只照抄示例而不外推到相邻情境。此为约束的**表达方式**要求,适用于下述两条及后续同类约束。

#### Scenario: 约束用正向讲原因而非负向禁止

- **WHEN** 合成写工作流 skill 的新增搭流约束
- **THEN** 文本正向陈述应当怎么做并给出原因,不以「不要/禁止」为主句式,示例点到为止

### Requirement: 写工作流 skill 教「连续作业交同一个节点」

`buildAuthorWorkflowSkill` SHALL 指导 author:**一段有连续状态、需靠 agent 保持上下文并据即时反馈逐步收敛的工作,应交给同一个 agent 节点完成**——因为只有同一 agent 在一个节点内持续作业,才有连续的上下文与反馈闭环把这段工作做到位。skill SHALL 说明**何时才分节点**(各段之间有明确交接产物,或换了执行者/仓)。措辞遵「正向讲原因」。

#### Scenario: skill 教连续作业归一个节点

- **WHEN** 合成写工作流 skill
- **THEN** 文本正向说明「据即时反馈逐步收敛的连续工作交同一 agent 节点」及其原因(连续上下文与反馈闭环),并说明何时才该分节点

### Requirement: 写工作流 skill 教「固化步骤排在人工验收之后」

`buildAuthorWorkflowSkill` SHALL 指导 author:**把结果固化下来、使改动离开可回退工作区的步骤(合入主线、对外公开、封存归档等),应安排在一道人工评审/验收之后**——因为固化一旦发生便难以收回,先让人有最后一次判断(满意才固化,不满意仍可打回改),工作流才稳。措辞遵「正向讲原因」,固化步骤以类别轻点(留「等」以示可外推),不逐一穷举。

#### Scenario: skill 教固化后置于人工验收

- **WHEN** 合成写工作流 skill
- **THEN** 文本正向说明「让改动离开可回退区的固化步骤排在人工验收之后」及其原因(固化难回退、留最后一次人判),固化类别轻点不穷举

### Requirement: 写工作流 skill 教「要人拍板处落成 manual 门」

`buildAuthorWorkflowSkill` SHALL 指导 author:**凡是要人来拍板/验收的地方,用 `manual` 门实现**——`manual` 门能弹出决策、带动作按钮、可驳回(触发内容驱动回退让人打回改),这才是真正拦得住、能交互的人工检查点。措辞遵「正向讲原因」:说清「要人拍板 → 落成 manual 门」及其缘由(唯有 manual 门才拦得住、可驳回),而非把「验收」写成一个只是叫这名字、实则跑命令或跑 agent 的普通节点(那样并不会真的等人)。

#### Scenario: skill 教人工验收用 manual 门

- **WHEN** 合成写工作流 skill
- **THEN** 文本正向说明「要人拍板/验收处用 `manual` 门(可弹决策、可驳回)」及其原因,指明这才是真正的人工检查点,而非徒有其名的命令/agent 节点

### Requirement: 写工作流 skill 把「不可逆固化前必有人工审批」立为硬要求

`buildAuthorWorkflowSkill` SHALL 正向、讲原因地把**「不可逆固化(合并回主干、推送、开 PR)之前必须有一道人工审批门」立为硬要求**——这是产品底线,**不因项目"自主/无人值守"而省**;人工审批用 `manual` 门实现(可弹决策、可驳回)。措辞遵「正向讲原因」,不以负向禁止句为主。

#### Scenario: skill 把固化前审批立为硬要求

- **WHEN** 合成写工作流 skill
- **THEN** 文本明确「不可逆固化前必须有一道人工审批 manual 门」是硬要求,且说明不因项目自主而省,并给出原因(重大不可逆步骤须人来把最后一关)

### Requirement: 自动 author 须能读到项目文件

自动(无头)author 一份「照项目习惯写」的工作流时,系统 SHALL 让 author agent **能读到该项目的文件**——把项目各成员仓的**真实路径**作为 agent 的可访问目录(如 `--add-dir`)传入,使其可实际查看 `.claude/`、`CLAUDE.md`、`.cursor`、`git log` 等以推断习惯。系统意图 SHALL 相应告知 agent「可直接查看本项目文件」并加**只读约束**:只做只读探查、只输出工作流定义、不改动任何文件。此为纠正「author 跑在 userData scratch、拿不到项目路径、只能靠 prompt 上下文猜」的根因。

#### Scenario: author 拿到项目目录访问

- **WHEN** 自动 author 触发
- **THEN** author agent 以项目成员仓真实路径为可访问目录运行,能实际读到项目的 `.claude/`/`CLAUDE.md`/`git` 等

#### Scenario: 意图带只读约束

- **WHEN** 合成自动 author 的系统意图
- **THEN** 意图告知可直接查看项目文件,并约束只读探查、只输出工作流、不改动任何文件

### Requirement: 改写基准可取会话里的未存草稿

改写工作流时,若**当前会话最后一条 agent 消息带着一份未存库的工作流草稿**(`message.proposal.workflow.workflow`),系统 SHALL 以**该草稿定义**作为改写基准注入 prompt(覆盖默认的「库里活动工作流」基准),使用户「就着刚产出的这份草稿改」;此时 `baseId` 留空(草稿未落库→整体替换、新建,合「无 diff/patch」契约)。会话无未存草稿时,基准回落到活动工作流(原行为)。草稿全程不落库——改写只在会话里滚动,人确认(保存/设为项目工作流)才落库,不违「只提案、人确认才落库」红线。

#### Scenario: 就着草稿改而非改活动工作流

- **WHEN** 会话末条 agent 消息带未存工作流草稿,用户回复「加一道人工验收 manual 门」
- **THEN** 系统以该草稿为基准改写、产出更新后的完整草稿,而非改动库里的活动工作流

#### Scenario: 无草稿则回落活动工作流

- **WHEN** 会话里没有未存工作流草稿
- **THEN** 改写基准仍取当前项目的活动工作流(原行为不变)

### Requirement: 自动 author 产出经固定脚手架规整(头尾写死、中间为其生成的干活段)

自动（导入后）author 产出的工作流,系统 SHALL 经**固定脚手架规整**成最终提案——即把 author 产出里的**干活节点当作中间**喂给 `buildScaffoldedWorkflow`,由它套上**固定头**（建分支→开 worktree→关联环境）与**固定尾**（人工验收门 → 归档 `archive-docs` → 合并/推送/清理,按变体）,顺序钉死为 **中间→验收门→归档→合并→清理**。author 产出里的**脊柱类节点**（分支/worktree/合并/推送/清理/归档/验收门）SHALL 被脚手架**丢弃并以固定脊柱替换**（比照 `repairWorkflow` 丢非法节点）——故 author 把脊柱摆错也无所谓,结构由脚手架保证。规整后仍走 `repairWorkflow`+`validateWorkflow`+`checkBranchPairing` 兜底。

- **变体**：由 author 产出推断（含 `open-pr` → `pr`,否则 `local-merge`；缺省 `local-merge`）。
- **归档清单**：从 author 产出的 `archive-docs` 节点的 `executor.archiveDocs` 抽出,带进脚手架的归档节点（无则空、走扫描兜底）。
- **聊天写工作流路不变**（仍产整份、用户全权控制、不走脚手架规整）。

> 机制注:让 author 照旧产整份、再确定性规整到脚手架——比改 author 的产出契约(只产中间)更稳,结果等价(头尾固定、中间是 author 生成的干活段)。

#### Scenario: author 产出被规整成固定脚手架

- **WHEN** 自动 author 产出一份工作流（脊柱可能摆错）
- **THEN** 系统把其干活节点当中间、套固定头/尾,产出 中间→验收门→归档→合并→清理 的合法提案

#### Scenario: 脊柱位置永远正确(结构消灭排序问题)

- **WHEN** 任何自动 author 产出经脚手架规整
- **THEN** 验收门在合并前、归档在验收后合并前、清理在最后——位置由脚手架固定,author 摆错被替换

#### Scenario: author 脊柱/验收/归档节点被替换

- **WHEN** author 产出里含自己的 `merge-branch`/验收门/`archive-docs` 等脊柱节点
- **THEN** 规整丢弃它们、以固定脊柱替换（archive 清单从其 archive-docs 节点抽出后带入固定归档节点）

#### Scenario: 聊天路不走脚手架

- **WHEN** 用户在全局聊天里写/改工作流
- **THEN** 仍产整份 `WorkflowDefinition`,不套脚手架规整

#### Scenario: 自动 author 产中间被脚手架拼成整份

- **WHEN** 自动 author 产 `{ variant:'local-merge', middle:[...干活...], archiveDocPaths:[...] }`
- **THEN** 系统拼成:固定头 + middle + 验收门 + archive-docs(带清单) + 合并/推送/清理,顺序为 中间→验收门→归档→合并→清理,过两闸校验

#### Scenario: 脊柱位置永远正确(结构消灭排序问题)

- **WHEN** 任何自动 author 产出经脚手架装配
- **THEN** 验收门在合并前、归档在验收后合并前、清理在最后——位置由脚手架固定,LLM 产不出错位

#### Scenario: middle 混入脊柱节点 → 丢弃

- **WHEN** author 的 `middle` 里误含 `merge-branch`/`create-branch` 等脊柱节点
- **THEN** 装配丢弃这些、只保留干活类节点

#### Scenario: 聊天路不走脚手架

- **WHEN** 用户在全局聊天里写/改工作流
- **THEN** 仍产整份 `WorkflowDefinition`,不套脚手架

### Requirement: 写工作流 skill 教归档规范(列清单 + 优先项目自带 + 通用不点名)

`buildAuthorWorkflowSkill` SHALL 正向、讲原因地加轻量**归档规范**(脊柱由脚手架规整,故 skill 只需管归档这块的内容质量):

- 归档**尽量只一个文档归档节点**；
- **项目若有自己的归档/沉淀方式,优先用它**（措辞**通用**,MUST NOT 点名具体技能名,例子只轻点）；
- 它没覆盖到的文档,在 `archive-docs` 节点里**把该归档的文档路径列进清单**（`executor.archiveDocs`）,这样归档直接按清单走、免二次扫描；
- 归档**不设门**（脚手架已保证归档在人工验收之后,author 不必自己摆位置）。

#### Scenario: skill 教归档规范

- **WHEN** 合成写工作流 skill
- **THEN** 文本正向说明「优先项目自带归档(通用不点名)、尽量单归档节点、没覆盖的文档在 archive-docs 里列清单、归档不设门」及原因

#### Scenario: 措辞通用不点名

- **WHEN** skill 讲优先用项目自带归档
- **THEN** 用「项目自己的归档方式」这类通用措辞,不写死某个具体技能名

### Requirement: 提案预览浮层主操作为「保存并设为本项目工作流」一键

工作流提案预览浮层（chromeless 底栏）的**主操作** SHALL 由原「保存为正式工作流 → (二次确认) 设置为本项目工作流」两步**合并为一键**:

- 当这份工作流**尚不是**当前项目的活动工作流时,主按钮显示「**保存并设为本项目工作流**」,点击 SHALL **先保存入库、再激活为本项目工作流**(一次点击完成);保存被校验拦下则不激活、回报原因。
- 当它**已是**当前项目活动工作流时,主按钮显示「**更新工作流**」(仅保存/更新,不必再激活)。
- 底栏保留「关闭」;**移除**原独立的「设置为本项目工作流」按钮与其二次确认步骤(一键即人确认)。

此改仅作用于**提案预览浮层**(chromeless 底栏);设置里的工作流编辑（顶栏保存）不受影响。

#### Scenario: 未激活 → 一键保存并设为本项目工作流

- **WHEN** 预览浮层里这份工作流尚不是当前项目活动工作流,用户点主按钮「保存并设为本项目工作流」
- **THEN** 系统先保存入库、再 `setActiveWorkflow` 激活到当前项目(一次点击);之后按钮变为「更新工作流」

#### Scenario: 已是活动工作流 → 主按钮仅「更新工作流」

- **WHEN** 这份已是当前项目活动工作流
- **THEN** 主按钮显示「更新工作流」,点击仅保存/更新

#### Scenario: 保存校验不过 → 不激活

- **WHEN** 点「保存并设为本项目工作流」但保存被语义校验拦下
- **THEN** 回报原因、不激活、不写盘

#### Scenario: 设置里编辑不受影响

- **WHEN** 在设置里编辑库中工作流(非 chromeless 预览)
- **THEN** 仍是顶栏保存那套,无此合并按钮

### Requirement: 自动 author 被喂项目文档枚举、产出 archive-docs 分类配置

自动 author 运行时,系统 SHALL 把**项目文档枚举**(复用 `scanCandidates` 的**廉价文件遍历**,无 agent)注入 author 上下文,使 author 无需自行发现文档。author SHALL 据此为 `archive-docs` 节点产出**分类文档配置** `[{ path, kind: 'dynamic'|'snapshot' }]`:

- **剔除**项目自有归档方式已覆盖的文档(不重复归);
- 剩余文档各判 `dynamic`(就地更新现状)/ `snapshot`(冻结追加);
- 写进 archive-docs 节点配置(经脚手架规整时带入固定归档节点)。

如此归档配置随工作流一次产出,自动流**无需独立的文档分析 agent、激活时不触发扫描**。skill 相应教 author 此产出方式(措辞通用、不点名具体技能)。

#### Scenario: 喂枚举、author 产分类配置

- **WHEN** 自动 author 运行,系统注入项目文档枚举
- **THEN** author 剔除项目自有归档覆盖的文档、把剩余分动态/快照,产出 archive-docs 的 `[{path,kind}]` 配置

#### Scenario: 配置随工作流产出、免二次扫描

- **WHEN** 自动 author 产出含分类配置的 archive-docs
- **THEN** 该配置经脚手架带入固定归档节点,激活/运行时按配置归档,不触发独立文档分析 agent
