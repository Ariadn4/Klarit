## 1. 纯逻辑:自动资格 + 共享仓粗筛 + 填槽规划（测试先行）

- [x] 1.1 `src/shared/auto-schedule.test.ts` 写红:`isAutoEligible(card, cardsById, registry, canDerive)` —— leaf ∧ `未开始` ∧ 无 `activeRunId` ∧ 所有 `blocked_by` 目标已「已完成」(目标缺失保守判未满足) ∧ canDerive → 有资格;container / typeId 不在册 / 有未完成 blocker / canDerive=false → 无资格
- [x] 1.2 写红:`reposUnion(running)` + `reposOverlap(candidateRepos, runningUnion)` —— 交集空 → false(冲突分 0);有交集 → true。`rankingNeeded(freeSlots, candidates, running)` —— 候选>空槽 ∧ 候选∪在跑存在共享仓 → true;否则 false
- [x] 1.3 写红:`planFills(freeSlots, candidates, running, ranked?)` —— 返回本轮应启动的卡序列(长度≤freeSlots):freeSlots≤0/无候选 → 空;不需细判(槽够全开/全不共享仓)→ 按入列顺序前 k;给了 ranked → 用 ranked 前 k;降级(ranked=null)→ 优先不共享仓、只剩共享仓则最多补 1 张
- [x] 1.4 实现 `src/shared/auto-schedule.ts`(无 fs/无 IPC,main/renderer 共享定位同 `requirement-card.ts`),转绿

## 2. ~~冲突排序产出者（只读 agent）~~ —— **已移除**（改确定性即时填槽）

> dogfood 暴露 agent 排序太慢(claude-code/opus 一轮几十秒、单仓下每次填槽都走)。按用户决定**删掉 agent**、只保留共享仓这一即时判据、其余按序。删除 `conflict-rank-producer.{ts,test.ts}` 与 `card-run-diff.{ts,test.ts}`(只为喂 agent 而存在),及 index.ts 里 `runningCardDiff`/producer 接线。

- [x] 2.1 删除 `src/main/conflict-rank-producer.ts` + `.test.ts`
- [x] 2.2 删除 `src/main/card-run-diff.ts` + `.test.ts`
- [x] 2.3 `src/shared/auto-schedule.ts`:去掉 `rankingNeeded` 与 `planFills` 的 `ranked` 参数/agent 分支;`planFills(freeSlots, candidates, running)` 改为**确定性**:`[...不与在跑共享仓者(按序), ...共享仓者(按序)].slice(0, freeSlots)`;更新 `auto-schedule.test.ts`

## 3. 排程回路（串行化评估 + 复用启动接缝）（测试先行）

- [x] 3.1 `src/main/auto-scheduler.test.ts` 写红:`evaluate()` 在活跃<3 时按 `planFills` 结果对选中卡走 `startCard`(=派生+start+双向链);活跃≥3 不启动;空闲加一张即启动、五张贪心补到 3
- [x] 3.2 写红:活跃计数取"卡有 activeRunId 且 `isRunLive`"(单一真相来源),含 paused/waiting-decision 占槽者
- [x] 3.3 写红:评估**串行化**——并发调用 `evaluate()` 合并为一次评估,同一张卡至多被 `start` 一次
- [x] 3.4 排程 deps **去掉 `rankConflicts`/`diffSummary`**;`evaluate()` 直接 `planFills(free, eligible, running)`,无 agent 分支、无 await 外部
- [x] 3.5 实现 `src/main/auto-scheduler.ts`(注入 listCards/getProject/getRegistry/canDerive/isRunLive/startCard),转绿(现算现防手动抢槽:逐个启动前重核上限)

## 3. 排程回路（串行化评估 + 复用启动接缝）（测试先行）

- [x] 3.1 `src/main/auto-scheduler.test.ts` 写红:`evaluate()` 在活跃<3 时按 `planFills` 结果对选中卡走 `startCard`(=派生+start+双向链);活跃≥3 不启动;空闲加一张即启动、五张贪心补到 3
- [x] 3.2 写红:活跃计数取"卡有 activeRunId 且 `isRunLive`"(单一真相来源),含 paused/waiting-decision 占槽者
- [x] 3.3 写红:评估**串行化**——并发调用 `evaluate()` 合并为一次评估(agent 只调一次),同一张卡至多被 `start` 一次
- [x] 3.4 写红:降级路径——注入的冲突产出者返回 `null` 时走确定性回落(优先不共享仓、只剩共享仓则最多 1 张),不停摆;候选唯一不喊 agent
- [x] 3.5 实现 `src/main/auto-scheduler.ts`(注入 listCards/getProject/getRegistry/canDerive/isRunLive/startCard/rankConflicts/diffSummary),转绿(现算现防手动抢槽:逐个启动前重核上限)

## 4. 接线:触发点

- [x] 4.1 引擎 `emit` 回调在 `state==='done'` 后 `scheduleEvaluate(projectOfRun(runId))`(与 `reconcileCardForRun` 同处、其后)
- [x] 4.2 卡落库/关系接缝后 `scheduleEvaluate(pid)`——`cardsCreate`、`cardsUpdate`(状态/关系改)、`applyOps`、`orchestrateCreateProject`、`submitDecomposedCandidates`
- [x] 4.3 `paused`/`waiting-decision`/`aborted`(**state 事件本身**)**不**触发——由 `emit` 里 `if (state==='done')` 单一门保证
- [x] 4.5 **删卡触发补位**:`cardsRemove` 处理器在级联中止运行 + `cardStore.remove` 后 `scheduleEvaluate(pid)`——删在跑卡释放槽位 → 自动补位;`auto-scheduler.test.ts` 加例(删在跑卡使活跃 3→2 → 补 1),typecheck+校验绿
- [x] 4.4 在 `src/main/index.ts` 接线:抽出手动/自动共用的 `startCardRun`、每项目懒建 `schedulerFor`、开机 `resumeAll().finally` 后逐项目踢一次;`npm run typecheck` 绿

## 5. 既成超额与终局回归

- [x] 5.1 `auto-scheduler.test.ts` 覆盖既成超额(活跃>3 → 不启动、不抛、不动在跑);blocker 完成后再评估 → 被阻塞卡启动
- [x] 5.2 自动启动复用 `startCardRun`(与手动 `cardsRun` **同一函数**)→ 双向链/卡状态/列归属天然无差别
- [x] 5.3 手动 `cardsRun` 改为调 `startCardRun`、行为不变(全量 1205 测试绿);手动可超上限(排程仅在活跃<3 时填、绝不中止)

## 7. 附带修复:复用空窗口绑定项目后渲染层不刷新（空屏）（测试先行）

- [x] 7.1 `src/main/windows.test.ts` 写红:`WindowManagerOptions.notifyBound` —— `openOrFocus`/`bindWindow` **复用空窗口绑定**时以该窗口回调 `notifyBound`;`openProject`(新开窗口)与 `openOrFocus` 聚焦**已绑定**窗口时**不**回调
- [x] 7.2 `src/main/windows.ts`:`bindWindow` 绑定后调 `this.opts.notifyBound?.(win)`,转绿
- [x] 7.3 接线:`src/shared/ipc.ts` 加 `projectBound` 通道;`src/main/index.ts` 注入 `notifyBound → win.webContents.send(IPC.projectBound)`;`src/preload/index.ts` 加 `onProjectBound`(同 `onThemeChange` 形态);`src/shared/types.ts` `KlaritApi.onProjectBound`;`src/renderer/src/App.tsx` 订阅 `onProjectBound → refresh()+refreshActiveWorkflow()` 并在卸载时解绑
- [x] 7.4 `npm run typecheck` 绿;`windows.test.ts` + `preload/index.test.ts` 绿;dogfood 实机验证"从管理窗口点项目/导入项目"复用空窗口后正常显示、不空屏

## 8. 看板实时反映自动启动（渲染层重载防竞态）（测试先行）

- [x] 8.1 `src/renderer/src/stores/cards.test.ts` 写红:并发两次 `load()`——先发起的一次**较晚返回**且携旧数据 → 最终 store 为**后发起**那次的新数据(旧的被丢弃、不覆盖);单次 `load` 正常生效
- [x] 8.2 `src/renderer/src/stores/cards.ts`:`load()` 加单调序号(`++loadSeq`),取数后若 `seq !== loadSeq` 则 return 不 `set`,转绿
- [x] 8.3 诊断(CDP 直连渲染层):`listCards()` IPC 已返回"进行中",但看板 React 态仍"未开始"→ 根因是**异步自动启动后没有任何 `load()` 触发**(引擎 `node-enter` 只回灌断点不刷卡状态、初始 running 无独立 state 事件),防竞态 `load` 无法覆盖"根本没触发"
- [x] 8.4 `src/shared/ipc.ts` 加 `cardsChanged` 通道;`src/main/index.ts` 在 `startCardRun`(手动/自动共用接缝)置卡链后**广播 `cardsChanged` 给所有窗口**;`src/preload/index.ts` 加 `onCardsChanged`;`src/shared/types.ts` `KlaritApi.onCardsChanged`;`src/renderer/src/App.tsx` 订阅 → `load()`(离开陈旧"未开始");`App.test` mock 补 `onCardsChanged`;typecheck + 全量 1190 测试绿
- [x] 8.5 实机验证(CDP + 肉眼):并发自动启动多张卡,看板**无需手动刷新**即全部上板(用户确认通过)

## 6. 收尾

- [x] 6.1 无新增用户可见 UI(排程静默、降级内部消化)→ 无 i18n / 令牌改动
- [x] 6.2 `npm run typecheck` 绿 + `npx vitest run` 全量 1205 测试绿
- [x] 6.3 `openspec validate auto-run-todo --strict` 通过
