## Why

用户写需求时往往一口气描述一大段、夹着好几个点子，而 Klarit 的核心承诺是「你只描述要什么，它接管从需求到交付」。今天没有任何入口能把这一大段拆成可审阅的多张需求卡——既缺承载卡片的数据模型，也缺一个可被编排、可被全局 agent / 外部 AI 直接调用的「分解需求」能力与配套交互。本 change 补上这条最关键的入口：描述想法 → 全局 agent 分解成多张候选需求卡 → 人审，**止于点击「创建任务」**；创建之后的落库/建分支等下游工作交给下一个 change。

## What Changes

- **每个工作流可编辑其「新建需求」分解 prompt**：在工作流定义上新增一个可选的「新建需求」驱动指令，沿用 agent 节点 prompt 的 `inline`/`file`（skill 文件）两态，存于工作流包内，在工作流编辑器里以「手写 / 导入」编辑——与节点 prompt 的导入完全一致。
- **「分解需求」能力**：接收一大段自由描述 + 生效的分解 prompt，由全局 agent 产出一组**候选需求卡**，每张含：标题、描述（markdown）、分类（`epic`/`feature`/`bug` 三选一）、卡关系（按 `docs/project-goals.md`「需求卡与关系图」的带类型边）、**预取名**（git 友好 slug，可作卡 id 与分支名）。prompt 解析顺序：当前项目激活工作流的「新建需求」prompt → 全局默认分解 skill 兜底。经 IPC 暴露。
- **分解 skill 成为可移植 / 可被 AI 调用的工件**：定义 skill 文件格式与一份**全局默认分解 skill**（存 userData、可手写/导入，导入体验与工作流节点 prompt 一致），使分解既能被「新建需求」入口触发，也能被全局 agent 或外部 AI（如 Claude Code）直接读取并执行。
- **最小需求卡数据模型**：新增一个最小但前向兼容的卡片模型——预取名（=id，git 分支友好）、标题、描述（markdown）、分类、卡关系（对齐「需求卡与关系图」的 `parent/child`、`blocked_by/blocks`、`coupled_with` 边），及持久化形态的系统字段占位（生命周期状态默认「未开始」、时间戳）。**本 change 只定义模型与校验，不做持久化/存储/落库**（落库归下一个 change）。
- **分解交互（三窗 + 底栏态）**：
  - **描述想法窗**：附件区（Ctrl+V 粘贴截图、拖入文件插入其路径）+ 多行描述（可一次写多条）+ 取消/提交；**无蒙层**；AI 处理时窗口隐藏。
  - **底栏「建卡中」态**：处理期收在底栏显示「建卡中」；此时再点「新建需求」重新弹出该窗并提示「正在处理需求」。
  - **审阅候选任务窗**：列出每张候选卡的分类徽章 + 标题 + 描述（markdown 渲染，非源码）；点击某卡弹出任务详情看细节；**仅允许改标题与描述**，其它字段只读；取消/创建任务。
- **接入全局 agent（真调 AI）**：全局 agent 作为「新建需求」产出者——**无头调用用户配置的默认 agent CLI**（`claude -p` 等，prompt 走 stdin、复用用户订阅、不自建模型通道）跑分解 skill 并解析候选卡；只读、挂当前项目；也可被外部 AI 经同一契约推入候选。未配置 agent / 调用失败 → 优雅空态。全局 agent 对话 UI 与写代码的 PTY 交互式后台执行 agent 运行时不在范围。

## Capabilities

### New Capabilities
- `requirement-card-model`: 最小需求卡数据模型与校验——预取名(=id/分支名)、标题、描述(markdown)、分类(epic/feature/bug)、卡关系(对齐「需求卡与关系图」)及持久化形态系统字段占位；**不含持久化/CRUD**（归下一个 change）。
- `requirement-decomposition`: 把一大段自由描述按生效 prompt 由全局 agent 分解成多张候选需求卡的能力——分解输入、候选卡输出契约、prompt 解析顺序、全局默认分解 skill 的手写/导入，及 IPC 暴露；止于产出候选卡。
- `decompose-ui`: 分解交互的三个面——描述想法窗（附件/粘贴/拖拽、无蒙层、处理时隐藏）、底栏「建卡中」态与重弹、审阅候选任务窗（分类徽章+标题+markdown 描述、详情、仅改标题与描述）。
- `global-agent`: 全局 agent 作为「新建需求」产出者的最小接缝——只读、挂当前项目、可被外部 AI 经同一契约调用；产出候选卡，创建/落库归下一个 change。

### Modified Capabilities
- `workflow-definition`: 工作流定义新增可选的「新建需求」驱动指令字段（沿用 `AgentInstruction` 的 inline/file 两态），并纳入结构校验与读写往返。
- `workflow-editor`: 工作流编辑器新增对该「新建需求」prompt 的编辑（手写 / 导入 skill 文件，复用既有包内文件管理控件）。

## Impact

- **数据模型 / 类型**：`src/shared/types.ts` 新增需求卡类型、候选卡/分解输入与结果类型、`WorkflowDefinition.newRequirementInstruction?`；`KlaritApi` 新增分解相关方法。
- **共享逻辑**：`src/shared/workflow.ts` 新建需求指令校验；新增 `requirement-card`、`decomposition` 纯校验逻辑（可单测）。
- **主进程**：新增全局默认分解 skill 存储（仿 workflow 包内 skill 管理）、prompt 解析；`src/main/index.ts` 新增 IPC。
- **IPC / preload**：`src/shared/ipc.ts`、`src/preload/index.ts` 新增通道。
- **渲染层**：`WorkflowEditor.tsx` 新增新建需求 prompt 编辑；新增「新建需求」最小入口、描述想法窗、底栏「建卡中」态、审阅候选任务窗（遵循 `docs/brand` 与 `index.css` 设计令牌、深浅双主题、仅用语义令牌；这三处按需求**不加蒙层**）。
- **不在本 change（归下一个 change）**：点「创建任务」之后的卡片落库/持久化与 CRUD、建分支/开 worktree、启动工作流、需求看板与卡片详情面板的完整呈现、关系图的编辑维护、PTY 后端 agent 运行时与全局 agent 对话 UI。
