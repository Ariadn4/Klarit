## ADDED Requirements

### Requirement: 人工评审门开放驳回入口

人工评审门抛出的决策 MUST 携带唯一前进选项 `通过` 与一个**自由输入框**(`input` 字段)。**自由输入框即驳回入口**:用户在框里写下不满意的点并提交即触发内容驱动回退;仅点 `通过`、不写自由输入则照旧过门。评审门此前只发 `通过`、不带自由框,本能力打开这个入口。**不另设「驳回」按钮**——框空时提交禁用,天然保证「驳回必带理由」(判定 agent 需理由才能判)。

#### Scenario: 评审门决策带唯一「通过」选项与驳回自由输入框
- **WHEN** 引擎执行到一个人工评审门把并抛出决策
- **THEN** 该决策选项仅含 `通过`,并带一个自由输入框供写驳回意见

#### Scenario: 仅通过时照旧过门
- **WHEN** 用户在评审门只选 `通过`、未写自由输入
- **THEN** 引擎过门推进下一阶段,不触发回退判定

#### Scenario: 写下驳回意见触发回退判定
- **WHEN** 用户在评审门自由输入框写下不满意的点并提交
- **THEN** 引擎不过门,转入内容驱动回退(拉起只读回退判定 agent)

### Requirement: 产物溯源派生视图

引擎 SHALL 提供一个纯函数 `deriveLineage(bp, git)`,从运行断点**派生**产物→节点的归属,**不新建独立持久化存储**:

- **声明式产出**按 `node.outputs[].destination.path` 归到声明它的节点。
- **代码隐式产出**按每个 agent 节点 `git diff <startSha>..<commitSha>`(断点 `agentRuns[nodeId]` 每仓一对 SHA,已由 agent 执行能力落库)的改动文件归到该节点;多仓时按成员仓各自成立。

派生结果供回退判定 agent 当上下文。本能力**只覆盖 agent 代码产物 + 声明式产出**;command 节点隐式产物入图属后续。

#### Scenario: 声明式产出归到声明节点
- **WHEN** 某节点声明了产出文件 `PLAN.md`
- **THEN** `deriveLineage` 把 `PLAN.md` 归到该节点

#### Scenario: 代码隐式产出按 SHA 区间归节点
- **WHEN** 某 agent 节点在成员仓从 `startSha` 到 `commitSha` 改动了若干文件
- **THEN** `deriveLineage` 用 `git diff startSha..commitSha` 把这些文件归到该 agent 节点

#### Scenario: 溯源视图不落独立存储
- **WHEN** 引擎需要产物溯源
- **THEN** 结果由 `deriveLineage` 从断点现算,不读写额外的溯源图文件

### Requirement: 只读回退判定 agent

驳回时引擎 MUST 新起一个**只读** agent 判定回退目标,它是单需求 agent 的首个纵切(只读、scope 到当前需求卡):

- prompt 经 `assembleAgentPrompt` 拼装,`writableScope=[]`、`outputs=[]`(不给可写范围/产出段),任务段用只读回退判定文案(读驳回意见 + 溯源上下文,判断问题最早在哪个节点产生、该回到哪个节点修复,给主选 + 若干备选)。
- 它复用 heal 家族的拉起形态(经运行器无头拉起、写握手文件),但 MUST **只读**:引擎对它**不跑越界检测、不做每节点提交**;它的产出是握手里的回退决策,**不是**代码修改。
- 判定 agent 的运行 MUST 全量留痕(完整 prompt + 会话记录 + 握手 + 最终归宿),记账键区别于普通 heal(如 `<nodeId>:rollback-judge`)。

#### Scenario: 判定 agent 以只读 prompt 拉起
- **WHEN** 引擎为驳回拉起回退判定 agent
- **THEN** 其 prompt 不含「可写范围」与「产出」两段,任务段为只读回退判定文案

#### Scenario: 判定 agent 不提交任何改动
- **WHEN** 回退判定 agent 退出
- **THEN** 引擎不对其运行执行越界检测或每节点提交,不产生代码 commit

#### Scenario: 判定结论进握手决策
- **WHEN** 判定 agent 完成
- **THEN** 它把目标回退节点(主选 + 备选)与理由写进握手文件的决策

### Requirement: 回退确认决策

引擎 MUST 把判定 agent 的握手决策渲染成一个**回退确认决策**,复用既有决策面板:

- `options` 承载**主选 + 若干备选**回退节点(每项带节点名与理由);自由输入框保留,用户在此写内容可**重唤判定 agent** 再判一轮。
- 抛出确认决策前,引擎 MUST 记录当前**最远进展节点**(`furthestNodeId`),供重入后的续接注入告知「之前推进到哪」。
- 用户确认某目标节点则执行重入;用户取消则退回原评审门(重新抛出 `通过`/`驳回` 决策),不丢失该门。

#### Scenario: 确认决策以选项呈现主选与备选
- **WHEN** 判定 agent 给出主选节点 + 备选节点
- **THEN** 引擎抛出的确认决策以 `options` 列出它们(主选标推荐),并保留自由输入框

#### Scenario: 确认前记录最远进展节点
- **WHEN** 引擎抛出回退确认决策
- **THEN** 断点已记录当前最远进展节点 `furthestNodeId`

#### Scenario: 自由输入重唤判定
- **WHEN** 用户对确认决策写下新的自由输入并提交
- **THEN** 引擎再次拉起回退判定 agent,据新输入重判

#### Scenario: 取消回退退回评审门
- **WHEN** 用户取消回退确认
- **THEN** 引擎重新抛出原评审门的 `通过`/`驳回` 决策,评审门不丢失

### Requirement: 回退是重入目标节点前向修复,不重置

用户确认目标节点 K 后,引擎 MUST 执行**重入**而非重置:

- 把 `currentNodeId` 拨回 K、`phase` 设为 `executing`;**MUST NOT** 对任何成员仓 `git reset`、**MUST NOT** 撤销下游代码、**MUST NOT** 作废下游已产出。
- **保留会话续接 token** 使 K 及其下游各节点续接原会话(而非从头);为让前向修复的提交在当前 HEAD 上**干净叠加**,MUST 把 K..N 各节点的**越界/提交基线**(`startSha`/`commitSha`)重置到重入时的当前 HEAD——这是内部记账重锚,**不是** `git reset`、不动任何代码或产出。
- 续接 K 的执行者(优先复用 `agentRuns[K].session`),注入「修复前向」上下文:已推进到最远节点 `furthestNodeId`、用户驳回意见、请在现有进展上修复。
- 随后 `drive()` 从 K 前向重流回评审门复审:沿途 `ensure-*` 引擎节点(建分支/开 worktree/关联环境/合并)凭幂等**复用已建资源、noop 收敛,不重建**;已跑过的合并把新的修复提交**前向再合一次、不回撤主线**;agent 节点续接自适应,门重校验。

「回退 = 重置到节点起始态、作废下游重生」是另一种更重的模型,**不在本能力内**;需要时另起 change。

#### Scenario: 重入不重置分支、不撤下游
- **WHEN** 用户确认回退到节点 K
- **THEN** 引擎把 `currentNodeId` 拨回 K 并进入 `executing`,不对任何成员仓执行 `git reset`,下游已产出的代码与提交仍在(判定前的提交仍是当前 HEAD 的祖先),仅重锚 K..N 的越界/提交基线、保留会话续接 token

#### Scenario: 目标节点续接注入修复前向上下文
- **WHEN** 引擎重入节点 K
- **THEN** K 的执行者被续接(复用其会话),prompt 注入「已推进到 `furthestNodeId`、驳回意见、请在现有进展上前向修复」

#### Scenario: 前向重流复用已建分支与 worktree
- **WHEN** 重入后 `drive()` 前向重流经建分支 / 开 worktree 节点
- **THEN** 这些 `ensure-*` 节点探测到资源已存在即 noop 复用,不重建分支或 worktree

#### Scenario: 前向重流回评审门复审
- **WHEN** 修复前向重流抵达原人工评审门
- **THEN** 引擎再次抛出评审门决策供用户复审(可再通过或再驳回)
