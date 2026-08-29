## ADDED Requirements

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
