## Context

Klarit 的核心入口「写需求」目前在代码里是空的：需求卡、全局 agent、对话 UI、PTY 后端 agent 运行时都还没实现（仅在 `docs/project-goals.md` 有设计意图，其中「需求卡与关系图」已定卡分类 `epic`/`feature`/`bug` 与带类型边 `parent`/`child`、`blocked_by`/`blocks`、`coupled_with`）。已成熟的是工作流定义/编辑/库与规则包层。可直接复用的基建：

- **`AgentInstruction`**（`src/shared/types.ts:233`）`{kind:'inline',text} | {kind:'file',path}`——节点 prompt 的两态，校验在 `validateInstruction`（`src/shared/workflow.ts:47`）。
- **工作流包内 skill 文件管理**（`src/main/workflow-store.ts`）`writeSkillFile`/`importSkillFile`/`readSkillFile`，含越界守卫；UI 控件 `PackageFileField`（`WorkflowEditor.tsx:162`）的「新建/导入/查看」。
- **userData 持久化 + IPC 三件套**：`ipc.ts → main/index.ts handlers → types.ts KlaritApi` 契约三联。
- **项目与激活工作流**：`Project.activeWorkflowId`，`getActiveWorkflow`/`setActiveWorkflow`。
- **纯逻辑共享层**：`src/shared/workflow.ts` 无 fs、主/渲染共享、可单测——卡模型与分解校验照此定位。

范围已与用户确认并收缩：**建最小卡片模型（仅模型+校验，不落库）**、**开始接入全局 agent（只到产出候选卡）**、**三窗交互**；点「创建任务」之后的落库/建分支等**归下一个 change**。

约束：测试先行（针对公共 API 先红后绿）；UI 仅用语义令牌、深浅双主题、遵循 `docs/brand`；中文文档用大白话。

## Goals / Non-Goals

**Goals:**
- 工作流可编辑其「新建需求」分解 prompt（inline/file，体验同节点 prompt 导入）。
- 一段自由描述 → 全局 agent 产出候选需求卡 → 描述想法窗/底栏态/审阅窗的完整可调用链路，止于点「创建任务」。
- 分解逻辑成为可手写/导入、可被全局 agent 与外部 AI 复用的 skill。
- 最小但前向兼容的需求卡模型，对齐「需求卡与关系图」：预取名(=id/分支名)、标题、描述(markdown)、分类、带类型关系边。

**Non-Goals（归下一个 change 或更后）：**
- 候选卡落库/持久化/CRUD、建分支/开 worktree、启动工作流（点「创建任务」之后的一切）。
- 全局 agent 对话 UI、PTY 交互式后台执行 agent 运行时（写代码那层）。**分解本身已真接 AI**——无头调用用户配置的 agent CLI（见 D5）。
- 需求看板/卡片详情面板的完整呈现、关系图的可视化编辑与维护、运行断点等执行期状态。

## Decisions

### D1：需求卡模型——对齐「需求卡与关系图」，仅模型+校验
卡类型 `RequirementCard` 与候选 `CandidateCard` 置于 `src/shared/types.ts`；纯校验 `validateCandidateCard`/`validateRequirementCard` 与 slug 工具 `toProposedName(text)` 置于新建的 `src/shared/requirement-card.ts`（无 fs、主/渲染共享、可单测）。字段对齐 project-goals：`category: 'epic'|'feature'|'bug'`、`relations: { kind:'parent'|'child'|'blocked_by'|'blocks'|'coupled_with', target }[]`、`proposedName`（git 友好 slug，作 id 与分支名）。持久化形态另带 `status`（默认 `未开始`）与时间戳，但**本 change 不写存储**。
- *为何*：project-goals 已是关系/分类的单一来源，直接对齐避免二套词表；预取名一物两用（id+分支名）满足用户诉求；纯校验在渲染层审阅期即可用，落库期复用同一套。
- *备选*：另立一套分类/关系枚举——否决，与 project-goals 漂移。把 livingState/运行断点也建进来——否决，执行引擎未落地、易过时。

### D2：不在本 change 落库——候选卡为内存中间产物
分解产出**候选卡**（含 `proposedName` 作未来 id），经审阅窗人审后点「创建任务」即把候选交给一个**创建接缝**（`global-agent`），接缝在本 change 仅是交接点——真正写存储/建分支归下一个 change。故本 change **不引入 requirement-card-store / 卡片 CRUD IPC**。
- *为何*：用户明确「点创建任务之后的工作下一个 change 再接」。把落库切出可让本 change 聚焦「描述→分解→审阅」体验，且候选卡天然是未落库中间态。
- *备选*：本 change 顺手落库——否决，越界用户划定的范围、且会牵出建分支等下游。

### D3：工作流「新建需求」指令——复用 AgentInstruction，存包内 skill
`WorkflowDefinition` 增可选 `newRequirementInstruction?: AgentInstruction`。校验在 `validateWorkflow` 里仅当声明时复用 `validateInstruction`。file 形态用既有工作流包 `skills/` 与 `writeSkillFile`/`importSkillFile`/`readSkillFile`——零新增存储面；编辑 UI 复用 `PackageFileField`。
- *为何*：用户要「跟节点 prompt 导入一致」；复用同类型、同校验、同控件最小且一致。

### D4：分解 prompt 解析顺序——激活工作流 → 全局默认 skill 兜底
生效 prompt = `当前项目激活工作流.newRequirementInstruction`（有则用，file 形态读包内 skill）→ 否则**全局默认分解 skill**。全局默认 skill 存 `userData/skills/decompose-default.md`，由新建的 `src/main/global-skill-store.ts`（write/import/read/seedIfMissing）管理，导入约束与节点 prompt 一致。内置默认 skill 文本写明候选卡 JSON schema。
- *为何*：用户要「无工作流上下文（直接跟全局 agent 聊）也能分解」；两级解析 + 兜底 skill 满足之。
- *备选*：默认 prompt 硬编码——否决，用户要可手写/导入覆盖。

### D5：分解的「执行」——无头调用用户配置的 agent CLI（真接 AI）
对齐「复用用户的编程 AI、不自建模型通道」：producer（`src/main/agent-runner.ts`）取 `settings.defaultAgent`/`defaultModel`，按 agent 映射出无头调用（`claude -p` / `codex exec -` / `cursor-agent -p`，prompt 经 **stdin** 喂入、stdout 取回复），把「生效分解 skill + 用户描述 + 只输出 JSON 收尾」发过去，再用 `parseCandidateCards` 容错解析回复里的候选卡 JSON（去围栏、抠最外层数组、逐条收敛分类/预取名/关系）。`runDecompose` 随后 normalize（去重）+ validate。失败/超时/未配置 agent → 优雅返空（审阅显空态）。
- *为何*：用户明确要求「接 AI」。无头 `child_process`（非交互 `-p`/`exec`）即可真跑分解，无需先落地完整 PTY 交互运行时（那是写代码的后台执行 agent 那层，仍属 Non-Goal）。skill 文件是「怎么分解 + 输出什么结构」的单一来源；按钮路径（真 AI）与外部 AI `submitDecomposedCandidates` 路径共用同一 skill 与同一候选卡校验。
- *备选*：直连 Anthropic API——否决，违背「复用用户订阅、不自建模型通道」。先做占位 stub——已否决（用户要求真接）。

### D6：三窗交互——无蒙层的可最小化浮窗 + 底栏处理态
描述想法窗与审阅候选任务窗按用户要求**不加蒙层**——它们是**可最小化的浮动窗**（带 — / ×），不是阻断式模态：提交后描述想法窗隐藏、底栏出现「建卡中」处理态，处理中再点「新建需求」重弹并显示「正在处理需求」，完成后自动弹审阅窗。审阅窗逐张展示分类徽章+标题+markdown 描述，点卡进详情，**仅标题与描述可改**。三窗均为新组件，仅用语义令牌、深浅双主题。项目此前无 markdown 渲染能力（文件查看器用 Monaco 显源码），故新增 `react-markdown` 依赖渲染候选描述。
- *为何*：用户明确无蒙层、处理时隐藏到底栏、再点重弹的交互；浮窗+底栏态贴合「建卡中」可并行等待的语义。
- *备选*：用带 scrim 的阻断模态——否决，违背用户要求且阻断「等待时继续看界面」。

### D7：UI 入口——临时最小落点
「新建需求」入口先放一个临时最小落点接通链路，正式位置随需求看板 change 再定（用户：「先随便找个地方」）。

## Risks / Trade-offs

- **[无蒙层偏离品牌模态惯例]** CLAUDE.md 约定模态 scrim 用 `bg-black/50`；本 change 三窗按用户明确要求**不加蒙层** → 缓解：把它们实现为**可最小化浮窗**而非阻断模态（语义不同，无需 scrim），并在 PR 注明此为用户指定的有意偏离；若品牌规范需补「浮窗无蒙层」一类，按 CLAUDE.md 向用户申请补规范。
- **[候选卡 schema 与 skill 约定漂移]** skill 描述的输出结构与候选卡校验不符会导致产出无法审阅 → 缓解：候选卡 schema 定义在 `shared`（单一来源），内置默认 skill 文本显式写明该 schema，产出即过校验、不合者带原因供人审提示。
- **[最小卡片模型日后扩展]** 运行断点/活现状/溯源 SHA 日后要加 → 缓解：D1 用可选字段 + 时间戳，新增为非破坏增量；预取名作 id 已为下一个 change 的落库/建分支备好稳定键。
- **[分解依赖用户已装并登录 agent CLI]** 没配置/没装/没登录默认 agent 时入口产不出候选 → 缓解：producer 调用失败/超时/未配置一律优雅返空（审阅显空态，文案引导去配置）；契约、审阅窗、候选卡校验均可独立测试；外部 AI `submitDecomposedCandidates` 路径作并行入口。agent 回复非严格 JSON 时由 `parseCandidateCards` 容错（去围栏、抠最外层数组、逐条收敛）。
- **[落库切给下一个 change 的衔接]** 本 change 止于交出候选 → 缓解：候选卡即未来卡的 agent 字段全集 + 预取名(=id)，下一个 change 拿到即可落库/建分支，接缝（`global-agent`）已定。

## Migration Plan

- 纯增量：新增类型（`WorkflowDefinition.newRequirementInstruction?` 可选、卡/候选类型）、新增 global-skill-store 与分解 IPC、新增三窗 UI，**无破坏既有数据**。旧工作流包无该字段即「未声明」，分解回落全局默认 skill。
- 全局默认分解 skill 首次使用时惰性 `seedIfMissing`，无需迁移脚本。
- 回滚：移除新增 IPC/类型字段/组件即可；既有工作流与项目数据不受影响（新字段可选）。

## Open Questions

- 候选卡 JSON schema 的精确字段命名留待 tasks 落地定稿；倾向候选关系边用 `proposedName` 互相引用（候选阶段即有稳定 slug，无需临时序号）。
- 描述想法窗「附件」的承载方式（粘贴截图存何处、是否随分解上传）本 change 以最小可用为准（截图入内存/临时态、路径文本插入描述），正式附件存储随卡片落库 change 再定。
- 「新建需求」入口正式落点、审阅窗「任务详情」是复用未来卡片详情面板还是临时内联，留待需求看板 change。
