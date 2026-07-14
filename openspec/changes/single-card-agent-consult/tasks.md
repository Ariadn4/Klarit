# Tasks

测试先行（先红后绿；用假只读单卡 agent 注入三岔输出、假 orchestrate 返提案，不依赖真 CLI）。每组按依赖排序。

## 1. 共享层：三岔输出 + 干预 op + 咨询契约

- [x] 1.1 加类型 `CardAgentTurn`（判别联合：`{reply}` / `{reply, interventions}` / `{reply, upshift{intent}}`）与干预 op 联合 `CardIntervention`（pause/resume/reenter{nodeId,指令?}/inject{指令}/adjustCard{patch}），节点以 id 引用（写测试锁定序列化往返）
- [x] 1.2 写单卡咨询 prompt 契约（自由对话·技能内联：查进度/干预/上抛塑造需求；只读红线；输出格式），供解析单一来源（先测试 prompt 装配含三类技能与只读说明）
- [x] 1.3 写三岔输出解析器 `parseCardTurn`（优先结构化 JSON 取 reply/interventions/upshift；退而整段当 reply；容错收敛干预 op），先测试各分支

## 2. 共享层：只读读上下文装配

- [x] 2.1 写读上下文装配纯函数 `buildCardConsultContext`（活现状 + 运行断点摘要 + `renderLineage` 溯源 + 各仓分支 diff 概要），diffNames/断点注入式，先测试
- [x] 2.2 预算截断（分支 diff 优先截）+ 显式标「省略 N…」，先测试超预算路径
- [x] 2.3 未运行卡（无 activeRunId）上下文：给活现状 + 标明尚未运行，先测试

## 3. engine：用户可发起干预入口

- [x] 3.1 把 `reenterFromRollback` 提为公开 `engine.reenter(runId, targetNodeId, 指令)`：加节点存在校验（非真实节点拒绝）；复用同一重入实现（不复制），先测试重入不重置 + 非法目标拒绝
- [x] 3.2 加 `engine.inject(runId, 指令)`：设当前执行节点 pendingAnswer + 重跑 executing；无可注入节点优雅无操作，先测试注入重跑与无操作
- [x] 3.3 干预活跑运行先安全挂起：`reenter`/`inject` 检测活 drive → 复用 pause 边界落 paused 再改断点再 drive；已 parked/paused 直接改，先测试活跑与已挂起两态
- [x] 3.4 回归测试：既有 `:rollback-confirm` → 重入路径行为不变（两条发起路径复用同一重入）

## 4. 咨询核：单卡 agent 服务

- [x] 4.1 写咨询核 `createCardConsultSeam`（注入 deps：读上下文 provider + 假 producer）：意图→三岔（reply/interventions/upshift），先测试三岔全链路（假 producer）
- [x] 4.2 干预映射：interventions → 引擎方法/`cardsUpdate`（pause/resume 直接、reenter/inject/结构改动标破坏性待确认），先测试映射与破坏性标记
- [x] 4.3 upshift → 转调 `orchestrate(intent, projectId)` 得 ops 提案（假 orchestrate 返固定提案），先测试上抛链路与「单卡不产卡操作」
- [x] 4.4 优雅降级：未配置/失败/不可解析 → 只回复 + 可读提示、无干预无上抛，先测试
- [x] 4.5 真实只读 producer：复用脱 worktree、只读续接 runner（仿 orchestrate-producer），解析三岔；注入式（真 runner 桩测试，不触真 CLI）

## 5. 每卡会话持久化

- [x] 5.1 card-conversations 桶：复用 `conversation-store` 指向 `userData/card-conversations`，scope=projectId、id=cardId；打开=get-or-create 同一会话，先测试「同卡续同一会话、不可多开」
- [x] 5.2 与全局对话物理隔离：卡会话不入全局 `list`、全局会话不入卡咨询，先测试隔离
- [x] 5.3 多轮原生续接：复用 `launchContinuation` 阶梯（sessionId 桥接卡会话），先测试续接接上/回落重建

## 6. 门自由输入分类前置（上抛接线）

- [x] 6.1 分类旁路 IPC（不消费决策）：把门/失败决策自由输入交单卡 agent 分类；塑造需求 → orchestrate 出提案、**不调 decide**（门仍 pending）；先测试「上抛不消费门」
- [x] 6.2 门语境反偏置：歧义→留本地（当驳回/处置）；仅明确塑造需求引流，先测试偏置
- [x] 6.3 回归：明确驳回仍走 `runRollbackJudge`、失败自由输入仍走 `runDispositionAgent`（既有 decide 路由零改），先测试

## 7. IPC / preload

- [x] 7.1 单卡对话通道：每卡会话 get-or-create、发消息（跑咨询核一轮）、编辑/重试（复用 truncate）、选 agent/模型
- [x] 7.2 干预应用通道：`engineReenter`/`engineInject`（破坏性确认在渲染层）+ pause/resume/cardsUpdate 复用
- [x] 7.3 上抛提案应用：复用 `applyOps`；门分类旁路通道
- [x] 7.4 preload 暴露 + 类型；先测试主进程 handler 契约

## 8. 渲染层：卡详情面板咨询区

- [x] 8.1 咨询区组件：复用全局对话面板消息列表/输入/复制；一卡一会话（无「新建」）；与决策区并列
- [x] 8.2 查进度作答呈现（reply）；纯咨询轮空回复不留占位（复用全局对话行为）
- [x] 8.3 本卡干预确认流：暂停/恢复直接执行；倒回 K/就地注入/结构改动破坏性二次确认后经 IPC 执行
- [x] 8.4 上抛 ops 提案审阅：复用 `card-ops-review-apply` 组件，applyOps 确认后刷看板
- [x] 8.5 遵 `docs/brand` 语义令牌、深浅双主题、i18n 文案

## 10. 清空该卡会话（增量）

- [x] 10.1 conversation-store 加 `clearMessages(projectId, id)`：消息清空 + 清 sessionId、保留 agentId/model/title；先测试（会话/消息保留元数据、断续接）
- [x] 10.2 IPC `cardConsultClear` + preload + KlaritApi + 主进程 handler（scope 本卡）
- [x] 10.3 咨询区「清空对话」入口 + 内联二次确认 → 调 clear → reload 回空态；先测试（确认前不清、确认后清空且回空态）
- [x] 10.4 i18n（zh/en）文案；语义令牌、深浅双主题

## 11. 消息底部操作（复制/编辑/重试）+ 打断思考（增量）

- [x] 11.1 消息底部操作条（复用全局对话 patterns、顺序复制→编辑→重试）：所有消息「复制」（含提案/干预可读描述）、仅最新用户消息「编辑」「重试」；先测试呈现与调用（编辑走 dropLastCardConsultTurn 回填、重试走 retryLastCardConsult）
- [x] 11.2 咨询 producer 可中止：`createCardConsultProducer` 注册当前 launch 的 kill；index.ts 按 cardId 存 kill；IPC `cardConsultAbort` + preload + api；先测试 producer 注册/清理与 abort 杀进程
- [x] 11.3 咨询区「停止」入口：思考中显示，点击调 abort → 回可输入态；先测试（busy 时显停止、点击调 abortCardConsult）
- [x] 11.4 i18n（zh/en）+ 语义令牌、深浅双主题

## 9. 收尾与验收

- [x] 9.1 `npm run typecheck`（node + web 两套）全绿
- [x] 9.2 `npm run test:run` 全绿（含新单测 + 既有回退/处置回归）
- [ ] 9.3 dogfood（`npm start` 不监听源码）：跑到一半的卡开对话 →① 问进度得答复；② 倒回节点 K 并注入→确认→引擎回退+K 重做；③「还要加个需求 X」→上抛→orchestrate 建卡提案→applyOps→看板新卡出现
- [ ] 9.4 `/opsx:archive` 同步增量 spec 到主 specs
