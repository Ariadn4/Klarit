## ADDED Requirements

### Requirement: 引擎执行 archive-docs

引擎 ensure 执行器（`runEngineOpForMember`）SHALL 处理 `archive-docs`：读当前成员仓文档登记表 → 按能力派（子）agent → 按 `kind` 路由归档 → 提交文档改动。委派指令由登记表 + 审批过的 habitPrompt/公约合成（比照 `open-pr` 的委派合成）。执行路径 MUST：

- 探测子 agent 能力：支持则按 `ManagedDoc` 分组并行派子 agent，不支持则单 agent 串行；不确定走串行。
- 与 `open-pr` 不同，归档 **提交** worktree 里的文档改动（不丢弃）。
- 兜底：无 agent → `no-agent` 挂起决策；无登记表 → 建表提示挂起；空 `docs[]` → noop 过。

多仓项目每个涉及成员仓各自执行、各自兜底、各自在自己 worktree 提交。

#### Scenario: 执行归档并提交
- **WHEN** `archive-docs` 节点在有登记表、有 agent 的成员仓运行
- **THEN** （子）agent 按 kind 归档文档，改动被提交，节点通过

#### Scenario: 无 agent 走 open-pr 同款挂起
- **WHEN** 运行 `archive-docs` 时无可用 agent
- **THEN** 引擎抛 `no-agent` 决策挂起（比照 `open-pr` 失败路由）

#### Scenario: 空表 noop 过
- **WHEN** 登记表存在但 `docs[]` 为空
- **THEN** 引擎 noop 过节点，不提交、不算失败

#### Scenario: 多仓各归各仓
- **WHEN** 多仓项目的 `archive-docs` 涉及两个成员仓
- **THEN** 每个成员仓读各自登记表、在各自 worktree 归档并提交
