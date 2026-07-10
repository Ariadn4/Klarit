## MODIFIED Requirements

### Requirement: 人工评审门复用决策回路

**人工评审**门把 SHALL 复用统一决策结构(`sourceKind: 'engine'`):进入该门把时,引擎抛一个决策,运行进入 `waiting-decision`。该决策 MUST 携带**唯一前进选项 `通过`** 与**自由输入框**;选「通过」且未写自由输入则过门进下一阶段。它与失败决策共享同一运行态、同一断点恢复、同一回应入口。

**驳回走内容驱动回退**:**自由输入框即驳回入口**——用户在框里写下不满意的点并提交时,引擎 MUST NOT 过门,而是转入内容驱动回退(拉起只读回退判定 agent → 回退确认 → 重入目标节点前向修复),详见 `content-driven-rollback` 能力。不另设「驳回」按钮(框空时提交禁用,天然保证驳回必带理由)。

#### Scenario: 人工门抛决策并据通过过门
- **WHEN** 执行到一个人工评审门把
- **THEN** 运行进入 `waiting-decision` 并携带唯一 `通过` 选项与自由输入框;用户选「通过」(未写输入)则过门推进

#### Scenario: 写下驳回意见转入内容驱动回退
- **WHEN** 用户在人工评审门自由输入框写下意见并提交
- **THEN** 引擎不过门,转入内容驱动回退

## ADDED Requirements

### Requirement: decide 路由识别评审门驳回

`decide()` MUST 识别「决策 `source` 以 `:manual-gate` 结尾 + 回应含自由输入」这一分支,把它路由到内容驱动回退(拉起只读回退判定 agent),而非按内置前进选项语义(通过/跳过/重试)直接续跑。此路由与既有的「执行阶段失败 + 自由输入 → 处置 agent」「agent 运行时提问 → 续接当前 agent」并列,互不干扰。

#### Scenario: 评审门自由输入路由到判定 agent
- **WHEN** `decide()` 收到 `source` 以 `:manual-gate` 结尾且带 `text` 的回应
- **THEN** 引擎拉起只读回退判定 agent,而非直接过门或跳过

#### Scenario: 非评审门决策路由不受影响
- **WHEN** `decide()` 收到执行阶段失败或 agent 提问来源的自由输入
- **THEN** 仍按既有路由(处置 agent / 续接当前 agent)处理,不误入回退判定

### Requirement: 断点记录最远进展节点与回退判定记账

`RunBreakpoint` MUST 新增 `furthestNodeId` 字段,记录本运行推进到过的最远节点;回退到更早节点后该字段保留,供重入续接注入告知进度。回退判定 agent 的运行状态 MUST 以区别于普通 heal 的记账键(如 `<nodeId>:rollback-judge`)持久化进断点,关软件重开仍可查。

#### Scenario: 前向推进时更新最远进展节点
- **WHEN** 运行推进到一个比 `furthestNodeId` 更靠后的节点
- **THEN** 断点更新 `furthestNodeId` 为该节点

#### Scenario: 回退后最远进展节点保留
- **WHEN** 引擎重入到更早的节点 K
- **THEN** `furthestNodeId` 仍指向回退前的最远节点,不被 K 覆盖

### Requirement: 确认后重入执行

用户确认回退目标节点 K 后,`decide()`(或其调用的重入过程)MUST 把 `currentNodeId` 拨回 K、`phase` 设 `executing`,保留 K..N 各节点的会话续接 token(重锚其越界/提交基线以便前向提交叠加),续接 K 的执行者并注入修复前向上下文,再 `drive()` 前向重流。此过程 MUST NOT 触及 git 写侧的 `reset`。

#### Scenario: 确认回退拨回当前节点并前向重流
- **WHEN** 用户在回退确认决策里选定目标节点 K
- **THEN** 引擎设 `currentNodeId=K`、`phase=executing`,续接 K 的执行者后 `drive()` 前向重流,期间不执行 `git reset`
