## Why

`todo-auto-scheduler` 已经能把待办列的有资格卡**自动并发拉起 3 张**。但用户要发现「哪张卡在等我拍板」，只能挨个点开卡详情看——决策目前只在 `RequirementCardDetail` 里由 `RunDecisionPanel` 呈现（见 `requirement-card-detail`「单卡决策在详情面板内呈现」）。

于是「永不静默卡住」在**引擎层**成立（`engine-execution`「运行态与永不静默卡住」保证运行一定停在一个待决策上），在**用户视野层**不成立：三张卡并发跑，两张停在人工验收门，用户不点开就不知道。自动排程越好使，这个洞越大——卡被自动拉起来了，停下来却没人告诉你。

同时缺一个「该打扰你了」的判据：现在要么不打扰（全靠自己翻），要么只能全量盯。需要的是**只在需要你决策时冒泡**。

## What Changes

- **新增决策收件箱（投影，不新增真相源）**：主进程维护一个**当前项目**的收件箱投影，条目 = 一个正等待用户拍板的运行。**唯一真相源仍是 `RunBreakpoint.pendingDecision`**——收件箱只是它的索引，不落盘、不双写：进程内由既有 `engine.onEngineProgress` 的 `decision`/`state` 事件增量维护，开机/切项目由 `run-store.list()` 全量重建。决策被 `decideRun` 回应后条目自动消失。
- **决策产生时刻入断点**：`RunBreakpoint` 加可选 `pendingSince`（引擎置 `pendingDecision` 时一并写）。收件箱据它排序与算「等了多久」；重启后不丢。这是本 change 唯一的持久化增量。
- **收件箱条目自带定位信息**：`{ runId, cardId, cardName, source, titleKey, titleParams, pendingSince, gateKind }`——`gateKind` 由 `EngineDecision.source` 后缀派生（`manual-gate` = 等你验收 / 其余 = 失败升级要你选）。文案沿用既有 i18n key 机制，收件箱**不另写一套文案**。
- **应用外壳的收件箱入口 + 未读计数**：顶栏一个入口，带待处理条目数徽标；点开列出条目（按 `pendingSince` 升序，等最久的在上），点条目**跳到该卡详情并聚焦决策面板**——收件箱只做导航，**不在收件箱里直接回应决策**（回应仍归 `RunDecisionPanel` 单一入口，避免两套决策 UI）。
- **应用未聚焦时发系统通知**：新条目进收件箱且应用窗口未聚焦时，发一条桌面通知（点击聚焦窗口并跳到该卡）。默认开、可在设置里关。只为**新增**条目发，不为条目消失发。

## Capabilities

### Added Capabilities
- `decision-inbox`: 项目级待决策收件箱——从 `pendingDecision` 派生的投影、条目结构与排序、增量维护与开机重建、外壳入口与未读计数、跳转定位、系统通知与其开关。

### Modified Capabilities
- `engine-execution`: `RunBreakpoint` 加 `pendingSince`——置 `pendingDecision` 时记录时刻、清决策时一并清；恢复与决策回路行为不变。
- `app-shell-sidebar`: 外壳顶栏新增收件箱入口（图标 + 未读徽标），与既有视图切换/折叠开关并列。

## Impact

- **依赖 / 复用**：建立在 `engine-execution`（`pendingDecision`、`onEngineProgress`、`decideRun`）、`requirement-card-detail`（决策面板与跳转目标）、`todo-auto-scheduler`（本 change 要补的正是它带来的洞）之上。文案复用既有决策 i18n key，不新增决策文案体系。
- **代码**：新增 `src/main/decision-inbox.ts`（投影）+ `src/shared/decision-inbox.ts`（条目派生纯函数）；`src/main/engine/engine.ts`（写 `pendingSince`）；`src/main/index.ts`（接线 + IPC + 通知）；渲染层新增 `DecisionInbox.tsx` 与外壳入口。
- **兼容**：`pendingSince` 为可选字段，老断点缺省 → 收件箱回落用 run-store 文件 mtime 排序，不阻断。既有决策回应路径完全不变。
- **不在本 change**：跨项目聚合收件箱（本期只当前项目）、收件箱内直接回应决策、把「失败但引擎自愈中」也列进收件箱（那不需要用户决策）、运行时间线（见 `run-timeline-and-usage`）。
