## 1. 共享层：卡操作 schema 与待办判定（测试先行）

- [x] 1.1 在 `shared/types.ts` 加 `CardOp` 判别联合（create/adjust/split/merge/relate）、`OrchestrationProposal{ops,issues,reply?}`、`OpIssue`、`Conversation`/`ConversationMessage` 类型
- [x] 1.2 先写测试：`isTodoCard(card)`（leaf 未开始/无 activeRunId，或 container = 待办；否则越界）——覆盖各状态/原型
- [x] 1.3 实现 `isTodoCard` 于 `shared`（单一来源，供 board-context 标注与 validateOps 共用），跑绿
- [x] 1.4 先写测试：`normalizeOps(raw)`（逐条容错收敛为合规 CardOp，仿 parseCandidateCards）
- [x] 1.5 先写测试：`validateOps(ops, {cards, registry})`——目标存在、typeId 在册、预取名不撞、parent 无环、结构 op 目标在待办（越界标非法带原因）
- [x] 1.6 实现 `normalizeOps` + `validateOps`，先红后绿

## 2. 卡库原语：关系增删 + 拆并（测试先行）

- [x] 2.1 先写测试：`addRelation`/`removeRelation`（双向落地、删清对侧、非 container 加 parent 拒、自环拒、重复幂等）
- [x] 2.2 实现 `addRelation`/`removeRelation` 于 `card-store.ts`（复用 INVERSE），跑绿
- [x] 2.3 先写测试：`splitCard`（建 N 卡、外部边默认全继承/按 edgeInherit、删源、双向一致、越界参与卡整体拒、不碰 git）
- [x] 2.4 先写测试：`mergeCards`（目标卡合并描述、边并集重指目标、丢内部边去重、邻居反向边重指、删被并卡、越界拒）
- [x] 2.5 实现 `splitCard`/`mergeCards`（原子写、纯管理态、待办门控），先红后绿

## 3. 编排核 orchestrate（测试先行，假产出者）

- [x] 3.1 先写测试：`buildBoardContext(deps)`——全盘卡摘要（含状态/待办标注）+ 关系边列表 + 目标/生效宪法；限本项目；超预算确定性截断 + 标注「省略 N 张」
- [x] 3.2 实现 `buildBoardContext`（注入 cards/relations/goals/constitution provider），跑绿
- [x] 3.3 先写测试：`orchestrate(intent, projectId, conversationId?)` 注入**假 OpsProducer**（返固定 ops）→ 装配 context → normalize → validate → OrchestrationProposal；未绑定项目空态；产出者失败/不可解析降级空提案附提示
- [x] 3.4 实现 `orchestrate` 编排核 + `OpsProducer` 注入形态，先红后绿

## 4. 真实产出者：流式续接 runner（脱 worktree、只读）

- [x] 4.1 实现真实 `OpsProducer`：经 `agent/runner.ts` 驱动配置的默认 agent（非 worktree cwd、只读姿态、收窄只读工具），解析回复为 CardOp JSON（容错，复用 normalizeOps）
- [x] 4.2 单元测试：产出者对畸形/含围栏/越界回复的容错与降级（不触真 CLI，桩 runner）

## 5. 会话持久化 store（测试先行，可多开）

- [x] 5.1 先写测试：`conversation-store.ts` 双后端（内存/文件）——建/读/追加消息/存最近 sessionId/按 projectId+conversationId 隔离、多条独立
- [x] 5.2 实现会话 store（`userData/conversations/<projectId>/<id>.json`，注入式），跑绿
- [x] 5.3 单元测试：多轮续接选择——有 sessionId 且支持则 `--resume`，否则历史重建（复用 launchContinuation/buildContinuationDelta，桩 runner）

## 6. apply-ops 派发 + decompose 收敛

- [x] 6.1 先写测试：`applyOps(ops)` 派发到 cardStore（create/adjust/relate/split/merge），回报 {applied, issues}；破坏性 op 需已确认标记
- [x] 6.2 实现 `applyOps` 派发器，先红后绿
- [x] 6.3 回归测试：锁定「描述想法」现有 create 落库行为不变
- [x] 6.4 把 decompose 落库收敛为 `applyOps` 的 create 特例（`createTasks`/`cards:create` 调用点改指），回归绿

## 7. IPC / preload 通道

- [x] 7.1 加 IPC：`orchestrate`、`applyOps`、会话 CRUD（建/列/读/追加/删）、外部 ops 提交（复用同一 validateOps，不旁路）
- [x] 7.2 preload 暴露对应 `window.klarit.*` 方法 + 类型；扩 `global-agent.ts` 接缝到编排核
- [x] 7.3 主进程接线：编排核 deps（cards/relations/goals/constitution/registry provider）+ 真实产出者 + 会话 store 注入 `index.ts`

## 8. 渲染层：全局对话面板 + ops 审阅（遵 brand）

- [x] 8.1 全局对话面板（照现有约定用 FloatingWindow 无蒙层浮窗，非 dockview——主壳本就无 dockview）：多轮聊天输入 + 会话切换（可多开），仅语义令牌、深浅双主题、i18n（en/zh）
- [x] 8.2 会话 store（renderer zustand）：驱动 orchestrate、加载/持久化历史、多会话状态
- [x] 8.3 ops 提案审阅 UI：逐 op 操作预览（diff 感）+ issues 提示，复用 NewRequirementFlow 导出的 FloatingWindow/TypeBadge/MarkdownView
- [x] 8.4 破坏性 op（merge/split）二次确认弹窗（portal+scrim），交代将删/并哪些卡
- [x] 8.5 确认后经 applyOps 应用、刷新看板；面板入口=主面板区常驻悬浮按钮，与「描述想法」并列
- [x] 8.6 组件测试：对话面板发起→假提案→审阅→确认→applyOps；破坏性二次确认；越界 op 显 issue；可多开

## 9. 收尾验收

- [x] 9.1 `npm run typecheck`（node + web 两套）全绿
- [x] 9.2 `npm run test:run` 全绿（936 通过）
- [x] 9.3 dogfood（`npm start` 不监听源码）：开全局对话 →「新增需求 X」得 create 提案、「把这两卡合并」得 merge、「这卡拆两半」得 split →确认→看板上卡真的建/改/拆/并；对已跑卡意图得「建议新建」而非跨卡结构改（多轮真机 dogfood：修好双 JSON 解析、新项目类型集校验、容错修复、按项目分会话、聊天 UX 打磨）
- [x] 9.4 `/opsx:archive` 同步增量 spec 到主 specs

## 10. 演进：全局对话永远可用 + 新项目落位（测试先行）

- [x] 10.1 共享层：`OrchestrationProposal` 加 `suggestedProject?: { name, description? }`；producer `parseOpsReply` 解析 `suggestedProject`（先写测试）
- [x] 10.2 编排核：`orchestrate` 未绑定项目时**不再回 unbound 空态**，改为空全盘视野照常跑（reply + 可选 suggestedProject）；prompt 加「当前项目 vs 新项目」判定与 suggestedProject 输出契约（先红后绿，假 producer 覆盖新项目意图）
- [x] 10.3 会话 store 改**应用级全局**：主进程会话 CRUD 去 projectId 门控、用固定全局作用域（回归 conversation-store 测试；调 index.ts 接线）
- [x] 10.4 主进程：`orchestrate` handler 未绑定也跑；新 IPC `orchestrateCreateProject(proposal)` = 选目录→`importProject`→绑窗口→`applyOps(create ops)` 种卡
- [x] 10.5 renderer store `globalChat`：`openPanel` **去绑定门控**（永远开）；会话全局；提案含 `suggestedProject` 时走「创建项目并加入这些需求」流（先写 store 测试）
- [x] 10.6 renderer UI：面板永远可开；ops 审阅对 `suggestedProject` 渲染「创建项目并加入这些需求」按钮，点击走选目录→建项目→种卡（组件测试：未绑定开面板、suggestedProject 审阅与确认）
- [x] 10.7 `npm run typecheck` + `test:run` 全绿（940 通过、无未捕获错误）；dogfood 待真机验收

## 11. 对话按会话选 agent/模型（测试先行）

- [x] 11.1 共享层：`Conversation` 加 `agentId?` / `model?`；`conversation-store` 加 `setAgentModel(scope, id, agentId?, model?)`（先写 store 测试：往返/回落）
- [x] 11.2 主进程：新 IPC `setConversationAgentModel(id, agentId?, model?)`（全局作用域）；`orchestrate` handler 按**该会话**的 agentId/model 构造 producer，未选回落 `settings.defaultAgent/defaultModel`
- [x] 11.3 preload + `KlaritApi` 类型：暴露 `setConversationAgentModel`
- [x] 11.4 renderer store `globalChat`：加载探测到的 agents（`scanAgents`）+ 全局默认；`setAgentModel` 动作写会话并刷新
- [x] 11.5 renderer UI：会话头部两个下拉（agent + 模型），仅语义令牌、深浅双主题、i18n；改动落库并对本会话后续轮生效（组件测试：选模型→orchestrate 用该会话选型）
- [x] 11.6 `npm run typecheck` + `test:run` 全绿；dogfood：在对话里换模型，后续轮用新模型

## 12. 聊天内容可复制（测试先行）

- [x] 12.1 先写测试：`messageToText(message, t)`（用户=文字；agent=回复 + 提案 op 可读描述拼接）纯函数
- [x] 12.2 消息文字加 `select-text`（覆盖全局禁选）；实现 `messageToText`
- [x] 12.3 渲染层上下文菜单组件：右键消息弹出（portal + 光标定位），项「复制该消息」/（有选区时）「复制选中的文字」，点击经 `copyText`、点外/Esc 关闭
- [x] 12.4 组件测试：右键消息→菜单出现→点「复制该消息」调 `copyText(整条)`；有选区时出现并可复制选中；无选区不显示「复制选中」
- [x] 12.5 `npm run typecheck` + `test:run` 全绿；dogfood：右键消息复制、选中文字右键复制

## 13. 全局 agent 改为自由对话助手（单 agent 会话核·技能内联，测试先行）

- [x] 13.1 先改测试：`buildOrchestratePrompt` 断言含「自由聊天优先/角色」+ 各操作技能格式（create/split/merge/relate/新建项目），不再是「必须产出 ops」的口吻
- [x] 13.2 重写 `OPS_CONTRACT`/`buildOrchestratePrompt`：Klarit 需求助手人格、回复优先、纯聊天有效、意图识别才产 ops、技能内联（create 沿用卡字段约定）
- [x] 13.3 编排核/主进程回归：纯聊天轮（producer 返 `{reply, ops:[]}`）→ 提案只有 reply、无 issue、无占位；识别意图轮 → 有 ops（假 producer 覆盖两种）
- [x] 13.4 渲染层确认：纯聊天 reply 正常显示、不误显空占位（占位仅 reply 与 ops 皆空时）——补/调组件测试
- [x] 13.5 `npm run typecheck` + `test:run` 全绿；dogfood：自由聊一句得回复；说「合并 A、B」得 merge 提案；说「做个新工具」得新项目提案

## 14. 消息底部操作：复制/编辑/重试 + 去空占位（测试先行）

- [x] 14.1 主进程：IPC `conversationRetryLast(id)`（丢弃末尾 agent 回复→按会话选型重跑上一条用户意图→追加新回复）、`conversationDropLastTurn(id)`（移除最新一轮，供编辑）；先写 conversation-store 辅助测试
- [x] 14.2 preload + `KlaritApi` 类型：暴露两个新方法
- [x] 14.3 renderer store：`retry()`（调 retryLast、置 sending、重载 active）、`editLast()`（回填输入 + dropLastTurn + 重载）
- [x] 14.4 renderer UI：每条消息底部操作行——用户「复制」+（最新一条）「编辑」；agent「复制」+（最新一条）「重试」；去掉空回复占位气泡
- [x] 14.5 组件测试：复制调 copyText；最新用户显「编辑」点击回填并去轮；最新 agent 显「重试」点击调 retryLast；空 agent 回复不显占位
- [x] 14.6 `npm run typecheck` + `test:run` 全绿；dogfood：复制/编辑/重试可用

## 15. 新项目选工作流→按其类型建卡（测试先行）

- [x] 15.1 共享层：`SuggestedProject` 加 `workflowId?`；`coerceToRegisteredType` 容错纠正 typeId（先写测试）
- [x] 15.2 board-context 加「可选工作流清单（id·name·类型 id）」；prompt 新项目技能：挑 workflowId + 用其类型 id
- [x] 15.3 编排核：新项目 ops 按**所选工作流的类型集**（默认+suggestedTypes；无则默认）校验 + 纠正 typeId（假 producer 覆盖）
- [x] 15.4 主进程：`orchestrateDepsFor` 提供工作流清单+类型；`orchestrateCreateProject` = 选目录→importProject→**激活 workflowId+播种类型**→applyOps 种卡
- [x] 15.5 renderer：`createProjectFromProposal` 带上 workflowId；审阅显示所选工作流名
- [x] 15.6 `npm run typecheck` + `test:run` 全绿；dogfood：在 A 项目里建新项目 B，选到工作流、卡类型合规不再误删

## 16. 会话按项目分开（改回，未绑定用独立作用域，测试先行）

- [x] 16.1 主进程：会话作用域从固定 `__global__` 改为**当前窗口项目**（`currentProjectId(e)`，未绑定回落 `__unbound__`）——orchestrate/retry/drop/会话 CRUD/选型/producer session 桥全改用该作用域
- [x] 16.2 conversation-store 回归：按作用域隔离（已有 p1/p2 隔离用例覆盖）；补一条「未绑定作用域独立、不与项目串」
- [x] 16.3 renderer 确认：openPanel 拉的是当前项目会话；不同项目窗口各看各的、新项目开新对话（现有 openPanel 逻辑无需改，靠主进程作用域）
- [x] 16.4 `npm run typecheck` + `test:run` 全绿；dogfood：空窗口聊 → 进项目 A 打开是 A 的新对话（不串空窗口那条）；A/B 项目各自会话不串
