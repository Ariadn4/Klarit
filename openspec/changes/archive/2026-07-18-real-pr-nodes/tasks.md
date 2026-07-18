## 1. git 写侧:合并核查原语（已完成）

- [x] 1.1 `git-write.test.ts` 覆盖:已并入基分支 / 上游 gone → merged；两者皆否 → not-merged；fetch 失败 → 结构化失败不抛
- [x] 1.2 `git-write.ts` 实现 `checkBranchMerged`（只读、只 `fetch --prune`），转绿——**保留,现改由外部门 `pr-merged` 用**

## 2. 撤销上一版 overreach（把「verify 作节点 / 泛化回退」拆掉）

- [x] 2.1 `workflow.ts`:从 `ENGINE_OPERATION_SPECS` **移除 `verify-pr-merged`**（不再是引擎操作）；相关测试断言改回
- [x] 2.2 `engine.ts`:移除 `runEngineOpForMember` 里的 `verify-pr-merged` case 与 `pr-not-merged` 挂起路径
- [x] 2.3 `decisions.ts`:移除 `verify-pr-merged`（`prNotMerged`）失败决策分支（其文案/语义迁到外部门决策）
- [x] 2.4 **不动** `decide()` 里普通引擎决策的自由文本路由、**不删** `runDispositionAgent`（此前计划的泛化回退/删处置整块作废）

## 3. 门把数据模型加 `external` 门类（测试先行）

- [x] 3.1 `workflow.test.ts` 写红:`WorkflowGateItem` 支持 `{ kind: 'external', verify: 'pr-merged' }`；`validateWorkflow` 接受合法外部门、拒空/不支持的 `verify`；`repairWorkflow` 保留合法外部门、丢非法；`migrateWorkflowShape` 对新形状幂等、读旧包不崩
- [x] 3.2 `types.ts` 给 `WorkflowGateItem` 加 `external` 判别支（`verify: 'pr-merged'`，可扩展）
- [x] 3.3 `workflow.ts` 的 `validateGate`/`repairGate`/`migrateGateItem` 处理 `external`，转绿

## 4. 引擎操作集:加 `open-pr`（supportsGate=true）（测试先行）

- [x] 4.1 写红:`ENGINE_OPERATIONS` 含 `open-pr`、**不含** `verify-pr-merged`（9 项）；`open-pr` 能力 `supportsGate=true`、另两项否；未知操作仍回落三否
- [x] 4.2 `ENGINE_OPERATION_SPECS`:`open-pr` 用「gate 能力」档（同 push-branch），转绿

## 5. 写工作流 skill（测试先行）

- [x] 5.1 写红:`buildAuthorWorkflowSkill()` 含 `open-pr`、门把三类（含 `external`），并讲清「引擎操作可由 agent 支撑」「open-pr 逐仓/平台无关」「外部门等平台合并、打回即回退」
- [x] 5.2 skill 从门把类型集 + 操作集自动合成新增内容，转绿（单一来源、不手写漂移）

## 6. 内置「真 PR」工作流（外部门 on open-pr）（测试先行）

- [x] 6.1 写红:`createRealPrWorkflow(id)` 交付段 `push-feature → open-pr〔external gate: pr-merged〕→ remove-worktree → delete-branch`；**不含 `merge-branch`、不含 verify 节点**；过 `validateWorkflow` 与 `checkBranchPairing`；节点名双语；open-pr 节点带 `external` 门
- [x] 6.2 `workflow.ts` 实现（复用 `defaultPrelude`/`engineNode`），转绿
- [x] 6.3 接入空库种入（`index.ts` 三默认之一）

## 7. 引擎:open-pr 委派 agent（测试先行，大部分已成，微调）

- [x] 7.1 写红/沿用:`open-pr` 节点级委派 agent（`openPrAgentNode` → `runAgentNode`，多仓布局）；无 `prepareAgent` → 终局失败决策、非静默跳过
- [x] 7.2 保留既有实现;`OPEN_PR_INSTRUCTION` 幂等「先查再开」约束在指令文本里
- [x] 7.3 **不产生代码提交（dogfood 暴露）**：`runAgentNode` 加 `commitChanges` 选项，open-pr 传 `false` → 跑完把 worktree 回到起始 SHA、丢弃改动、不提交；否则会多出没进 PR 的本地提交、让「已合并」核查误判。单测覆盖

## 8. 引擎:外部门执行（测试先行）

- [x] 8.1 写红:执行到 `external`(`pr-merged`)门 → 跑 `checkBranchMerged` 逐涉及仓；全达成 → 过门推进清理；未达成 → `waiting-decision` + 前进式「开始收尾」决策（`sourceKind=engine`，带自由输入框）
- [x] 8.2 写红:点「开始收尾」= 再核查（达成才过门；仍未达成则再次挂起本外部门——不盲信用户点击）
- [x] 8.3 `engine.ts` 门处理分支（`bp.phase.kind==='gate'`）加 `external` 支:核查→过门/挂起；`decisions.ts` 加外部门挂起决策（复用「开始收尾」文案）
- [x] 8.4 断言:合并后点「开始收尾」→ 过门 → 清理 → done

## 9. 引擎:外部门打回 → 内容驱动回退 + 回退回落 origin-aware（测试先行）

- [x] 9.1 写红:外部门自由输入写反馈 → 起只读回退判定 agent（stub 提名 `implement`）→ 回退确认 → 重入 `implement`（复用人工评审门同一 `runRollbackJudge` 链路）
- [x] 9.2 写红:回退无候选/取消，且发起自外部门 → **重抛本外部门**「开始收尾」（不是评审门）
- [x] 9.3 `decide()`:门驳回自由文本的回退发起从「仅 `:manual-gate`」扩到「也含外部门」；把 `raiseManualGate` 一般化为按当前门 `kind` 分派的 `raiseGate`，各回落点改用之
- [x] 9.4 回归:既有**人工评审门驳回→回退**链路测试仍全绿（origin-aware 改动未回归评审门路径）

## 10. i18n 与收尾验证

- [x] 10.1 en/zh:外部门「PR 确认已合并后，点击以进行收尾工作」标题 + 「开始收尾」按钮 + open-pr 无 agent 提示（复用/迁移既有键，去掉已废的 `pr-not-merged` 相关）
- [x] 10.2 `npm run test:run` 全绿；`npm run typecheck` 两套 config 均过；`npm run build` 三端通过
- [x] 10.3 `npm start` dogfood（已跑通）:真 PR 工作流 → open-pr（回报 PR 裸链接、不产生代码提交）→ 外部门（未合并挂起、「开始收尾」核查失败给「检测到尚未合并」反馈）→ 平台合并 → 「开始收尾」过门 → 删 worktree/分支 → done
- [x] 10.4 复核动态文档（`docs/failure-handling.md` 等）只记最新现状；`npx openspec validate real-pr-nodes --strict` 通过

## 11. open-pr 回报 PR 链接、外部门决策可点击跳转（测试先行）

- [x] 11.1 写红:open-pr agent 握手带 `prs:[{repo,url}]` → 持久化断点 `prLinks` + 外部门决策带 `links:[{label,url}]`
- [x] 11.2 `types.ts`:`AgentHandshake.prs`、`RunBreakpoint.prLinks`、`EngineDecision.links`；API 加 `openExternal`
- [x] 11.3 `engine.ts`:`runAgentNode` 捕获 `hs.prs`→`bp.prLinks[node]`；`raiseGate` 把 `prLinks` 传给 `buildExternalGateDecision`（→ `links`）；`OPEN_PR_INSTRUCTION` 与握手协议文档写明 `prs` 字段，转绿
- [x] 11.4 IPC `shell:openExternal`（main 只放行 http(s)）+ preload 暴露；`RunDecisionPanel` 渲染 `decision.links` 可点击 → `window.klarit.openExternal`；i18n `prLinks`
- [x] 11.5 **兜底（dogfood 暴露）**：`shared/pr-links.ts` 的 `scrapePrUrls`/`collectPrLinks`——agent 把链接写进 `note` 散文而非 `prs` 时也能捞出（正则认 `/pull/n`、`/merge_requests/n` 等）；单测覆盖；engine 捕获改用 `collectPrLinks(hs.prs, hs.note, hs.detail)`
