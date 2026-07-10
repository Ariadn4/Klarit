## 1. 溯源派生视图(先行,纯函数最易测)

- [x] 1.1 写 `deriveLineage(bp, git)` 的测试:声明式产出按 `node.outputs[].path` 归节点;agent 代码产物按 `git diff startSha..commitSha` 归节点;多仓各自成立;缺 SHA 的非 agent 节点不入图(用假 git runner 注入 diff)
- [x] 1.2 实现 `src/main/engine/lineage.ts` 的 `deriveLineage(bp, git)`,让 1.1 转绿
- [x] 1.3 补测:同一文件被多节点先后改动时,归属含全部生产节点(供判定 agent 取最早)

## 2. 类型与断点字段

- [x] 2.1 `src/shared/types.ts`:`RunBreakpoint` 加可选 `furthestNodeId`;回退判定 agent 记账沿用 `healRuns`,约定键形如 `<nodeId>:rollback-judge`
- [x] 2.2 断点前向推进时更新 `furthestNodeId` 的测试 + 实现(推进到更靠后节点即更新;回退到更早节点后保留不被覆盖)

## 3. 评审门开驳回入口

- [x] 3.1 测试:`buildManualGateDecision()` 产出的决策含 `input` 字段与 `驳回` 选项,`通过` 仍在
- [x] 3.2 改 `src/main/engine/decisions.ts:buildManualGateDecision()` 加 `input`(自由输入)+ `驳回` 选项,让 3.1 转绿
- [x] 3.3 测试:仅选「通过」无自由输入 → 过门;写了自由输入 → 不过门、转回退(在 `decide()` 层面断言分流,见第 5 组)
- [x] 3.4 补 i18n:`engineDecision.*` 加 `驳回`、评审门自由输入的 label/placeholder(zh + en)

## 4. 只读回退判定 prompt 与拉起

- [x] 4.1 测试 `rollbackJudgmentTask(input)`:任务段声明只读、要求给主选+备选回退节点并写握手、不含改代码指令(正文对齐 `docs/failure-handling.md` §6.6)
- [x] 4.2 在 `src/shared/agent-prompt.ts` 实现 `rollbackJudgmentTask()`,让 4.1 转绿
- [x] 4.3 测试:`assembleAgentPrompt(writableScope=[], outputs=[], task=回退判定)` 拼出的 prompt **不含**「可写范围」「产出」两节
- [x] 4.4 在 `src/main/index.ts` 加 `prepareRollbackJudge`(仿 `prepareHealAgentForRun`,但只读:`writableScope=[]`/`outputs=[]` + 回退判定任务段),经现有 prepare 注入口暴露给引擎

## 5. decide 路由:评审门驳回 → 拉起判定 agent

- [x] 5.1 测试:`decide()` 收到 `source` 以 `:manual-gate` 结尾 + 带 `text` → 拉起只读回退判定 agent(用假 adapter + 假握手注入回退决策);非评审门来源的自由输入仍走既有处置/续接路由不受影响
- [x] 5.2 在 `src/main/engine/engine.ts:decide()` 加该分支,复用 `spawnHealAgent` 形态拉起判定 agent,记账键 `<nodeId>:rollback-judge`
- [x] 5.3 测试 + 实现:判定 agent 退出后引擎**不跑 scopeGuard、不做每节点提交**(与写侧 heal 的确定性差异)
- [x] 5.4 测试 + 实现:判定 agent 全量留痕(完整 prompt + 会话记录 + 握手 + 归宿),键区别于普通 heal

## 6. 回退确认决策

- [x] 6.1 测试:`buildRollbackConfirmDecision()` 把判定握手里的主选+备选节点渲染为 `options`(主选标推荐)、保留自由输入框
- [x] 6.2 在 `decisions.ts` 实现该构造器,让 6.1 转绿
- [x] 6.3 测试 + 实现:抛回退确认决策前,断点已记录当前 `furthestNodeId`
- [x] 6.4 测试 + 实现:对确认决策写自由输入 → 重唤判定 agent 再判一轮
- [x] 6.5 测试 + 实现:取消回退确认 → 重抛原评审门 `通过`/`驳回` 决策,门不丢失

## 7. 重入执行(前向修复,不重置)

- [x] 7.1 测试:确认目标节点 K → `currentNodeId=K`、`phase=executing`、index ≥ K 记账保留、**无任何 git reset 调用**(断言 git write runner 未被调 reset)
- [x] 7.2 实现重入过程(在 `decide()` 或其调用的重入函数里),让 7.1 转绿
- [x] 7.3 测试 `rollbackForwardInject`:续接 K 的执行者时注入「已推进到 `furthestNodeId` + 驳回意见 + 在现有进展上前向修复」增量段
- [x] 7.4 在 `agent-prompt.ts` 实现「修复前向续接」注入段(与既有「用户对提问的决定」「失败详情」并列),让 7.3 转绿
- [x] 7.5 测试:重入后 `drive()` 前向重流经建分支/开 worktree 节点 → ensure noop 复用、不重建(用临时仓 + 假执行器验证 `ensureBranch`/`ensureWorktree` 走 `reached()`)

## 8. 端到端契约与文档一致

- [x] 8.1 引擎级契约测试:评审门驳回 → 判定(假握手给目标节点)→ 确认 → 重入 K → 前向重流回评审门再抛决策(全程假 adapter/假握手,不依赖真 CLI)
- [x] 8.2 跨重启:抛回退确认决策后 kill 进程重启,`getRunState` 仍见该 `pendingDecision` 与 `furthestNodeId`,确认后继续重入
- [x] 8.3 核对实现与 `docs/project-goals.md`「内容驱动回退」、`docs/failure-handling.md` §5.2/§6.6 的重入模型一致(已更新,若实现期有偏差回改文档)
- [x] 8.4 `npm run typecheck` + `npm run test:run` 全绿
- [x] 8.5 dogfood(`npm start`):建卡 → 激活含 agent 节点 + 人工评审门工作流 → 跑到评审门 → 驳回写意见 → 判定提名节点 → 确认 → 看重入前向修复回到评审门复审
