## Why

人工评审门是失败矩阵里最后一个没盖上的格子:走到门只发得出「通过」,**驳回没有出路**——`buildManualGateDecision()` 压根不给自由输入框(`decisions.ts:139`),`RunDecisionPanel` 便无从渲染。B2/B3 明确把「打回连同回退基建」留了后续。本 change 把这条路补上:用户在评审门写下不满意的点 → AI 溯源定位问题最早在哪个节点产生 → 回到那个节点**在现有进展上修复**。它同时引入第一个「只读判定 agent」,是往三层 agent 模型上两层迈的第一步,但不背整套对话 UI 的包袱。

## What Changes

- **评审门开驳回入口**:人工评审门决策由「只发通过」扩为「通过 + 驳回(带自由输入框)」。用户在自由框写不满意的点即触发回退判定。
- **只读回退判定 agent**:驳回时新起一个**只读** agent(单需求 agent 的首个纵切:只读、scope 到一张卡),读驳回意见 + 产物溯源上下文,提名问题最早所在节点(**主选 + 若干备选**),写进握手决策。它复用 heal 家族的拉起形态,但**只读**(prompt 不给可写范围/产出)、**不跑越界检测、不做每节点提交**。
- **产物溯源派生视图**:新增 `deriveLineage(bp, git)` 纯函数——声明式产出以 `node.outputs[].path` 归节点、代码隐式产出以 `git diff startSha..commitSha`(断点里每仓一对 SHA,已就位)的改动文件归节点。**不新建持久化存储**,是运行断点数据的派生视图,喂给判定 agent 当上下文。
- **回退确认决策**:判定结论渲染成一个回退确认决策(复用既有决策面板的 options/input:主选+备选节点 + 自由输入可重唤判定),交用户确认;确认前记录当前**最远进展节点**。
- **回退 = 重入,不是重置**:确认后引擎把当前节点拨回目标节点 K,`phase=executing`,**不 git reset、不撤下游代码、不清 ≥K 记账**。续接 K 的执行者(复用 `agentRuns[K].session`),注入「已推进到节点 N、驳回意见 X、请在现有进展上前向修复」。`drive()` 从 K 前向重流回评审门复审——沿途 `ensure-*` 节点(建分支/开 worktree/合并)幂等 noop 复用已建资源,agent 节点续接自适应,门重校验。

**明确留后续(不在本 change)**:
- 「回退 = 重置到节点起始态、作废下游重生」的重模型——需要时另起 change。
- DAG 版「最早公共祖先」判定(当前工作流线性,最早 = index 最小)。
- 判定 agent 的对话 UI / 每卡常驻 / 用户主动咨询入口(单需求 agent 完整体)。
- command 节点隐式产物入图(先只覆盖 agent 代码产物 + 声明式产出)。

## Capabilities

### New Capabilities
- `content-driven-rollback`: 人工评审门驳回 → 内容驱动回退的完整闭环——驳回入口、只读回退判定 agent、产物溯源派生视图、回退确认决策(主选+备选)、重入目标节点前向修复(不重置、复用下游)、最远进展节点记录。

### Modified Capabilities
- `engine-execution`: `decide()` 新增「source 以 `:manual-gate` 结尾 + 有自由输入」路由(拉起只读判定 agent);人工评审门决策由「只通过」扩为「通过 + 驳回」;`RunBreakpoint` 新增 `furthestNodeId` 与回退判定 agent 记账键;确认后重入(`currentNodeId` 回拨 + 修复前向续接注入 + `drive()`)。
- `agent-prompt-assembly`: 新增 `rollbackJudgmentTask()`(只读回退判定任务段)与「修复前向续接」注入段。
- `node-failure-heal`: 失败矩阵「人工驳回」一类由「留后续」落地为内容驱动回退;判定 agent 复用 heal 拉起形态,但只读、不提交、其输出是回退决策而非代码修改。
- `requirement-card-detail`: 单卡决策面板由「选项即点即生效 + 输入各自提交」改为**统一「选中 + 提交」**模型(选项可选中、唯一提交按钮、选项详情常显在下方、推荐仅多选项时标注、无「原因：」标签);提交异步期间显式「处理中」态(保留选中、锁面板,不空白死等)。对齐 `docs/failure-handling.md` §2.1。

## Impact

- **渲染层零改**:回退确认决策复用 `RunDecisionPanel` 既有的 `options`/`input` 渲染;评审门决策只是补上 `input` 字段(面板 `input` 存在即渲染)。
- **不碰 git 写侧**:重入不做 `reset`,靠拨 `currentNodeId` + 续接 + `ensure-*` 幂等复用;`git-write-operations` 无改动。
- **代码**(预估):
  - `src/main/engine/decisions.ts`:评审门决策加 `input` + 「驳回」选项;新增回退确认决策构造器(主选+备选节点)。
  - `src/main/engine/engine.ts`:`decide()` 加 `:manual-gate + freeText` 分支拉起判定 agent;确认后重入执行(回拨 `currentNodeId`、注入修复前向续接、`drive()`)。
  - `src/shared/agent-prompt.ts`:新增 `rollbackJudgmentTask()` + 修复前向注入段。
  - `src/main/engine/lineage.ts`(新):`deriveLineage(bp, git)` 纯函数。
  - `src/main/index.ts`:判定 agent 的只读 prompt 拼装(`prepareRollbackJudge`,`assembleAgentPrompt` 传 `writableScope=[]`/`outputs=[]`)。
  - `src/shared/types.ts`:`RunBreakpoint.furthestNodeId`;判定 agent 记账(`healRuns` 键新增一类,如 `<nodeId>:rollback-judge`)。
- **前置**(均已归档):`add-engine-execution-spine`(阶段状态机/断点/`ensure-*` 幂等)、`add-agent-executor`(runner/续接阶梯/握手/scopeGuard/每节点 `startSha`+`commitSha`)、`requirement-decompose-skill`(global-agent 最小接缝先例)。
- **文档**:已同步更新 `docs/project-goals.md`「内容驱动回退」与 `docs/failure-handling.md` §5.2/§6.6 为重入模型,本 change 须与之一致。
- **测试**(先行):判定路由(`:manual-gate + freeText` → 判定 agent)、`deriveLineage` 归属正确、重入后断点手术(`currentNodeId` 回拨 + `furthestNodeId` 记录 + 续接注入)、前向重流经 `ensure-*` 节点复用不重建、只读判定 agent 不提交。PTY/握手用假 adapter + 假握手注入,不依赖真 CLI。
