## Why

导入一个**已经在用 AI 编程 agent 的老项目**时,这项目身上带着一整套「习惯」——用哪套 agent(`.claude/`、`.cursor/`、`AGENTS.md`)、`CLAUDE.md` 里的规约(测试先行、Conventional Commits、PR 还是本地直合)、hooks、有没有 remote。今天 Klarit 对这些**视而不见**:普通导入根本不给项目派任何工作流(只有 `orchestrateCreateProject` 那条「AI 建新项目」的路会派),用户得自己进设置挑一个,或者一直空着。

而「读项目 → agent 写工作流 → 修复到合法 → 预览采用」这条链**大半已经建好**了(`workflow-authoring` 能力:`buildAuthorWorkflowSkill` 教 agent 产出完整 `WorkflowDefinition`、`repairWorkflow` 容错、`WorkflowProposal` + 浮层 `WorkflowEditor` 预览采用)——只是今天**只能靠用户在全局聊天里打字触发**。

本 change 把这条现成的链**自动接到导入流程上**:老项目(有 agent 习惯痕迹)且本机有能跑的 agent 时,导入后自动让 author agent「照这项目的习惯写一份工作流」,产出主动弹给用户浏览、决定是否采用;新项目 / 没痕迹 / 没装 agent 时,派**纯默认工作流**兜底。用户第一次打开老项目就能拿到一份贴合它习惯的工作流草稿,而不是一张白纸。

**为什么排在文档扫描之后**:不是数据依赖(author 会自己去翻项目,不需要审批过的登记表),而是**agent 档期串行**——全局就一个默认 agent,文档语义分析正占着它;分析一返回、agent 腾出来,才接着起写工作流的任务。触发点是**主进程文档分析返回那一刻**,不等用户在 onboarding dialog 里点「保存」。

本 change 是两步走的**第一步**:先靠 author agent 自己的本事把链路跑通(一句系统合成的意图,它自己去探项目)。把「推断习惯」做**准**(稳定读 `.claude`/`CLAUDE.md`/hooks/git、映射到执行器 tool/门/交付策略、处理「习惯用 Cursor 但本机只装 Claude」)留给第二步 `workflow-from-habits`。

## What Changes

- **导入后自动派工作流(判据门)**:非 `reused` 的导入完成、且该项目的文档分析 agent 跑完(agent 腾出)后,系统 SHALL 走判据:
  - **有 agent 习惯痕迹 且 有能跑的默认 agent** → 无头触发 author agent 以系统合成意图产出一份工作流提案,主动弹给用户预览/采用。
  - **否则**(无痕迹 / 新空项目 / 没设默认 agent) → 直接派**内置默认工作流(本地直合)** 作为该项目的活动工作流。
- **轻量痕迹探测(只做门控,不做抽取)**:主进程新增一个**廉价的存在性探测**——项目各成员仓根目录有没有 `.claude/`、`CLAUDE.md`、`.cursor/`、`AGENTS.md`、`.codex`、`.github/` 等已知痕迹标记。**只判"有没有东西可学",不读内容、不喂给 agent**(深读是 author agent 自己的事)。任一成员仓有标记即算「有习惯」。
- **无头写工作流入口**:把 `runOrchestrateTurn` 里驱动 author 的核心抽成一个**显式 projectId、可后台调用**的变体,接受**系统合成的意图字符串**(非用户打字),产出 `WorkflowProposal`。复用现有 `createOrchestrateSeam` / `buildAuthorWorkflowSkill` / `buildWorkflowProposal`(内含 `repairWorkflow`+两闸校验),不新造产出/校验逻辑。
- **提案主动露出通道**:新增一条 main→renderer 推送,把后台产出的 `WorkflowProposal` 主动送到 UI(比照 `documentsOnboard` 事件),复用现有 `WorkflowPreviewModal` / `WorkflowEditor` 浮层来预览、编辑、保存入库、设为本项目工作流。不要求用户先开聊天面板。
- **默认工作流可被稳定引用**:兜底要派「内置默认(本地直合)」,需要一个**稳定 id** 能指名它(今天三份内置工作流用 `randomUUID()` 种子、无法指名)。本 change 让主默认工作流以**稳定 id** 种子化,供兜底与「否则」支引用。
- **主动露出改为「底栏进度 + 排队不叠加」**:工作流生成为后台异步,进度显示在**底栏状态区**(比照文档扫描的状态呈现);得到可用提案后,若此刻**没有**全局模态在开则弹出预览,若**有**(如文档 onboarding 仍开着)则**排队等待、待其关闭再弹**,不叠加于既有模态之上。全程占位默认工作流保证项目可用、用户不被阻塞。为此引入一个轻量「全局模态协调器」承载排队/顺次弹出。
- **写工作流 skill 补两条正向搭流约束**:`buildAuthorWorkflowSkill` 增两条以**正向、讲原因**措辞的指导(不用负向句、不写过细例子,以免致幻或抑制外推)——(a)**一段有连续状态的工作交给同一个 agent 节点**(据即时反馈逐步收敛的活,靠同一 agent 保持上下文与反馈闭环);(b)**把结果固化下来的步骤排在人来拍板之后**(固化难回退,先经人工验收再固化)。
- **工作流软校验(结构可判反模式,非阻断告警)**:比照 `checkBranchPairing`,新增一层**软校验**——对**结构上可判**的反模式给非阻断告警、经 `WorkflowSummary` 在编辑器/选择器露出,覆盖 agent 生成与**用户手动改乱**两路。首条:存在**不可逆固化**引擎操作(`merge-branch`/`push-branch`/`open-pr`——`archive-docs` 提交到分支、可回退,**不属**固化)而在其**之前或就挂在该固化节点自身上**无任何 `manual` 门时告警。**「红门(期望失败)」结构上不可判**——`auto` 门无「取反」字段、只能藏进命令文本,故不纳入软校验,仅留 prompt 约束。
- **写工作流 skill 补「要人拍板处落成 manual 门」**:实测里 author 把「人工验收」做成了跑 `npm run build` 的**命令节点**,并非真的 `manual` 门。skill SHALL 正向指导:要人拍板/验收处用 `manual` 门(可弹决策、可驳回),而非徒有其名的命令/agent 节点。
- **自动生成的提案留调试日志**:实测反馈——生成结果目前只推给 UI、开发者无从事后查看。产出提案(成功/失败)时记一条含目标项目、工作流定义概览、`issues`/失败原因的日志,便于不靠用户逐节点截图即可复现调试。
- **author 真正读到项目(根因修复)**:实测发现 orchestrate producer 的 `cwd` 是 `userData` scratch、`getProjectRepos` 只给名不给路径,故 author agent **对项目无文件系统访问**——它读不到 `.claude/`/`CLAUDE.md`/`git log`,「照习惯写工作流」全靠 prompt 上下文猜,输出不稳(时而空产出)。修复:**自动 author 那条路给 producer 传项目成员仓路径作 `--add-dir`**(只读探查),并把系统意图改为「你现在可直接查看本项目文件」+ 明确「只读、只输出工作流、别改任何文件」。使「读项目习惯」名副其实。
- **生成失败:重来一次 + 抓原因 + 轻提示**:`authorWorkflow` 当前把 seam 的失败 `reply` 丢了(分不清「agent 调用炸」还是「跑通没产出」)。改:①让失败原因**上浮并记入日志**(区分抛错/空产出/校验不过);②命中 author 支时**自动重试一次**,仍失败才回落默认;③失败/空产出时底栏给**轻提示**(spec 早有「至多轻提示」,此前未实现),不再进度条一闪即无、用户懵。
- **提案改走全局对话(替换孤立浮层,给反馈回路)**:实测发现——孤立预览浮层是**死胡同**:用户只能手动编辑,**没法让 AI 改**(如「把人工验收 manual 门放到合并前」)。改为把自动产出的提案**作为 agent 消息追加进本项目全局对话**(复用聊天里 `WorkflowProposalReview` + 「预览草稿」按钮),生成完**主动打开/聚焦对话面板并选中该会话**(经模态协调器排队、不叠加于文档弹窗)。对话输入框即反馈通道。**替换**原 `workflowProposalPush → 孤立 `WorkflowPreviewModal` 自动弹**这条链(浮层仍作「预览草稿」的落点保留)。需新增一条推送让渲染层重取会话(现无 `conversationChanged` 广播)。
- **「就着挂起草稿改」——编辑基准可取会话里的未存草稿**:现在改写基准**永远取库里活动工作流**;而自动/聊天产出的是**未存库草稿**。补:当会话最后一条 agent 消息带着未存的工作流草稿时,下一轮改写以**该草稿**为基准(注入其完整定义作 prompt 基准、`baseId` 仍留空=整体替换新建),使「加一道验收门」改的是这份草稿、而非活动工作流。此改**同惠**自动提案与聊天手写提案。
- **节点列表显示门徽标(门可见)**:实测——门是「挂在节点上」的,节点列表**不显示**,用户逐个点铅笔才看得到,以致误判「没生成验收」。补:`SortableNodeRow` 给挂了门的节点标**徽标**(区分 manual/auto/external),人工检查点一眼可见。
- **「重大步骤必须人工审批」是硬原则(纠正措辞 + lint 喂回 author)**:实测——author 反复把「验收」做成命令节点、合并前无 `manual` 门;此前误把它当「项目无人值守习惯」背书。**纠正**:不可逆固化(合并/推送/开 PR)前**必须**有人工审批门,是**产品原则**,不因项目「自主」而省。落三处:(a)改掉 `createDefaultWorkflow` 的「无人值守/unattended」措辞,并给内置默认工作流**合并前加一道 `manual` 审批门**(言行一致、自身过 lint);(b)`runWorkflowOnboarding` 里 author 产出后先跑 `lintWorkflow`,若报「固化前缺人工验收」就把该警告 + 上一版定义**喂回 author 修订**(有界重试),改好再投递;(c)`buildAuthorWorkflowSkill` 正向加固「不可逆固化前必有人工审批门」为硬要求。

## Capabilities

### New Capabilities
- `workflow-onboarding`: **导入后自动为项目落定一份工作流**的判据与编排——非 reused 导入 + 文档分析 agent 腾出后触发;判据门(有痕迹 + 有能跑 agent → 自动 author,否则派默认);轻量痕迹存在性探测(多仓任一有标记即算有习惯);系统合成意图无头驱动 author;生成进度进底栏、提案**排队不叠加**地弹出预览;失败/无 agent/无痕迹一律回落默认工作流,绝不让项目卡在「无工作流」。

### Modified Capabilities
- `workflow-authoring`: (a) author 的驱动 SHALL 支持**系统合成意图 + 显式 projectId 的无头调用**;(b) `buildAuthorWorkflowSkill` SHALL 以**正向、讲原因**措辞新增搭流约束(连续作业交同一节点 / 固化排在验收之后 / 要人拍板处落成 `manual` 门);(c) 自动 author SHALL 能读到项目文件(成员仓路径作可访问目录);(d) **改写基准**当会话末条 agent 消息带未存工作流草稿时 SHALL 取**该草稿**(而非活动工作流)。
- `workflow-definition`: SHALL 新增一层**软校验**(非阻断);首条=「不可逆固化操作(不含 `archive-docs`)之前或其上须有 `manual` 门」。`validateWorkflow` 硬校验不变。
- `workflow-onboarding`: 提案主动露出 SHALL 改为**追加进本项目全局对话**(agent 消息)并主动**打开/聚焦对话面板、选中该会话**(经模态协调器排队),而非弹孤立浮层;生成失败 SHALL 重试一次、按种类记因、底栏轻提示。
- `global-agent-chat`: SHALL 承载**自动产出的工作流提案**作为一条 agent 消息(复用 `WorkflowProposalReview`);当会话有未存草稿时,后续改写以草稿为基准。渲染层 SHALL 能被主进程信号驱动**打开面板 + 选中并刷新指定会话**(现无 `conversationChanged` 广播,需补一条推送)。
- `workflow-editor`: 节点列表 `SortableNodeRow` SHALL 对挂了门的节点显示**门徽标**(manual/auto/external),使人工检查点一眼可见。
- `document-registry-ui`(或其主进程分析入口):文档语义分析**完成**时 SHALL 发出可供主进程链接的**完成信号**,作为 `workflow-onboarding` 触发时机。

## Impact

- **依赖 / 复用**:重度复用**已落**的 `workflow-authoring`(`buildAuthorWorkflowSkill`、`repairWorkflow`、`WorkflowProposal`、`WorkflowEditor` 浮层)与 `document-registry`(分析入口作触发时机)。**不**依赖第二步 `workflow-from-habits`——本步用一句直白的系统意图,靠 author agent 自身探项目的能力;推断质量的打磨归第二步。
- **代码**:
  - `src/main/index.ts`:导入处理(`IPC.importProject` / `manageImportProject`)后挂钩;`IPC.documentsAnalyze`(:1168)完成后触发判据;`runOrchestrateTurn`(:1327)抽出 projectId-显式的无头核;新增提案推送通道(比照 `notifyDocumentsOnboard` :1126)。
  - 新增痕迹存在性探测器(纯主进程、廉价 `fs.existsSync` 级)。
  - `src/main/orchestrate-service.ts`:无头调用以系统意图跑 seam(现有 `orchestrate(input, projectId)` 已接受任意 `intent` 字符串,主要是调用侧改造)。
  - `src/main/index.ts` 启动种子(:1730):主默认工作流以稳定 id 种子化,供兜底引用。
  - `src/renderer/src/App.tsx` + 新提案事件订阅 → 经「全局模态协调器」排队,复用 `WorkflowPreviewModal`(`GlobalChatPanel.tsx`)/`globalChat` store 的 `openWorkflowPreview`;生成进度进底栏状态区(比照文档扫描状态呈现)。
  - `src/shared/workflow.ts`:`buildAuthorWorkflowSkill` 补两条正向搭流约束;新增软校验函数(比照 `checkBranchPairing`,产出结构可判反模式告警,首条=固化前须有 `manual` 门),经 `WorkflowSummary` 露出。
- **判据落点**:`reused` 导入(重开已知项目)**跳过**——不覆盖用户已选;判据只在**首次导入**且**文档分析已完成**后跑一次。
- **兼容**:纯增量。既有聊天里手动写工作流的路径不动;既有导入路径行为除「导入后现在会落一份工作流(默认或提案)」外不变。用户始终可在预览里改或弃,采用是**人确认**(遵全局 agent「只提案、人确认才落库/激活」红线)。
- **不在本 change**:推断习惯的质量打磨、痕迹→执行器/门/交付策略的映射准确度、「习惯用 Cursor 但本机只装 Claude」的调和(全归第二步 `workflow-from-habits`);多仓各仓习惯不一致时的细粒度处理(第二步);把「写工作流」做成用户 CLI 里按名引用的独立安装技能(见记忆 `install-klarit-skills-into-cli`,更后)。
