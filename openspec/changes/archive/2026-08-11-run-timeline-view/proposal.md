## Why

Klarit 的用户**不读代码**——主界面只在需求层操作，看代码是兜底。那么「这次运行到底干了什么」就必须由界面回答，而现在回答不了：

- 能看的只有 `CommandOutputView` 的**分桶原始输出**（前台命令 / 各后台任务）和 `RunStatusLine` 的**当前状态**。前者是一堆终端字符、后者只有此刻。中间那层「先建了分支，然后 agent 跑了 12 分钟，客观门失败重试两次，停在验收门」——**没有任何地方呈现**。
- 讽刺的是数据早就齐了：`EngineProgressEvent` 已经涵盖 `node-enter`/`node-exit`/`phase`/`skip`/`gate-retry`/`background`/`decision`/`state`，**结构性事件一个不缺**，只是当作实时流推给渲染层用完就扔，从不落盘。运行跑完、软件重开，这条链就没了。

对不读代码的人，这条时间线不是「可观测性锦上添花」，而是**信任的唯一窗口**。

## What Changes

- **运行日志（run journal）落盘**：把 `EngineProgressEvent` 里的**结构性事件**按 runId 追加写入一份 append-only 日志，每条带时间戳。**明确排除 `op-chunk`**——原始输出流已由既有 `output-buffer` 按桶存着，journal 只存「发生了什么」并**引用**桶名，不复制字节。
- **时间线视图（卡详情新页签）**：把 journal 渲染成一条按节点分组的时间线——每个节点一段，含进入/退出时刻、耗时、经历的阶段、跳过原因、门重试次数与原因、后台任务、抛出的决策。点节点展开其**既有输出桶**（复用 `CommandOutputView`，不另写一套输出渲染）。运行结束后仍可回看。

## Capabilities

### Added Capabilities
- `run-timeline`: 运行日志的结构（条目类型、时间戳、桶引用）、落盘与保留、由 `EngineProgressEvent` 派生的写入规则、时间线的按节点分组与展开回看。

### Modified Capabilities
- `requirement-card-detail`: 详情面板新增「运行记录」页签，渲染当前/历史运行的时间线；节点展开复用既有输出分桶回看。

## Impact

- **依赖 / 复用**：建立在 `engine-execution`（`EngineProgressEvent` 全套结构性事件、`output-buffer` 分桶）、`requirement-card-detail`（页签与输出回看组件）之上。**不新增引擎事件**——journal 是既有事件流的消费者。
- **代码**：新增 `src/main/engine/run-journal.ts`（落盘，与 `run-store`/`output-buffer` 同目录同风格）+ `src/shared/run-timeline.ts`（事件→时间线的分组纯函数）；`src/main/engine/engine.ts`（在既有 `emit` 处旁挂 journal 写入）；渲染层新增 `RunTimeline.tsx`。
- **兼容**：journal 是**新增旁路**——不改 `EngineProgressEvent`、不改断点、不改任何现有执行路径。本 change 之前的运行没有 journal，时间线对它们显示「无记录」而非报错。
- **磁盘**：journal 只存结构性事件（每个运行几十到几百条），远小于既有输出桶。保留策略与 `output-buffer` 现行口径一致，不单独发明清理机制。
- **不在本 change**：**token 用量采集与成本聚合**（用户拍板砍掉——我们复用用户订阅跑无头 CLI，用量不等于花钱而是额度，痛感未验证；时间线是本 change 的主体，用量原本只是搭车）、时间线导出、把 `op-chunk` 也纳入 journal。
