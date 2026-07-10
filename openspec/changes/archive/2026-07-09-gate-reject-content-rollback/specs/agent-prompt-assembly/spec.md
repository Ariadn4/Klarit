## ADDED Requirements

### Requirement: 只读回退判定任务段

拼装器 SHALL 提供一个纯函数 `rollbackJudgmentTask(input)`,产出只读回退判定 agent 的 `# 任务` 段正文——告知它是本需求的只读顾问、不改任何文件不写产出;给出用户驳回意见与产物溯源关系;要求判断意见指向的问题最早在哪个节点产生、该回到哪个节点修复(给一个主选节点 + 若干备选),把结论写进握手决策交用户确认;强调回退是回到该节点在现有进展上修复、不重置不作废下游。正文与 `docs/failure-handling.md` §6.6 单一来源。

配合该任务段,只读判定 agent 的完整 prompt MUST 以 `writableScope=[]`、`outputs=[]` 调 `assembleAgentPrompt`,使结果**不含**「可写范围」与「产出」两段(强调只读)。

#### Scenario: 生成只读回退判定任务段
- **WHEN** 以驳回意见与溯源上下文调用 `rollbackJudgmentTask`
- **THEN** 返回的任务段声明只读、要求给出主选+备选回退节点并写进握手,不含任何改代码指令

#### Scenario: 只读 prompt 省略可写范围与产出段
- **WHEN** 以 `writableScope=[]`、`outputs=[]` 及回退判定任务段调 `assembleAgentPrompt`
- **THEN** 拼出的 prompt 不含「可写范围」与「产出」两节

### Requirement: 修复前向续接注入段

拼装器 SHALL 支持在续接注入中生成「修复前向」增量段——告知目标节点执行者:本需求之前已推进到最远节点 N、用户在评审门驳回的意见、请在现有进展(worktree 已有下游改动)上修复,别推倒重来。它与既有的「用户对提问的决定」「失败详情」增量段并列,按情形拼接。

#### Scenario: 拼接修复前向注入
- **WHEN** 引擎重入目标节点并要求续接注入,带最远进展节点与驳回意见
- **THEN** 增量段告知已推进到最远节点、驳回意见,并要求在现有 worktree 进展上前向修复
