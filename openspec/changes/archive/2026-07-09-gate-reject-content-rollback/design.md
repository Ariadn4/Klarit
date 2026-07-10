## Context

引擎脊柱(B2)、agent 执行器(B3)已归档,人工评审门能停下、能过门,但**驳回没有出路**:`buildManualGateDecision()`(`src/main/engine/decisions.ts:139`)只发 `pass`、不给 `input`,`RunDecisionPanel`(`src/renderer/src/components/RunDecisionPanel.tsx:47`)因 `input` 缺失而不渲染自由框。docs 与两份归档 proposal 都把「打回连同回退基建」留了后续。

底子已具备,回退基本靠拼装现成机件:

- **断点 SHA 锚点已就位**:`RunBreakpoint.agentRuns[nodeId].{startSha,commitSha}[memberId]`(`src/shared/types.ts`)——每 agent 节点每仓一对 SHA,由 `scopeGuard()`(`src/main/agent/scope.ts`)落库。产物溯源不必新建存储。
- **续接阶梯已就位**:`launchContinuation()`(`src/main/agent/continuation.ts`)优先原生 `--resume`、兜底重建。重入目标节点 = 复用它。
- **ensure-\* 幂等已就位**:`ensureBranch`(已存在 → `reached()` noop)、`ensureWorktree`(路径+分支+目录都在 → 复用)、`ensureMerged`(已是祖先 → noop,否则合并新提交)——`src/main/engine/ensure.ts:56/71/107`。前向重流经这些节点天然复用、不重建。
- **决策面板已泛化**:`EngineDecision{options,input,outputs}` + `RunDecisionPanel` 已能渲染多选项 + 自由输入,回退确认零改渲染层。

## Goals / Non-Goals

**Goals:**
- 人工评审门开出驳回入口(自由输入 + `驳回` 选项)。
- 驳回 → 只读判定 agent 溯源定位最早节点(主选+备选)→ 用户确认 → 重入该节点前向修复,闭环。
- 引入第一个只读判定 agent(单需求 agent 首个纵切),复用 heal 拉起形态但只读、不提交。
- 渲染层零改、不碰 git 写侧。

**Non-Goals:**
- 「回退 = 重置到节点起始态、作废下游重生」的重模型(需要时另起 change)。
- DAG 版「最早公共祖先」(当前工作流线性)。
- 判定 agent 的对话 UI / 每卡常驻 / 用户主动咨询入口(单需求 agent 完整体)。
- command 节点隐式产物入图(先只覆盖 agent 代码产物 + 声明式产出)。

## Decisions

### D1:回退 = 重入,不是重置

确认目标节点 K 后,拨 `currentNodeId=K` + `phase=executing`,续接 K 的执行者注入「修复前向」上下文,`drive()` 前向重流。**不 git reset、不撤下游、不清 ≥K 记账**。

- **为何不重置**(替代:`git reset --hard startSha[K]` 逐仓 + 清下游):重置把下游工作全扔了,违背「让他解决问题、不是重做」;还要处理「目标早于已跑 merge → 撤不掉已进主线的东西」这条破坏性红线。重入不撤任何东西,已跑的合并只是**前向再合一次修复提交**,红线自然消失。
- **为何可行**:ensure-\* 幂等让前向重流复用已建分支/worktree/已并主线;续接阶梯让 K 的 agent 接着原会话在既有 worktree 上改;门重校验兜底下游是否仍成立。

### D2:溯源图是派生视图,不是新存储

`deriveLineage(bp, git)` 纯函数:声明式产出按 `node.outputs[].path` 归节点;代码隐式产出按 `git diff startSha..commitSha` 的改动文件归节点(多仓各自成立)。

- **为何派生**(替代:新建持久化溯源图、每产物记 SHA + 下游边):断点已有全部锚点(每节点每仓 startSha/commitSha),再存一份是重复真相源、要维护一致性。派生现算,零冗余。
- **代价**:`git diff` 现算有开销,但只在驳回这一稀有事件上跑一次,可接受。

### D3:判定 agent 是「只读 heal」,单需求 agent 首个纵切

判定 agent 复用 `spawnHealAgent` 形态(无头拉起 + 握手 + 留痕),但只读:`assembleAgentPrompt(writableScope=[], outputs=[])` + `rollbackJudgmentTask()` 任务段;引擎对它**跳过 scopeGuard/每节点提交**;记账键 `<nodeId>:rollback-judge`。

- **为何单需求而非全局 agent 顶**:判定只需一张卡的产物与分支,单需求 scope 最诚实;用全局 agent 会平白多给全项目可见范围、搞浑层级。
- **为何不做完整单需求 agent**:对话 UI/常驻/咨询入口是大包袱,判定只要一次性吐个决策。仿照 `requirement-decompose-skill` 把 global-agent 做成「最小接缝」的先例,先切一薄片。

### D4:两步决策,`pendingDecision` 接力

评审门驳回决策 → 判定 agent → **新的**回退确认决策,`pendingDecision` 从前者换成后者,随断点持久化跨重启存活。用户在确认决策的自由框再写 → 重唤判定;取消 → 重抛原评审门决策(不丢门)。判定 agent 提名主选+备选,`EngineDecision.options`(每项带 detail/recommended)天然承载。

### D5:最远进展节点显式记录

断点加 `furthestNodeId`,前向推进时更新;回退到更早节点后保留。供修复前向注入告知「之前推进到哪」。虽可由「有记账的最大 index 节点」派生,但用户明确要求记录、且显式字段让续接注入直白,值得一个字段。

## Risks / Trade-offs

- **重入后下游 K+1..N 是否逐节点重流** → 采「前向重流、各节点续接自适应」:因 ensure 幂等 + agent 续接而廉价,门重校验兜底;比「只修 K 跳回门」更稳(K 的改动涟漪能传到下游)。留作实现期可微调的粒度。
- **判定 agent 挑错节点 / 挑得过早** → 用户确认这一步挡着;确认决策给备选 + 自由输入重判;线性工作流「最早 = index 最小」判定简单,误差有限。
- **第三方 CLI 不写握手** → 复用既有「握手缺失即乐观 done」容错;判定 agent 若没吐决策,回退确认拿不到目标 → 退回评审门让用户重试或改口。
- **`startSha` 仅 agent 节点有** → 本能力溯源只认 agent 代码产物 + 声明式产出(已在 spec 明确边界),不依赖非 agent 节点的 SHA;重入也不需要 SHA(不 reset),规避了这个洞。
- **前向重流经已跑 merge → 再合一次** → 若修复提交与主线新变化冲突,落回既有合并冲突自愈(§3.4),非本能力新增风险。

## Migration Plan

纯增量,无数据迁移:`furthestNodeId` 为断点新增可选字段,老断点缺失即视作未记录(回退时退化为不注入「最远节点」一句,不影响正确性)。渲染层零改。回滚 = 撤回本 change 代码,评审门恢复只发 `通过`。

## Open Questions

- 重入后下游重流粒度(逐节点续接 vs 只修 K 跳回门)——倾向前者,实现期据 dogfood 观感定。
- 回退确认决策里备选节点最多列几个 / 判定 agent 是否总给备选——实现期看判定 prompt 产出质量调。
