## Context

现有全局 agent 是「新建需求」的最小接缝（`src/main/global-agent.ts` 的 `createDecomposeSeam`）：注入式 `CandidateProducer = (prompt, input) => Promise<CandidateCard[]>`，只 `create`、只看一段自由文本 `input.description`、无全盘视野、单次产出、止于候选（不落库）。真实 producer 是 `decomposeProducer`（`agent-runner.ts` 的一次性无头 `runAgentHeadless`）。审阅→落库走 `useNewRequirementStore.createTasks → cards:create → cardStore.create`。

已有基建可复用：
- **卡库** `card-store.ts`：`create`/`update`/`remove`，关系**双向落地**（`INVERSE` 表）、删卡清悬挂边；无 split/merge、无单边增删原语。
- **卡模型**（`shared/requirement-card.ts` + `shared/types.ts`）：`CandidateCard`/`StoredCard`（proposedName=id/分支、title、description(md)、typeId、relations[]、status、repos[]、activeRunId?）。**尚无 liveState 字段、无会话持久化**。
- **流式续接 runner**（`src/main/agent/runner.ts` + `continuation.ts` + `adapter.ts`）：为引擎后台执行 agent 设计，绑 worktree，已有 `--resume <sessionId>` 续接阶梯、session 捕获（`onSession`）、流式 `displayFromStreamLine`、历史落盘（`historyPath`）。
- **看板列定位**（`requirement-kanban-board`）：leaf 未开始/无运行 → 待办列；container 恒在待办列；其余按运行断点当前节点落阶段列。这是「破坏性收边」的判定依据。

约束：测试先行（用**假全局 agent** 注入固定 ops，同 decompose/heal 假 adapter 模式）；只读代码绝不写；卡操作只提案、人确认、cardStore 应用；全盘限本项目；UI 遵 `docs/brand` 语义令牌、深浅双主题。

## Goals / Non-Goals

**Goals:**
- 把 decompose 缝扩成完整编排核 `orchestrate(intent, projectId, conversationId?) → OrchestrationProposal`，产出成套卡操作（create/adjust/split/merge/relate）。
- 全盘视野装配（所有卡活现状摘要 + 关系图 + 目标/生效宪法 + token 预算与显式截断）。
- 全局对话面板（**无需绑定项目即可打开**、多开、会话**按项目分开**持久化 userData（未绑定用独立作用域）、多轮续接）。
- 意图落位：当前项目直接编排；**新项目意图 → 提议新建项目（选目录 `importProject`）+ 种入 create ops**。
- 审阅→apply-ops（ops diff 预览、逐 op 校验、破坏性二次确认、`applyOps` 派发到 cardStore），decompose 落库收敛为其特例。
- cardStore 补 `addRelation`/`removeRelation`/`splitCard`/`mergeCards`（纯管理态、待办门控、不碰 git）。

**Non-Goals:**
- **跨项目路由**：agent 只看当前项目、绝不引用/操作别的已有项目——在当前项目的对话里谈另一个已有项目，不支持（只能编排当前项目或提议新建项目）。
- AI 托管（自动代替用户决策、自动应用 ops、无人确认）。
- 别处（单卡对话/门自由输入）自动升级到全局的**接线**（本 change 只建能力 + 全局自身入口 + 可调用接口）。
- 单需求 agent、全局 agent 干预运行中后台 agent、subworkflow。
- 全局 agent 读代码文件做深度分析（v1 上下文=卡摘要+关系+目标，读代码留后续）。
- 跑过卡的 split/merge 分支/产物重分配（被破坏性收边规则排除）。

## Decisions

### 决策 1：全局 agent 复用流式续接 runner，脱 worktree、只读姿态

**选择**：全局 agent 用 `src/main/agent/runner.ts` + `continuation.ts` 驱动（而非扩 `agent-runner.ts` 一次性无头），cwd 给项目主仓（只读）或 scratch 目录、不开 worktree。

**理由**：流式那套已具备聊天要的三件事——按行流式展示（`displayFromStreamLine`）、session 捕获（`onSession`）、`--resume` 续接阶梯。一次性无头（decompose 在用）三者皆无。单一来源「怎么多轮驱动一个 agent」。

**只读落实**：全局 agent 产物是**结构化卡操作 JSON**，我们只消费它、**永不落它写的文件**。收窄工具（如 claude `--allowedTools` 限只读工具）+ prompt 红线 + 忽略文件写，三重兜底。`decompose` 保留用一次性无头不变（它本就单次、无需续接）。

**权衡**：runner 原为引擎 worktree 场景设计，全局用要传非 worktree cwd 且不启用越界检测/写范围——通过不经引擎、直接调 runner 规避。

**替代**：扩 `agent-runner.ts` 加 session/流式——等于把续接阶梯重造一遍，弃。

### 决策 2：编排核镜像 decompose 缝的注入模式

**选择**：`orchestrate` 核注入 `OpsProducer = (prompt, ctx) => Promise<CardOp[]>`（`ctx` 含 intent + boardContext + 会话历史），同 `CandidateProducer` 的形态。真实现调流式 runner + 解析 ops JSON；测试注入**假全局 agent**返固定 ops。

**理由**：满足「测试先行 + 假注入、不依赖真 CLI」；与现有 decompose/heal 假 adapter 一致；board-context 在核内装配（外部调用者没有 board），保证单一来源、可测。

**接口形态**：`orchestrate(intent, projectId, conversationId?)` 内部 `buildBoardContext(deps)`（注入 cards/relations/goals/constitution provider）→ 拼 prompt → `produce` → `normalizeOps` → `validateOps` → `OrchestrationProposal{ops, issues, reply}`。

### 决策 3：CardOp 判别联合 + 破坏性收边在校验层强制

**选择**：`CardOp` 为判别联合 `{ kind: 'create'|'adjust'|'split'|'merge'|'relate', ... }`。破坏性收边（结构 op 只作用待办卡）在**装配 prompt 指令**（喂 agent）+ **apply 前校验**（`validateOps`，越界 op 标非法）**双处**落实——prompt 引导 + 校验兜底。

```
CardOp =
  | { kind:'create', card: CandidateCard }
  | { kind:'adjust', target: id, patch: {title?,description?,typeId?} }   // 不含 proposedName/status/run
  | { kind:'split',  source: id, into: CandidateCard[], edgeInherit?: ... }
  | { kind:'merge',  sources: id[], into: id | CandidateCard, mergedDescription?: string }
  | { kind:'relate', op:'add'|'remove', from: id, edge: CardRelation }
```

**待办判定**：复用看板列定位逻辑——`leaf && (status==='未开始' || !activeRunId)` 或 `archetype==='container'` ⇒ 待办、可结构操作；否则越界。判定函数抽到 `shared` 供 board-context 标注与 `validateOps` 共用（单一来源）。

**理由**：agent 可能忽略 prompt 约束，校验层是硬护栏；判定单源避免两处漂移。

### 决策 4：审阅→apply-ops 泛化，decompose 收敛为特例

**选择**：`DecomposeResult{candidates, issues}` 之上新增 `OrchestrationProposal{ops, issues, reply?}`；落库从 `cards:create` 泛化为 `applyOps(ops)` 派发器。decompose「描述想法」的 create 落库改走 `applyOps`（全 create 特例）——`cardStore.create` 逻辑复用，不重造。

**apply 派发**：
```
applyOps(ops) → for each op:
  create → cardStore.create([card])
  adjust → cardStore.update(target, patch)
  relate → cardStore.addRelation/removeRelation
  split  → cardStore.splitCard(source, into, edgeInherit)
  merge  → cardStore.mergeCards(sources, into, mergedDescription)
返回 {applied, issues}
```

**理由**：单一落库逻辑（`requirement-card-store` 已有「统一收口」精神，本 change 扩到三条路）；decompose 用户可见行为不变。

**权衡**：`NewRequirementFlow` 内部落库调用点改指 applyOps，但审阅 UI（候选卡编辑）暂可不变——create 特例的审阅仍是候选卡列表；编排的 ops 审阅是新 UI（可共用底层组件）。

### 决策 5：cardStore split/merge 只碰纯管理态、原子回报

**选择**：`splitCard`/`mergeCards` 在 store 层实现为**读参与卡→校验待办门控→构造新态→原子写**，全程维护 `INVERSE` 双向边、邻居反向边重指；任一参与卡越界即整体拒绝、不部分落。**绝不碰 git/分支/worktree**（被收边规则保证参与卡未跑）。

**边再分配**：split 默认所有子卡继承源外部边（保守），载荷可带 `edgeInherit` 覆盖，用户审阅可裁；merge 参与卡边并集重指目标、丢并集内部边、去重。

**理由**：破坏性收边把「跑过卡」挡在门外，store 层只需处理纯管理态，语义可控可测。

### 决策 6：会话持久化 + 多开

**选择**：会话存 `userData/conversations/<projectId>/<conversationId>.json`（或 jsonl）：有序消息历史 + 最近 agent sessionId。UI 支持多条会话（dockview 多面板/标签），各持独立 `conversationId`。多轮经 `launchContinuation` 阶梯（原生 `--resume` 优先，失败回落历史重建）。

**理由**：对齐 project-goals「暂停即安全挂起：存活现状 + 会话历史」「可多开」「云同步只同步 userData」。

**权衡**：多开 UI 是本 change 较重的一块；会话存储走独立 store（`conversation-store.ts`）注入式、可内存后端测试，同 card-store 双后端模式。

### 决策 7：全局对话永远可用 + 新项目落位（不做跨项目路由）

**背景**：用户把「全局对话」当作单一、随时可开的入口，不预设「当前在哪个项目」，会混着提当前项目需求与「要做个新东西」的新项目需求，且不会为发起 agent 专门开一个空项目窗口。

**选择**：
- **面板永远可开、agent 永远可起**——去掉「未绑定项目就不开」的门控。
- **会话按项目分开**（修订）：会话归属其所在窗口当前绑定的项目（`conversation-store` 作用域 = `currentProjectId`，未绑定用 `__unbound__`）。不同项目窗口各看各的会话、不串；新项目/无既有会话时打开即开新对话。（初版曾做「应用级全局」，实测跨项目串会话、体验不对，改回按项目分。）
- **全盘视野仍限当前项目**：`buildBoardContext` 只喂当前窗口绑定的那个项目的卡；agent **永不看别的项目**——这天然堵死「在 A 的对话里操作 B」（它根本看不到 B），无需额外跨项目守卫。
- **新项目落位（Option A）**：编排 prompt 让 agent 判断意图属**当前项目**还是**新项目**。属新项目（或当前未绑定项目）时，产出 `OrchestrationProposal.suggestedProject { name, description?, workflowId? }` + 一批 `create` ops。审阅 UI 对 `suggestedProject` 渲染「创建项目并加入这些需求」：用户**选一个目录** → 复用 `importProject` → **激活 agent 选定的工作流**（`setActiveWorkflow` + `seedProjectCardTypes` 播种该工作流的建议类型）→ 随即 `applyOps(create ops)` 种入新项目 → 刷新看板。
- **新项目的类型来自其工作流**：新项目该用哪套卡类型，取决于**它激活的工作流**（工作流的 `suggestedTypes` + 默认 epic/feature/bug）。所以 agent 为新项目**挑一个工作流**（从可选工作流清单里选 `workflowId`），并用**该工作流的类型 id** 给卡设 `typeId`；编排对新项目 ops 的校验也用**该工作流的类型集**（不是当前项目的、也不是硬套默认）。这修好了「在 A 项目里建新项目、卡类型对不上被误删」的架构 bug。

**理由**：卡必须归属某个项目（看板/分支挂项目上），所以「新项目需求」绕不开一个磁盘目录——半自动（agent 提议 + 用户点目录 + 自动种卡）是既尊重数据本质、又贴合用户心智的最小落地。跨项目自动路由（把需求投到正确的另一个已有项目）更重、且违反「不跨项目引用」的用户约束，留后续。

**替代**：① 维持「限本项目、未绑定空态」——与用户心智冲突，弃。② agent 全权自动建项目（连目录都自选）——OS 层建不出用户想要的仓位置，且属 AI 托管范畴，弃。

**数据/接口增量**：`OrchestrationProposal.suggestedProject?`；会话存储去 projectId 作用域（全局桶）；新 IPC `orchestrateCreateProject(proposal)`（选目录 → importProject → applyOps 种卡）。

### 决策 8：对话按会话选 agent/模型（覆盖全局默认）

**背景**：用户希望在全局对话里直接调整用哪个 agent/模型，而不是只能受全局默认（`settings.defaultAgent`/`defaultModel`）摆布——不同对话可能想用不同模型。

**选择**：在 `Conversation` 上持久化可选 `agentId?` / `model?`（按会话记；缺省 = 全局默认）。面板会话头部放两个下拉（agent + 模型，选项取自 `scanAgents()` / `modelsForAgent`）；改动经新 IPC `setConversationAgentModel(id, agentId?, model?)` 落到会话库。`orchestrate` handler 按**该会话**的 `agentId`/`model` 构造 producer（`createOpsProducer` 的 `toolId`/`model`），未选则回落 `settings.defaultAgent`/`defaultModel`。

**理由**：per-conversation 覆盖比全局设置更贴合「这条对话我想用某模型」；持久化在会话上，重开续接仍生效；复用既有 agent/模型探测与词表，不新建模型通道。

**替代**：① 只用全局默认——不满足诉求。② 面板级临时选择（不持久化）——重开丢失、与「会话持久化」不一致，弃。

**数据/接口增量**：`Conversation.agentId? / model?`；`conversation-store` 加 `setAgentModel`；IPC `setConversationAgentModel`；orchestrate producer 按会话选型。

### 决策 9：聊天内容可复制（渲染层上下文菜单，复用 copyText）

**背景**：用户要能复制聊天内容——右键消息给统一复制按钮，或选中文字右键复制对应文字。

**选择**：
- 聊天消息文字加 `select-text`（覆盖 app 全局 `select-none`，同 `CommandOutputView` 的既有做法），使可选中。
- 右键消息（`onContextMenu`）弹一个**渲染层内的小上下文菜单**（portal + 定位到光标），项：「复制该消息」（复制整条消息文字，含 agent 回复 + 提案 op 的可读描述）；当存在非空文字选区时另给「复制选中的文字」。点击项经既有 `window.klarit.copyText` 写剪贴板、关菜单；点菜单外或 Esc 关闭。
- 复用既有 `CopyButton`/`copyText` 通道，不新建剪贴板机制。

**理由**：渲染层内菜单比接 Electron 主进程 `Menu` 更易测（组件测试可断言弹出与 `copyText` 调用），且不影响其它区域的右键行为；`select-text` 是既有模式，一致。

**替代**：① app 级 Electron 上下文菜单——更通用但主进程 Menu 难单测、超出本 change；② 仅 hover 复制按钮——不满足「右键复制选中文字」。

### 决策 10：全局 agent = 自由对话助手（单 agent 会话核·技能内联；回复优先、ops 可选）

**背景**：初版把编排 prompt 做成「每轮必须输出卡操作 JSON」——用户一段自由叙述/闲聊，agent 产不出合规 JSON 就空了。用户要的是**像 Claude Code 那样的自由对话 agent**：能自由聊，识别到意图才调对应技能干活。

**选择（单 agent 会话核·技能内联）**：
- 一个**会话 agent**，prompt 重塑为「Klarit 需求助手」：**回复永远第一位**（`reply`）；**纯聊天/答疑是有效轮次**（`ops` 空、不算失败）。
- 各操作的**技能说明内联进同一 prompt**（create/split/merge/relate/新建项目），每个技能给出其结构化输出格式——是该操作输出的单一来源；create 沿用 decompose 的卡字段约定。
- agent **识别到可执行意图**时，按对应技能格式在 `ops`（和新项目的 `suggestedProject`）里产出结构化操作；否则只回 `reply`。
- 1 次 agent 调用/轮；下游（parse `{reply, ops, suggestedProject}` → 审阅 → applyOps → cardStore）**全不变**。

**理由**：直接治好「强制 JSON」的僵硬、给到自由对话；1 调用/轮延迟低、最快落地；技能内联仍保「各操作格式单一来源」。**替代**：① 调度器 + 独立技能 agent（动作时 2 调用、延迟高、复杂）——留后续若需强模块化再拆；② 维持强制 ops——与「自由对话」冲突，弃。

**关键行为**：纯聊天轮 = `reply` 有内容、`ops` 空、无 issue、不显「本轮没产出」占位（那只在 reply 也空时兜底）。

## Risks / Trade-offs

- **只读无法 OS 强制** → 收窄工具 + prompt 红线 + 只消费结构化输出、忽略文件写；即便它写了也不采纳。测试用假 producer 不涉真写。
- **agent 产 ops 不合 schema / 越界** → 容错解析（同 `parseCandidateCards` 逐条收敛）+ `validateOps` 硬护栏（越界标非法），不静默应用。
- **token 预算爆（卡多）** → board-context 确定性截断 + 显式标注「省略 N 张」（no silent caps）；描述截断到首段。
- **split/merge 边一致性** → store 层原子写 + 复用 `INVERSE`；越界整体拒绝不部分落，避免半破坏。
- **多开会话竞态 / 与看板刷新** → 会话 store 与 card store 独立；apply 后统一刷看板。会话按 conversationId 隔离，无共享可变态。
- **decompose 改走 applyOps 回归** → 先写测试锁定「描述想法」现有落库行为不变，再重构落库调用点。

## Migration Plan

1. 共享层：加 `CardOp`/`OrchestrationProposal`/`OpIssue`/`Conversation` 类型 + `isTodoCard` 待办判定 + `normalizeOps`/`validateOps` 纯函数（先测试）。
2. store 层：`card-store.ts` 加 `addRelation`/`removeRelation`/`splitCard`/`mergeCards`（先测试，内存后端）。
3. 编排核：`orchestrate` + `buildBoardContext` + `OpsProducer` 注入（假 producer 先测试）；真实 producer 接流式 runner（脱 worktree、只读）。
4. apply 层：`applyOps` 派发器；把 decompose 落库收敛为其特例（回归测试守 decompose 行为不变）。
5. 会话 store：`conversation-store.ts`（双后端、注入式，先测试）。
6. IPC/preload：暴露 orchestrate / applyOps / 会话 CRUD / 外部 ops 提交通道。
7. 渲染层：全局对话 dockview 面板（多开）+ ops 提案审阅 UI（泛化 NewRequirementFlow 底层组件）；语义令牌、深浅双主题、i18n。
8. `npm run typecheck` + `test:run` 全绿；dogfood（`npm start` 不监听源码）验收全链路。

**回滚**：编排核/会话/面板均为新增；decompose 落库收敛点保留旧路开关，回归失败可回退调用点。

## Open Questions

- 全局对话面板落点具体在 app shell 哪（顶栏按钮开 / 侧栏常驻）——UI 实现期定，不影响能力契约。
- 只读工具收窄的具体 `--allowedTools` 清单（各 adapter 差异）——真实 producer 落地期撞真 CLI 校准，先以「忽略文件写」兜底。
- board-context 的项目目标喂全文还是裁剪版——先喂生效宪法 + 目标关键段，token 预算实测后调。
