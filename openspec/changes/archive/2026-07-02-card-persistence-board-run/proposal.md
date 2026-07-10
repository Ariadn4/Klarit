## Why

运行引擎脊柱与命令执行器已归档:引擎能跑 engine/command 工作流,带阶段状态机、失败四归宿、可恢复——但运行只绑 `runId`、不绑需求卡;看板只渲染列骨架、不渲染卡;落库接缝(`createTasks` / `submitDecomposedCandidates`)止于审阅、不写库;现场靠一张临时 dogfood 试跑卡(`DogfoodRunCard`)凑合。需求卡数据模型与纯校验已 spec 好(`requirement-card-model`),现在要把"真需求卡"立起来:落库、上看板、绑运行、收编决策与命令输出,让 vibe coder 在需求层就能建卡→跑流程→决策→续跑。

## What Changes

- **需求卡落库 + CRUD + IPC**:RequirementCard 存 userData(不入 git,按项目身份关联,一卡一文件),增删改查 + 关系(parent/child、blocked_by、coupled_with)随卡存;持久化形态补管理态字段 `projectId` / `repos[]` / `activeRunId?`(`worktreePath` 不存、从运行派生)。
- **两条落库路统一**:手动新建(`createTasks`)与外部分解候选(`submitDecomposedCandidates`)审阅通过后,收口到同一个 `cardStore.create(candidates[], projectId)`。
- **看板渲染真卡**:leaf 卡按运行「当前节点」所属 stage 在阶段列流动,container 卡停「待办」作子卡入口、子卡全归档→「已完成」;点卡→详情面板。卡上展示**圆点运行态**(呼吸蓝/紫=工作中、黄=检查中、静止红=等待决策)+ 当前节点名 + 括号细状态,以及**分支名**(点击在本地有 worktree 时切侧边栏 git 视图并聚焦该 worktree)。
- **运行绑卡**:`RunRequest`/运行断点加 `cardId`;卡上「运行」按钮从卡派生 RunRequest(branch=预取名 slug、repo=卡涉及的成员仓);运行态/断点成为卡的关联数据;开机自动恢复进行中的卡(沿用引擎 `resumeAll`)。
- **决策落卡详情**:`waiting-decision` 在需求卡详情面板内呈现(单卡决策),复用现有 i18n 决策 UI(titleKey/options/input/actions/reason/gateHistory/raw),抽成可复用组件。
- **命令输出按条分流浏览**:引擎给运行加按(命令 / 后台 bgId)分桶的输出缓冲(现状只走 `engine:progress` 即时流、不可回看);卡详情里前台命令(蓝点入口)与每个后台命令各有可点入的独立输出视图。
- **退役 dogfood**:整条链路通且 dogfood 验收后,删除 `DogfoodRunCard` / `DogfoodPanel` / `dogfood-cards`。
- 留好后续 hook(本期不实现):决策 `sourceKind` 口子保持、`cardId`/涉及仓信息在断点与决策里齐备,为将来 agent 路由与跨卡决策留位;圆点的紫点(agent)与子工作流穿透**派生逻辑写全、数据留口**,本期无真实运行点亮。

## Capabilities

### New Capabilities
- `requirement-card-store`: 需求卡的持久化与 CRUD——userData 一卡一文件、按项目身份关联、关系随卡存;持久化形态的管理态字段(projectId/repos/activeRunId);两条落库路统一的创建接缝;从卡派生 RunRequest(单仓先跑通)与运行绑卡的双向链(卡 activeRunId ↔ 运行 cardId)及开机按卡恢复;经 IPC 暴露给渲染层。
- `requirement-card-detail`: 需求卡详情面板——运行控制(运行/暂停/恢复)、单卡决策呈现(迁自 dogfood 的 i18n 决策 UI)、命令输出按前台/各后台任务分流的可回看视图。

### Modified Capabilities
- `requirement-kanban-board`: 由"列骨架、空容器、不放卡"改为**渲染真需求卡**——列定位派生规则(container 停待办、leaf 按当前节点 stage 流动、完成进已完成)、卡上圆点运行态与当前节点/细状态展示、卡面以类型色条(非文案)表达类型、卡上分支名(仅分支真正建出后展示实际分支名)与点击聚焦 git 视图、点卡进详情面板。
- `engine-execution`: `RunRequest` 与运行断点新增 `cardId` 关联(运行因卡而起、断点带卡身份);命令输出按(命令 / 后台 bgId)分桶缓冲、可回看(供详情面板分流浏览);断点新增可选 `nodePath?`(子工作流穿透留口,本期恒只顶层一项)。
- `sidebar-git-view`: 新增**程序化聚焦**入口——可由外部(卡片点击)把 git 视图定位到指定(成员仓, 分支)对应的 worktree,复用既有"选分支预览 worktree / 无 worktree 空态"机制。
- `decompose-ui`: 审阅候选任务窗的**任务详情视图**——返回入口移入标题栏、用统一 chevron 图标(全 app 不用 `←`);详情视图不渲染「取消/创建任务」页脚,须返回候选列表方可创建;「创建任务」经统一接缝落库(不再止于交接)。

## Impact

- **数据/存储**:新增 `userData/cards/<projectId>/<slug>.json`(一卡一文件,为字段级合并/云同步留粒度);`userData/engine-runs/<runId>.json` 断点结构加 `cardId`/`nodePath?`;命令输出缓冲落点(运行期内,随断点目录或独立缓冲)。
- **类型/共享**:`src/shared/types.ts` 的 `RequirementCard` 持久化形态、`RunRequest`、`RunBreakpoint` 加字段;`src/shared/requirement-card.ts` 纯校验保持不变(管理态字段校验归 store 层)。
- **主进程**:新增 card store(仿 `run-store.ts`/`store.ts` 读写模式);`src/main/engine/*`(engine.ts 绑 cardId、resumeAll 对上卡状态、命令输出缓冲)、`decompose-service`/`global-agent` 落库接缝、IPC 注册(`index.ts` + `preload`)。
- **渲染层**:`KanbanBoard`/`BoardColumn` 渲染真卡 + `lib/board.ts` 加 `cardColumn`/`runDot`/`nodeToStage` 派生纯函数;新增卡详情面板与 `RunDecisionPanel`、命令输出视图;`newRequirement` store 的 `createTasks` 接落库;删除 `DogfoodRunCard`/`DogfoodPanel`/`dogfood-cards`。
- **品牌/主题**:卡片、圆点、详情面板遵循 `docs/brand` 与语义令牌(深浅双主题),圆点颜色取自既有颜色体系(violet/cobalt/amber/red 等语义令牌)。
- **不动**:`workflow.yaml` 结构;`requirement-card-model` 纯校验契约;不接任何 agent;不做 blocking/coupling 强约束;多仓并行(仅数据留口)。
