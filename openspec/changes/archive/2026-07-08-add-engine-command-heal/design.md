## Context

引擎脊柱(`add-engine-execution-spine`)、命令执行器(`add-command-executor`)、运行绑卡、多仓扇出、agent 执行器(`add-agent-executor`)均已归档。当前 `engine.ts` 的 `drive()` 里:`agent` 节点真跑、agent 节点自愈已就位;`engine`/`command` 节点的技术失败**直接抛人工决策**——`merge-branch` 冲突走 `decisions.ts:mergeConflict`「放弃合并,跳过该节点」(有损)、命令非零走 `commandFailed`、命令节点客观门报错走 `gateFailed`。失败四归宿的第 3 类「交给 agent 自愈」在引擎脊柱里明确留了口子(`sourceKind`),但**引擎/命令节点未接**——那时无 agent,冲突/测试挂在纯 git 流程里不会自然发生。B2 落地后这些失败会真发生,正是点火时机。

现成可复用(B2):`src/main/agent/{runner,adapter,handshake,continuation,scope}`——无头拉起、握手判 done、续接阶梯、`scopeGuard`(独立函数:diff-since-startSha → 还原越界 → `git add && git commit` → 返回 commitSha,**空 writableScope = 整树可写**,且 `MERGE_HEAD` 在时该 commit 自动成合并提交)。`EngineDeps.runAgent`/`readHandshake` 注入口子供假替身测试。断点 `AgentNodeRun{session,attempts,lastFailure,startSha,commitSha}` 形态、`MAX_AGENT_HEAL=3` 常量现成。

底层现状关键点:`git-write.ts:mergeBranch` 冲突时**立即 `git merge --abort`** 再返回 `conflict`;`ensure.ts:ensureMerged` 在**主检出**(`repoPath`)`checkout into` 后合并;`runEngineOp` 已逐成员 for 循环扇出、失败带 `[memberId]` 标签、返回首个失败。

完整目标设计(含留后续部分)记于 `docs/failure-handling.md`,是单一来源。

## Goals / Non-Goals

**Goals:**
- 引擎/命令节点技术失败(合并冲突、命令主命令非零、命令节点客观门非零)**先自动 heal**:拉临时读写 agent → 改/解 → 引擎提交 → 幂等重跑验证 → 收敛;限次 → 超限回落**既有人工决策**(文案不变)。
- 合并冲突**在卡分支上解**:把主线并进卡分支(卡工作区)→ heal → 快进合回主线;多仓**逐仓** heal、各仓独立。
- `mergeBranch` 增「保留冲突态」模式;默认契约不变。
- **除人工评审门外**的决策恒带自由输入;提交后:有当前 agent 注入当前 agent、**无当前 agent 新起读写处置 agent**;人工评审门本轮不渲染自由输入。
- 观测:所有 agent 全量留痕 + 输出框展示完整 prompt。
- 交付验收工作流 + 测试项目。

**Non-Goals:**
- **人工评审门驳回**的只读回退 agent(内容驱动回退)、决策**跨卡升级**、用户主动唤起入口——留后续(`docs/failure-handling.md` 作目标设计先摆着)。
- 命令**超时** heal、**engine 节点客观门**报错 heal(引擎操作无代码可改)——不接。
- 改 agent 节点自愈(B2 已做)、subworkflow(仍跳过)、node-pty、模型/后端接入。

## Decisions

### D1:合并冲突「在卡分支上解、快进合回」,不碰主线、不新建隔间
冲突的本质是「卡分支的改动」和「主线的改动」撞同处。故反过来:在**卡自己已隔离的工作区**里 `git merge <主线>`,让冲突落在卡分支这边,heal agent 就地解;解完卡分支已消化主线,**再合回主线是干净快进**。主线全程没被碰过——heal 搞砸了把卡分支重置回动手前即可,主线安然。多仓时每成员仓在**各自卡工作区**独立走一遍。
*备选*:①在主检出直接解——否决(agent 跑在主检出,不隔离、逆 project-goals「agent 限定在卡工作分支」);②新建 scratch worktree 隔离——否决(卡工作区本就隔离,多余管道)。

### D2:`mergeBranch` 加「保留冲突态」模式,默认契约不变,延迟 abort 归引擎
`git-write.ts:mergeBranch(run, from)` 默认仍「冲突即 `--abort` 回干净态」(纯原语契约、`git-write-operations` spec 不破)。新增可选 `{ leaveConflict }`:冲突时**不 abort**、返回 `conflict` 且 `MERGE_HEAD` 存活。引擎在「有 heal 且未超限」时用该模式(在卡工作区把主线并进来);**延迟的 `--abort` 由引擎在 heal 超限时补**(重置卡分支回动手前)。责任跨两层但只在这一条调用路径,注释锁清。
*备选*:改默认行为——否决(破坏既有纯 git 流程与 spec 不变量)。

### D3:heal 只解/改不提交,引擎用 `scopeGuard` 确定性提交 + 幂等重跑验证
heal agent **只**把冲突文件改到无冲突 / 把代码改到命令能过,**不自己提交**(对齐 B2「还原不靠 agent 自觉、引擎确定性提交」)。引擎随后:
- **合并**:先校验**无残留冲突标记**(`git ls-files -u` 为空)→ 用 `scopeGuard`(整树可写、startSha=并主线前的卡分支 HEAD)在卡工作区提交,`MERGE_HEAD` 在故自动成合并提交 → 卡分支快进合回主线 → 重跑 `ensureMerged` 幂等确认 `is-ancestor`。
- **命令**:`scopeGuard` 提交范围内改动 → **重跑那条命令**;退 0 即过(命令节点客观门则重跑那道门)。
校验是硬标准(标记清空 + 命令退 0),不靠 agent 自述。
*备选*:让 agent 自己 commit——否决(引擎失去确定性提交权;且合并提交作者应是引擎)。

### D4:heal agent = 临时读写后台执行 agent,复用 B2 执行器 + 新 heal prompt 段
经 `runAgent.start`(读写)拉起,cwd = 卡工作区,复用 adapter/握手/续接/`scopeGuard`;prompt = B2 公共输入(生效宪法 + 需求卡 + 引擎交互协议)+ **heal 任务段**(合并 / 命令两版,见 `docs/failure-handling.md` §6.3/§6.4)。heal agent 自己若经握手 `need-decision` 提问,走 B2 现成 `sourceKind='agent'` 决策(落单卡、自由输入注回它),**不新造通道**。重试续接复用 `launchContinuation`。
生命周期临时:一次 heal 尝试对应一次(可续接的)运行;超限即弃。

### D5:逐仓 heal 编排嵌进现有 `runEngineOp` 循环,串行、各仓独立
`runEngineOp` 现逐成员跑 `ensureMerged`。改为:某成员返回 `conflict` 且 heal 可用且该 `(节点,成员)` 未超限 → 就地对该成员跑 heal 子流程(D1–D3),收敛则该成员算过、继续下一成员;超限 → 该成员成为带 `[memberId]` 的失败、按既有路径抛人工决策。串行(单 run 驱动),各成员独立计数,互不影响。已合并成员的幂等性由 `is-ancestor` 探测兜(重跑 noop)。命令节点非多仓扇出,heal 键退化为按节点。
*备选*:并发多仓 heal——否决(要多并发 agent 进程、收益低,串行够用)。

### D6:heal 计数存断点新字段 `healRuns`,复用 `AgentNodeRun` 形态与上限
新增 `RunBreakpoint.healRuns?: Record<string, AgentNodeRun>`,键 `${nodeId}:${memberId}`(命令退化为 `${nodeId}`)。复用 `AgentNodeRun` 的 `session/attempts/lastFailure/startSha` 与 `MAX_AGENT_HEAL=3`,**持久化**(关软件重开不清零)。与节点自身 `agentRuns` 分开,保后者语义干净。超限回落调用**原样**的 `buildFailureDecision`(merge/command)/`buildGateDecision`。
*备选*:塞进 `agentRuns[nodeId]`——否决(engine/command 节点无 agent 语义、且 heal 需逐仓键)。

### D7:路由判别只认三种技术失败,其余全不变
`merge-branch` 的 `outcome==='conflict'`、命令主命令非零退出、命令节点客观门非零 → heal。`GitWriteOutcome` 是干净判别键。其余(push 非快进/无远端/认证、delete 未合并、worktree 占用/脏、超时、engine 节点门报错、link-env/delete-remote 自动类)**一律不变**,不误塞给 agent。

### D8:自由输入铺到除人工评审门外的所有决策;当前 agent 注入 / 无则新起读写处置 agent
`decisions.ts` 除人工评审门(`manualReview`)外的各构造器统一附自由输入(`input`/`freeInput`);渲染层这些决策渲染自由输入框、提交后回 `{ optionId?, text? }`。`engine.decide` 对含自由文本的:
- **当前有 agent 在跑**(agent 节点提问/自愈超限,含正在跑的 heal agent)→ 经**续接注入当前 agent**(复用现有 agent-source 分支)。
- **当前无 agent**(engine/command 失败、客观校验门失败)→ **新起一个读写处置 agent**——复用 heal 执行器形态(读写、cwd = 卡工作区),喂「失败背景 + 用户自由输入 + 帮用户处理:能改就改(不自己提交、引擎提交后重跑验证)/ 不能改就经握手解释并把建议作为新选项交回」的 prompt。它与自动 heal agent 同机器,差别仅在**由用户自由输入触发**、prompt 含用户意见。
**人工评审门**(`manualReview`)本轮**不渲染自由输入框**——其驳回要的是「退回哪个节点」的**只读回退判定 + 内容驱动回退**(需产物溯源图),整套留后续。
*备选*:人工评审门也本轮接——否决(内容驱动回退是独立较大基建,单独一轮);无当前 agent 也不接——否决(用户已确认本轮要做,且 heal 执行器现成、增量小)。

### D9:所有 agent 全量留痕 + 输出框展示完整 prompt
每次 agent 运行(节点 agent / 自愈续接 / heal)存一份运行记录:完整 prompt、增量自存会话转写(复用现有 `op-chunk→outputBuffer` 持久化)、握手内容与 `status`、归宿、所属运行/节点/成员仓、每仓 startSha/commitSha、heal 第几次。**prompt 随记录持久化**(现状 prompt 是即拼未存),渲染层从记录读出、在该 agent 输出框顶部展示。临时 heal agent 同样留痕、同样可见 prompt。

### D10:假 heal agent 测试替身
复用 `EngineDeps` 注入:假 `runAgent`(`start` 副作用把冲突文件写成解决态 / 把命令改到能过,不提交)+ 假 `readHandshake`(返 `done`)。契约测试覆盖:冲突→heal→快进合回、命令挂→heal→重跑过、超限→回落原决策、逐仓 heal、自由输入注入当前 agent、留痕含 prompt。全程不依赖真 CLI(同 B2)。

## Risks / Trade-offs

- **heal 解冲突/改码质量差** → 引擎硬校验(冲突标记清空 / 命令退 0)+ 下游门兜;合并前主线未被碰,搞砸可重置卡分支回动手前,主线零风险。
- **保留冲突态 + 延迟 abort 跨两层** → 局限在引擎 heal 编排一条路径,`mergeBranch` 默认契约不变、注释锁清;超限/异常路径都补 abort 回干净态,绝不留半合并脏索引。
- **决策处置 agent 面对非代码可改的失败**(如 push 无远端、worktree 占用)→ 它经握手解释「非代码能解决」并把处置建议作为新选项交回用户,不硬撑乱改;复用 heal 的「改完引擎提交重跑验证」对这类无对应「重跑操作」的失败退化为「仅答疑 + 提选项」。
- **人工评审门本轮无自由输入框** → 只读回退判定 + 内容驱动回退是独立基建,单独一轮;本轮人工评审门仍只「通过」,不显示自由框、不假装能驳回改派。
- **prompt 落盘增体积** → 复用现有分桶缓冲持久化与容量策略,heal prompt 短。
- **免交互写文件 flag 破坏性** → heal 限定卡工作区(隔离)、只解冲突/改码、引擎提交锁范围;对齐 B2 隔离模型。

## Migration Plan

1. **类型先行(先红)**:`types.ts` 加 `RunBreakpoint.healRuns`、agent 运行记录字段;`git-write` mergeBranch `{leaveConflict}` 参数签名。
2. **git 写侧(先红后绿)**:`mergeBranch` 保留冲突态模式(默认路径测试不变、新模式冲突留 `MERGE_HEAD`)。
3. **heal prompt 拼装**:合并/命令两版任务段纯函数(可预览、确定复现)。
4. **heal 编排(先红后绿)**:`ensureMerged`/`runEngineOp` 逐仓 heal 子流程(并主线→leaveConflict→假 heal→scopeGuard 提交→快进合回→is-ancestor 确认);命令失败/命令门失败 heal(假 heal→提交→重跑验证);超限回落原决策。
5. **计数与持久化**:`healRuns` 记断点、关软件重开续、通过清零。
6. **决策自由输入 + 路由**:`decisions.ts` 除人工评审门外全带自由输入;`decide` 有当前 agent 时注入当前 agent、无当前 agent 时新起读写处置 agent(复用 heal 执行器 + 处置 prompt);人工评审门不渲染自由框。
7. **观测**:agent 运行记录持久化含 prompt;渲染层输出框顶展示 prompt。
8. **typecheck + test:run 全绿**;dogfood 验收工作流 + 测试项目端到端跑覆盖矩阵。
9. **回退**:heal 是纯增量插在「抛人工前」;关掉即恢复今日「直接人工」,不破坏既有路径。

## Open Questions

- 无(六处岔路已与用户逐一敲定;自由输入:除人工评审门外本轮全接——有当前 agent 注入、无则新起读写处置 agent;仅人工评审门驳回的只读回退判定 + 内容驱动回退留后续)。
