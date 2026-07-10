## Context

引擎脊柱(`add-engine-execution-spine`)与命令执行器(`add-command-executor`)已归档:`src/main/engine/*` 能跑 engine/command 工作流,带阶段状态机(`NodePhase: executing | {gate} | done`)、运行态(`running/waiting-decision/paused/done/aborted`)、失败四归宿 + 统一前进式 i18n 决策(`EngineDecision`)、断点持久化(`RunBreakpoint` @ `userData/engine-runs/<runId>.json`)、`resumeAll` 开机恢复。但:

- 运行只绑 `runId`(`RunRequest` 无 `cardId`);归档 design 明写「卡落地后给 RunRequest/断点加 `card?` 关联字段即可,不改核心」——本 change 兑现。
- 需求卡数据模型与纯校验已 spec 并落地(`src/shared/requirement-card.ts`:`newRequirementCard`/`validateRequirementCard`/`toProposedName`;`src/shared/card-type.ts`:类型与 archetype),但**无持久化/CRUD**。
- 看板只有列骨架(`lib/board.ts:buildBoardColumns`、`BoardColumn`/`KanbanBoard`),列体为空、不放卡。
- 落库接缝是空钩:`newRequirement.ts:createTasks()` 只清状态;`submitDecomposedCandidates` 止于审阅。
- 决策 UI 已成品但寄在临时 `DogfoodRunCard.tsx`(绑 `card.runId`),含 `titleKey/input/options/actions/reason/gateHistory/raw` 全套渲染。
- 持久化模式:自写 `readJson`/`writeJson`(`src/main/store.ts`),registry/cardTypes 存 `registry.json`,run-store 一 id 一文件。

约束:测试先行(针对公共 API,先红后绿);只用语义令牌、深浅双主题(`docs/brand`);不接 agent;`workflow.yaml` 结构不动;单仓先跑通。

## Goals / Non-Goals

**Goals:**
- 需求卡落库:userData 一卡一文件、按项目身份关联、关系随卡存、CRUD + IPC;两条落库路统一收口。
- 看板渲染真卡:纯派生的列定位与圆点运行态;点卡进详情;卡上分支名联动 git 视图。
- 运行绑卡:`RunRequest`/断点加 `cardId`、卡存 `activeRunId` 双向链;卡上「运行」从卡派生 RunRequest;开机按卡恢复(沿用 `resumeAll`)。
- 决策落卡详情(单卡);命令输出按条分流可回看;退役 dogfood。
- 圆点派生函数一次写全、紫点(agent)与子工作流穿透留数据口。

**Non-Goals:**
- 不接任何 agent(agent 节点仍 no-op 跳过);不做跨卡决策弹窗、全局/单需求 agent、自愈。
- 不做 blocking/coupling 强约束(关系存得下、容器 3/3 汇总能算即可)。
- 多仓并行 run(数据模型支持多仓、run 仅取首仓单仓跑通)。
- 不把运行断点物理搬进卡文件(留 engine-runs;云同步并卡是 future)。
- 不动 `workflow.yaml` 结构、不改 `requirement-card-model` 纯校验契约。

## Decisions

### 决策 1:运行断点留 engine-runs 按 runId 存,卡↔运行双向链(不物理搬进卡)

`RunBreakpoint` 仍存 `userData/engine-runs/<runId>.json`(运行机制单一来源,`resumeAll` 依赖 `store.list()`)。绑卡靠双向链:

```
RunRequest.cardId? ──正向──▶ 运行知道自己属哪张卡(断点 request.cardId 持久化)
card.activeRunId?  ──反向──▶ 卡知道自己当前哪个运行(读断点派生圆点/列)
```

`resumeAll` **一行不改**:续每个 `state==='running'` 的断点时,断点带 `cardId`,渲染层据此把卡状态对上(进行中)。「开机自动恢复进行中的卡」= 恢复运行、运行带卡。

**为何不搬**:归档 design 明言「增 `cardId` 关联即可、不改核心」;物理搬入卡文件要改断点写入方与 `resumeAll`,违背该约束。project-goals 设想「断点随卡进云同步」——本期无云同步,断点暂留 engine-runs;并入卡文件留作云同步 change。
**备选(否决)**:断点嵌进 `card.json`、`resumeAll` 改遍历卡——改动面大、收益(云同步)本期用不上。

### 决策 2:看板列定位 = 纯派生函数,列与状态正交

新增 `cardColumn(card, breakpoint?, workflow) → columnKey`(`lib/board.ts`,纯逻辑):

```
container 原型 → 恒「待办」(子卡全归档 → 「已完成」)
leaf 原型:
  status 未开始 / 无 activeRunId → 「待办」
  status 已完成               → 「已完成」
  其余(进行中/已暂停/等待决策) → breakpoint.currentNodeId 所属 stage 的列
```

**列 ≠ 状态**:列由"流到哪个节点"决定(`currentNodeId → stageId`),圆点由"运行状态"决定,两者正交(可"停在合并列 + 红点等待决策")。子工作流**不换列**(一卡一列,按顶层 subworkflow 节点落列);穿透只影响圆点文案。需 `nodeToStage(workflow)` 索引。
**备选(否决)**:用卡 status 直接定列——无法表达"在某阶段列里等待决策",且 container 无 stage。

### 决策 3:圆点派生函数一次写全、数据留口

新增 `runDot(card, breakpoint, workflow) → { shape, color, nodeLabel, subLabel } | null`(纯逻辑):

```
breakpoint.state === 'waiting-decision'  → 静止·红   subLabel = t(pendingDecision.titleKey,...)
phase.kind === 'gate'                    → 呼吸·黄   subLabel = 检查中
phase.kind === 'executing':
   currentNode.executor.kind === 'agent'        → 呼吸·紫  工作中   【B1 跑不到,留口】
   currentNode.executor.kind ∈ {engine,command} → 呼吸·蓝  工作中
无 breakpoint / phase=done                → null(无点)
nodeLabel = nodePath 末项节点名(穿透),无则 currentNode 名
```

`executor.kind` **查工作流定义、不新存**(零成本算蓝/紫)。子工作流穿透需断点带**节点路径** `nodePath?: string[]`(本期恒只含顶层一项),派生读末项。紫点分支代码写全,因 agent 节点 no-op、本期不会 `executing` 在 agent 节点,故不亮——接 agent 时 UI 零改。圆点颜色取语义令牌(violet/cobalt/amber/red),呼吸=CSS 动画,静止=无动画。
**备选(否决)**:把圆点形态当运行态新存字段——冗余,断点已含全部判定输入。

### 决策 4:命令输出按(命令 / 后台 bgId)分桶缓冲、可回看

现状命令输出只随 `engine:progress` 即时流、不留存。新增**输出缓冲**:键 = 前台用 `currentNodeId`、后台用 `bgId`(`RunBreakpoint.background[].bgId` 已是天然分桶键),值 = 该命令累积输出。引擎在产出输出 chunk 时追加进对应桶并 emit 增量事件;渲染层订阅指定桶。缓冲随运行生命周期存在(落 `userData/engine-runs/` 旁的 per-run 输出文件或缓冲目录),供关重开后回看。
卡详情:前台「呼吸蓝点 + 节点文案」当入口 → 当前命令输出视图;后台命令区列 `listBackground()` 每个 `bgId` 一行 → 各自输出视图(可同时多个)。
**备选(否决)**:只在内存缓冲——关重开丢失,违"可回看";只存决策里的 `output`——只有失败时才有、且单条。

### 决策 5:两条落库路统一收口到单一 create 接缝

手动新建(`newRequirement.createTasks()`)与外部分解(`submitDecomposedCandidates`)各自审阅,**审阅通过后**都调同一个 `cardStore.create(candidates: CandidateCard[], projectId)`:对每张 `newRequirementCard(c, now)` → `validateRequirementCard` → 落库 → 写关系边(双向边落地,如 parent 落对侧 child)。
存储:**一卡一文件** `userData/cards/<projectId>/<slug>.json`(仿 run-store),为 project-goals 的"字段级合并 / 云同步多设备并发"留粒度。
**为何审阅后收口**:分解前两路形态不同(本地分解 vs 外部 AI 推候选),审阅后都是 `CandidateCard[]`,此处是唯一公共点。兑现 memory「分解 change 止于审阅、落库归本 change」。
**备选(否决)**:一项目一 `cards.json`——整文件写、合并粒度粗,不利云同步。

### 决策 6:RunRequest 从卡派生(单仓先跑通,数据留多仓口)

卡持久化形态加管理态字段(归 `requirement-card-store`,不污染 `requirement-card-model` 纯校验):`projectId`、`repos: string[]`(卡涉及的成员仓,多仓存得下)、`activeRunId?`。`worktreePath` **不存**、从运行派生。

卡上「运行」派生:`{ workflowId: 项目 activeWorkflowId, repoPath: resolve(card.repos[0]), branch: card.proposedName, cardId: card.id }`。本期 `repos[0]` 单仓跑通,多仓并行(一卡多运行子 + 决策汇总)留扩展。
**备选(否决)**:一步到位多仓并行——引擎要支持一卡多运行、断点聚合、决策汇总,B1 臃肿且超 Non-Goals。

### 决策 7:决策 UI 抽组件迁卡详情,dogfood 链路通后删除

把 `DogfoodRunCard.tsx:133-229` 的运行控制 + 决策渲染抽成可复用 `RunDecisionPanel`(纯渲染 + 回调:`titleKey/input/options/actions/reason/gateHistory/raw`),落需求卡详情面板(**单卡决策**,贴 project-goals「单卡决策直接展示在需求卡详情面板内,跨卡才弹窗」)。整条链路(建卡→看板→详情→运行→决策→重开续上)通且 dogfood 验收后,**本 change 内**删除 `DogfoodRunCard`/`DogfoodPanel`/`dogfood-cards`(CLAUDE.md:不留旧版、过时即删)。
**备选(否决)**:复制一份决策 UI——重复代码,违 DRY。

### 决策 8:分支名联动 git 视图复用既有选择机制

卡上分支名 = `card.proposedName`。点击 → IPC 查该卡 worktree 目录(从 `activeRun` 的 `worktreePath` 派生)是否存在:存在 → 切侧边栏 git 视图 + **程序化聚焦**到(`card.repos[0]`, `card.proposedName`);不存在 → 分支名只读不可点。`sidebar-git-view` 已支持"选分支预览 worktree / 无 worktree 空态 / 选择按窗口持久化",本期只补一个**程序化聚焦入口**(外部设定 git 视图的 repo+branch 选择),复用其余机制。
**备选(否决)**:卡详情内嵌一个迷你 git 视图——重复 sidebar 能力。

## Risks / Trade-offs

- [断点留 engine-runs,与 project-goals「断点属卡片数据」字面不符] → 逻辑上已绑卡(双向链),物理迁移留云同步 change;本期无云同步,无功能缺失。spec 记为显式 future。
- [圆点紫点 / 子工作流穿透本期无真实运行点亮,只能单测] → 派生函数针对全分支写单测(构造断点直接断言),不依赖真实 agent 运行;接 agent 的 change 直接复用。
- [命令输出缓冲落盘增加 IO / 体积] → 按运行分桶、随运行清理(运行 done/aborted 后可回收);仅缓冲文本输出,体积可控。
- [两条落库路收口处校验/关系双向边遗漏] → `create` 单一接缝集中处理关系双向落地与校验,单测覆盖 parent↔child 双向、非法 typeId/重名 slug 去重。
- [卡新增管理态字段与 shared 纯校验解耦,可能出现"校验过但 store 必填字段缺"] → store 层补 `projectId`/`repos` 的轻校验,纯校验保持只管模型本身;store 测试覆盖必填。
- [resumeAll 续运行后卡状态对上时机] → 续跑后渲染层据断点 `cardId` 反查并刷新卡状态;断点是单一来源,UI 派生不另存状态,避免漂移。

## Migration Plan

1. **先写测试(先红)**:① card store CRUD + 关系双向 + 两路 create 收口(内存/临时目录);② `cardColumn`/`runDot`/`nodeToStage` 纯派生(构造卡+断点+工作流断言);③ RunRequest 从卡派生 + `cardId` 贯穿断点 + resumeAll 对上卡;④ 命令输出分桶缓冲(前台/多后台桶隔离、可回看);⑤ 决策 UI 组件渲染(各分支:input/options/actions/reason/gateHistory)。
2. **类型与共享**:`types.ts` 扩 `RequirementCard` 持久化形态(projectId/repos/activeRunId)、`RunRequest.cardId?`、`RunBreakpoint.cardId?/nodePath?`;`requirement-card.ts` 纯校验不动。
3. **主进程 store + 引擎绑卡**:card store(仿 run-store)、关系双向落地、IPC;engine.ts 透传 `cardId`、输出缓冲;落库接缝接 `createTasks`/`submitDecomposedCandidates`;跑 ①③④ 转绿。
4. **渲染层看板真卡 + 详情**:`lib/board.ts` 加派生;`KanbanBoard`/`BoardColumn` 渲染卡 + 圆点 + 分支名;卡详情面板 + `RunDecisionPanel` + 命令输出视图;`createTasks` 接落库;跑 ②⑤ 转绿。
5. **git 视图联动 + dogfood 退役**:`sidebar-git-view` 程序化聚焦;删 `DogfoodRunCard`/`DogfoodPanel`/`dogfood-cards`。
6. **收尾**:`npm run typecheck` + `npm run test:run` 全绿;dogfood `npm start` 走完整链路(建卡→看板出卡→运行 git 工作流→决策落详情→关软件重开,卡与运行都在、断点续上)。
- 回滚:card store 是新增独立目录、`cardId`/`nodePath` 为可选新增字段、派生函数纯增——去掉看板真卡渲染与 IPC 注册即回现状,无 `workflow.yaml` 变更、无破坏性数据迁移(旧 engine-runs 断点无 `cardId` 仍可读)。

## Open Questions

- 命令输出缓冲落点:随 `engine-runs/<runId>/` 子目录(按桶一文件),还是单 `<runId>.out.json`?倾向按桶一文件(后台多任务天然隔离、增量追加友好),dogfood 校准。
- 运行 done/aborted 后输出缓冲回收时机:卡完成即清,还是保留到卡归档?倾向保留到卡归档(完成后用户仍可回看产出),容量大再加上限。
- `repos[]` 解析:成员仓标识用 project-id 还是仓路径?对齐 registry 现有成员仓表示(提案实现时核 `registry-core` 成员仓字段)。
