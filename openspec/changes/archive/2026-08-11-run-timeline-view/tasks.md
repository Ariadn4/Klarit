# Tasks

> 设计已定：journal 是既有 `EngineProgressEvent` 的持久化消费者（旁挂 `emit`，排除 `op-chunk`、只存桶引用）；分段按进入次序、回退产生多段。
>
> **用量已砍**（用户拍板）——本 change 只做时间线。

## 1. 运行日志落盘（主进程）

- [x] 1.1 写测试：写入 `node-enter`/`node-exit`/`phase`/`skip`/`gate-retry`/`background`/`decision`/`state` 各一 → 按 runId 可读回、顺序与时刻保留
- [x] 1.2 写测试：`op-chunk` 事件**不入** journal；journal 条目只带桶引用不带输出字节
- [x] 1.3 写测试：读取不存在的 runId → 返回空、不抛
- [x] 1.4 实现 `src/main/engine/run-journal.ts`（append-only，与 `run-store`/`output-buffer` 同风格，含内存版供测试）

## 2. 引擎旁挂写入

- [x] 2.1 写测试：引擎跑一个含跳过 + 门重试 + 后台命令 + 决策的运行 → journal 收全对应条目，且无 `op-chunk` 条目
- [x] 2.2 写测试：journal 写入失败不影响运行推进（旁路永不阻断引擎）
- [x] 2.3 实现：`engine.ts` 既有 `emit` 处旁挂一次 journal 写入（单点，非逐路径埋点）

## 3. 时间线分段（纯函数，shared）

- [x] 3.1 写测试：正常节点 → 一段含进入/退出/耗时/阶段/终局
- [x] 3.2 写测试：回退重入同一节点 → **两段**，按进入次序，不合并
- [x] 3.3 写测试：无 `node-exit`（停在决策 / 进程中断）→ 段标记未结束、按最后事件时刻算耗时、**不丢弃**
- [x] 3.4 写测试：门重试摘要含次数与各次 `cause`/`rerun`；后台任务含结局（stopped/exited/timeout）
- [x] 3.5 实现 `src/shared/run-timeline.ts`（确定性纯函数，「现在」由调用方传入）

## 4. 渲染层

- [x] 4.1 写测试（`RunTimeline.tsx`）：按段渲染节点名/耗时/终局/门重试/后台任务；未结束段有明确标识；空 journal → 「无记录」空态
- [x] 4.2 写测试（`RunTimeline.tsx`）：展开段 → 渲染既有输出分桶组件（断言复用 `CommandOutputView`，非另写）
- [x] 4.3 写测试（`RunTimeline.tsx`）：运行中新事件到达 → 时间线实时追加，无需手动刷新
- [x] 4.4 写测试（`RequirementCardDetail.test.tsx`）：新增「运行记录」页签；默认选中 `activeRunId`；可切历史运行
- [x] 4.5 实现 `RunTimeline.tsx` + 卡详情页签接线 + i18n（语义令牌配色、深浅两套，按 `docs/brand`）

## 5. 收尾

- [x] 5.1 `npm run typecheck` 两套干净、`npm run test:run` 全绿
- [x] 5.2 `npx openspec validate run-timeline-view --strict`
- [ ] 5.3 dogfood：跑一张含门重试与验收门的卡，确认时间线读得懂、耗时对得上
