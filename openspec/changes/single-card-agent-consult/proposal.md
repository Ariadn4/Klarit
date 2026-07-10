## Why

三层 agent 里全局（编排）与后台执行都已归档，单需求 agent 只切过一薄片——gate-reject 里那个「只读回退判定 agent」（一次性吐个决策、无对话）。`docs/project-goals.md` 给单需求 agent 的定位是**每张需求卡一个常驻只读 agent**：用户能跟它查进度、干预本卡任务（暂停/倒回/注入指令）、讨论需求；凡「塑造需求」的意图上抛全局编排。它自己**绝不写代码、不亲自执行**，一切干预经引擎中转、编排经 `orchestrate` 中转。全局编排（`orchestrate`/`applyOps`/会话基建）明确「留了别处上抛的接线不在本 change」——本 change 就来把这薄片长成完整咨询层、并补上这条上抛接线。

## What Changes

- **每卡一个只读单需求 agent（咨询核）**：一张需求卡一个常驻 agent、**不可多开**、scope 只这张卡。它是**自由对话助手**（镜像全局 agent 的「单 agent 会话核·技能内联」）：回复永远第一位、纯咨询是有效轮次；识别到意图才产结构化输出。一轮输出三岔——① 只读作答（查进度）；② 本卡干预提议；③ 上抛信号（塑造需求）。它**只读、绝不亲自执行**（readOnly prompt、不跑越界检测、不每节点提交），唯一「作用」= 经引擎/store 的干预与上抛编排。
- **① 查进度**：agent 读**卡活现状 + 运行断点**（当前节点/阶段/最远进展/门进度）+ **产物溯源**（`deriveLineage`）+ **各涉及仓分支 diff**（`git diff base..branch`，预算截断）作答。
- **② 本卡执行干预（经引擎、破坏性须人确认）**：agent 只**提议**，引擎/store 执行——
  - 暂停/恢复（无损、直接）：复用 `engine.pause`/`resume`；
  - 倒回到指定节点 K（可带注入指令，破坏性·须确认）：新 `engine.reenter(runId, K, 指令)`，复用 gate-reject 的**内容回退=重入不重置**（`reenterFromRollback`）；
  - 就地向当前执行节点注入新指令（须确认）：新 `engine.inject(runId, 指令)`，设当前节点 `pendingAnswer` + 重跑 executing；
  - （可选）改任务资料（卡字段）：复用 `cardsUpdate`。
  - **干预一张真在跑的卡**：先复用 `pause` 的安全挂起（阶段边界落 paused）再变更断点再 drive；已 parked/暂停则直接改。
- **③ 讨论 → 分两路收束**：多轮对话（原生续接）；意图属【本卡怎么执行】→ 收束为上面②的干预；意图属【塑造需求：新增/扩范围/牵动别卡/新建】→ **上抛全局**：转调 `orchestrate(intent, projectId)` → ops 提案在卡对话内呈现 → 复用 `applyOps` 审阅确认应用。单卡**不裁决落哪张卡**（无全盘视野），交全局；上抛轮 = 2 次 agent 调用（单卡分类 + 全局编排）。**歧义倾向上抛**（全局裁决「其实属本卡/该新建」）。
- **④ 门自由输入上抛接线**：人工评审门/失败决策的自由输入里冒出的「塑造需求」意图，同样识别→上抛 `orchestrate`。在**既有自由输入路由前加一道单卡 agent 分类**——只把「塑造需求」那一小撮引流到 orchestrate（**不消费该门**、ops 提案出在卡对话、门仍 pending 待用户 pass/真驳回）；**其余原样直下**现有路径（人工评审门→回退判定、失败决策→处置 agent，不改动）。此处分类**偏置与卡对话相反**：门语境默认「你在评审本卡产出」，故**歧义→留在本地（当驳回）**，只有明确塑造需求才引流。
- **每卡会话持久化**：复用 `conversation-store`（另起 `card-conversations` 桶、scope=projectId、**id 恒 = cardId**）→ 一卡一个、无「新建对话」、不污染全局对话列表；多轮经原生续接接上。
- **卡详情面板咨询区**：卡详情面板新增单需求 agent **咨询/对话区**，与既有「单卡决策区」并列，复用全局对话面板的消息列表/输入/复制/ops 审阅组件与决策面板 patterns。

**红线**：只读、绝不亲自执行；一卡一个、不可多开、scope 只这张卡（要全盘=上抛全局，不在单卡内自己看别卡）；干预/编排都**经中转**（引擎 or orchestrate），不直连别的 agent；破坏性（倒回/注入/应用结构 op）**须人确认**。

**Non-Goals**：AI 托管（自动代替决策/自动应用）；全局 agent 干预运行中后台 agent（另一块能力）；subworkflow；重模型回退；单卡 agent 读代码做深度分析（读上下文=活现状+断点+溯源+分支 diff）。

## Capabilities

### New Capabilities
- `single-card-agent`: 单需求 agent 咨询核——每卡一个、只读、scope 单卡；自由对话·技能内联的**三岔分类**（查进度/本卡干预/上抛塑造需求）、**读上下文装配**（卡活现状 + 运行断点 + 产物溯源 + 各仓分支 diff，预算截断）、**注入式只读 producer**（真=脱 worktree 只读续接 runner，测试=假单卡 agent）、**每卡会话**（复用 conversation-store、id=cardId 保证不可多开）、干预提议 op schema、上抛 `orchestrate` 接线（含门自由输入分类前置的偏置规则）。

### Modified Capabilities
- `engine-execution`: 新增**用户可发起的本卡干预入口** `reenter(runId, targetNodeId, 指令)`（复用 `reenterFromRollback` 重入不重置）与 `inject(runId, 指令)`（当前执行节点 pendingAnswer 注入 + 重跑）；干预一张**活跑**的运行时 MUST 先安全挂起（复用 pause 的阶段边界落 paused）再变更断点再 drive。
- `content-driven-rollback`: 回退重入从「仅回退确认决策可达」扩为**亦可被单卡 agent 干预直接发起**；**门自由输入分类前置**——人工评审门/失败决策的自由输入先经单卡 agent 分类，「塑造需求」引流 `orchestrate`（不消费该门），其余原样直下既有回退判定/处置路径（偏置：门语境歧义→当驳回）。
- `requirement-card-detail`: 卡详情面板新增**单需求 agent 咨询区**（多轮对话、查进度作答、本卡干预提议与破坏性确认、上抛 ops 提案审阅），与既有单卡决策区并列；遵 `docs/brand` 语义令牌、深浅双主题。

## Impact

- **主进程**：新增单卡 agent 咨询服务（三岔分类核 + 读上下文装配 + 只读注入式 producer）；复用 `agent/runner.ts`+`continuation.ts`（脱 worktree、只读姿态）；engine 新增 `reenter`/`inject` 方法与干预前安全挂起；`decide`/门自由输入前置分类接线；复用 `conversation-store`（新桶 card-conversations）。
- **IPC/preload**：新增单卡 agent 对话（每卡会话 CRUD、发消息/续接、干预提议应用）、`engineReenter`/`engineInject`、门自由输入分类通道。
- **渲染层**：卡详情面板咨询区（对话 + 查进度 + 干预确认 + ops 提案审阅），复用全局对话面板与决策面板组件；语义令牌、深浅双主题、i18n。
- **共享类型**：新增单卡 agent 一轮输出（reply / interventions[] / upshift）、干预 op 联合、每卡会话形态复用 `Conversation`。
- **不影响**：现有 gate-reject「驳回→回退判定」与失败「处置 agent」路径原样保留（分类只引流塑造需求那一小撮）；全局对话入口不变；不碰 git/代码写入；不触及运行中后台 agent。
