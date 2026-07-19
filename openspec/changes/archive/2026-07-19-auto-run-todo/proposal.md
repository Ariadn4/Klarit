## Why

现在跑一张卡只有一条路:人在卡详情里点 `▶`,一次点一个。待办列堆着一排卡,用户得手动挨个拉起——项目一大就变成"看着待办发呆、手点到累"。用户要的是**待办自动流起来**:有资格的卡自己排队跑,人只管需求和优先级。

但不是"待办里啥都无脑并发全开"。三条约束是这个功能的骨架:①**最多 3 个自动并行**,免得机器/agent 额度被打爆;②**只有已完成才去找下一张**补位(暂停/等待决策/中止都不补),让并发数稳定收敛;③**候选多于空槽时,让 agent 判哪张与在跑任务冲突最小、优先跑冲突小的**——因为多张卡最终都要 merge 回同一个物理仓,改到同一批文件就会合并冲突,先跑不打架的那批能少给人添堵。

这整套现在**一点都没有**:全库无任何队列/调度/并发概念,运行是"人点一下 start 一个"。所以本 change 是**新造一个常驻主进程的自动排程回路**——但它不碰引擎内部,只复用现成的"从卡派生运行请求 → `engine.start` → 建卡↔运行双向链"接缝,并挂在引擎现有 `emit` 回调上感知运行终局。

## What Changes

- **新能力「待办自动排程」(`todo-auto-scheduler`)**:一个主进程常驻回路,在"卡进入待办"、"某运行 `done`"、或"某卡被删除(释放槽位)"后重新评估,把有资格的待办 leaf 卡自动拉起,**自动并发上限 3**,槽没满就贪心补满。
- **自动运行资格纯隐式判定、无开关**:一张卡有资格自动跑当且仅当——是 `leaf`、在待办列(`未开始` 且无 `activeRunId`)、其 **所有 `blocked_by` 目标卡都已「已完成」(硬门)**、且从卡派生运行请求成功(有 `repos`、项目有激活工作流)。container、被阻塞、派生失败的卡永不自动启动。不引入每卡开关或全局总开关。
- **手动启动不受上限约束**:详情面板的 `▶` 手动运行一律直接启动、可使活跃数超过 3;此时排程暂不自动填槽,待自然回落到 <3 再补。排程**绝不为让位而中止任何运行**。
- **冲突处理:确定性、即时、无 agent**:以**成员仓重叠**判冲突——候选与在跑卡集合无共享仓 → 不可能合并冲突。选取顺序=**与在跑不共享仓者优先(按序)→ 共享仓者(按序)**,填满空槽。多仓下把并行错开到不同仓;单仓下退化为纯按序填槽。**不调用任何 agent、无往返时延、即时**。(原设计的"冲突排序 agent"因单仓下每次填槽都要付一次 agent 往返、体验上"盯着空槽等"而**移除**;文件级智能排序留作未来可选增强。)

## Capabilities

### New Capabilities
- `todo-auto-scheduler`: 待办列有资格 leaf 卡的自动排程回路——触发点(卡进待办 / 运行 `done`)、自动并发上限 3(手动可超、排程不中止)、隐式资格判定(leaf + 在待办 + `blocked_by` 硬门 + 派生成功)、**确定性即时填槽**(与在跑不共享仓者优先、其余按序,无 agent)、复用既有运行启动接缝与 `emit` 感知、容忍开机 `resumeAll` 的既成超额;**自动启动实时反映到看板**(主进程 `cards:changed` 广播 + 渲染层卡片重载防竞态)。

### Modified Capabilities
- `workspace-windows`: 「在新窗口打开项目」补齐——**把既有空窗口绑定到项目时必须通知该窗口渲染层刷新显示**（离开空状态），且此刷新独立于发起窗口:从**管理项目窗口**发起、或**导入**复用空窗口时,被绑定窗口也 MUST 刷新到新项目、不空屏。修复既有 bug:复用空窗口只改了主进程绑定、渲染层仍停在空状态 → 空屏(导入后不开、管理窗口再点也不开)。

> 附带修复(应用户要求随本 change 一并处理):此 bug 与自动排程无直接关系,但在 dogfood 验收自动排程时挡住了"导入/打开项目"这一步,故合并修复。

## Impact

- **代码(新增)**:`src/shared/auto-schedule.ts`(纯逻辑:自动资格判定 `isAutoEligible`、共享仓判定 `reposUnion`/`reposOverlap`、确定性填槽 `planFills`——可独立测,无 fs/IPC);`src/main/auto-scheduler.ts`(常驻回路:串行化评估、复用 `deriveRunRequest`+`engine.start`、确定性即时填槽,**无 agent 依赖**)。
- **代码(接线)**:`src/main/index.ts`——把排程 `evaluate()` 挂进引擎 `emit` 回调(运行 `done` 后触发,与 `reconcileCardForRun` 同源)、卡落库/关系更新接缝(手动新建、`submitDecomposedCandidates`、关系增删)后触发、**以及 `cardsRemove` 删卡后触发(删在跑卡释放槽位→补位)**;活跃运行数取引擎在册运行(单一真相来源)。
- **代码(看板实时刷新修复)**:两处——① `src/main/index.ts` + `src/shared/ipc.ts` + `src/preload/index.ts` + `src/shared/types.ts` + `src/renderer/src/App.tsx`:新增 `cards:changed` 广播——`startCardRun`(手动/自动共用接缝)置卡链后向所有窗口广播,渲染层订阅即 `load()`。修复根因:**异步自动启动**后没有任何一次 `load()` 被触发(引擎 `node-enter` 只回灌运行断点、不刷卡状态,初始 `running` 态无独立 state 变更事件),看板 `cardColumn` 见卡状态仍「未开始」→ 误判进「待办」(实际在跑)。② `src/renderer/src/stores/cards.ts`:`load()` 加**单调序号防竞态**(旧数据不覆盖新状态)——并发自动启动多张时防较早发起、较晚返回的陈旧 `load` 覆盖较新态。
- **代码(附带窗口修复)**:`src/main/windows.ts`(`WindowManagerOptions` 加 `notifyBound`,`bindWindow` 绑定后回调)、`src/main/index.ts`(注入 `notifyBound` → `win.webContents.send(IPC.projectBound)`)、`src/shared/ipc.ts`(新通道 `projectBound`)、`src/preload/index.ts`(`onProjectBound`)、`src/shared/types.ts`(`KlaritApi.onProjectBound`)、`src/renderer/src/App.tsx`(订阅 `onProjectBound` → `refresh()`+`refreshActiveWorkflow()`)。
- **依赖**:填槽为确定性纯逻辑,**不依赖任何 agent**、不引入新第三方依赖。
- **兼容**:手动运行行为完全不变;既有双向链/开机 `resumeAll`/列派生不动。排程自动启动的运行与手动启动在双向链、卡状态、列归属上**无差别**。
- **不在本 change**(Non-Goals):① `abort`/`paused`/`waiting-decision` **不触发**填槽(只 `done` 触发)——手动中止不即时补位是有意取舍;② 不做"暂缓/草稿"口子:想把待办卡挡住只能挂 `blocked_by` 或不拖进待办(隐式判定的代价,已与用户确认接受);③ 上限 3 不做可配置;④ **不做文件级/语义级冲突判断**(靠成员仓重叠这一即时确定性判据,非精确;文件级智能排序需 agent/静态分析,留未来可选增强——本期已**移除**冲突排序 agent);⑤ 不接 webhook、不做优先级手调、不跨项目排程;⑥ 不改引擎 `drive`、不新增引擎能力。
