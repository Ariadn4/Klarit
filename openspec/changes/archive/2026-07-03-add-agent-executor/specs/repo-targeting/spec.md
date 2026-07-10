## MODIFIED Requirements

### Requirement: 上游判定驱动下游目标仓

`target=fromUpstream` 的节点 SHALL 引用一个上游 agent 节点的**结构化输出**,在卡 `repos` 内进一步收窄出成员仓子集(用于运行**中途**动态收窄,区别于卡级的 `card.repos` 分诊)。引用的上游节点 MUST 在本节点之前执行且 MUST 产出结构化涉及仓字段;否则为校验错误或运行期终局失败(落入可见的等待决策,绝不静默卡住)。

**运行时收窄真落地**：上游 agent 节点 `done` 时由引擎从其握手 `repos` 填充的 `upstreamOutputs[nodeId].repos`（见 `agent-execution`「agent 结构化输出填充涉及仓」）SHALL 作为下游 `fromUpstream` 的收窄依据——下游节点解析目标仓子集时取该字段与卡 `repos` 之交。上游未产出涉及仓（握手无 `repos`）时，下游 `fromUpstream` MUST 落入可见等待决策或校验错误，MUST NOT 静默作用于全集。

#### Scenario: 上游判定只动后端,下游据此只建后端
- **WHEN** 上游 agent 节点结构化输出「子集 = [后端 B]」,下游 `create-branch` 节点 `target={fromUpstream: 该 agent 节点}`
- **THEN** `create-branch` 仅对 B 执行,A 不建分支

#### Scenario: 上游 agent 运行时填充涉及仓驱动下游收窄
- **WHEN** 上游 agent 节点 `done`、握手 `repos=[api]`，引擎据此填 `upstreamOutputs[该节点].repos=[api]`，下游节点 `target=fromUpstream`
- **THEN** 下游解析目标仓为 `[api]`（与卡 repos 取交），仅对 api 执行

#### Scenario: 引用的上游节点缺结构化输出
- **WHEN** `fromUpstream` 引用的上游节点未产出涉及仓判定
- **THEN** 保存时校验失败,或运行期表现为可见的等待决策,不静默卡住

### Requirement: 引擎按目标仓子集扇出执行

引擎执行一个节点时 SHALL 先把该节点的 `target` 解析为成员仓子集,再按执行者类型作用于子集：**`engine` 节点对子集中每个成员仓各执行一次**该幂等 ensure 操作（逐成员扇出）；**`agent` 节点用一个 agent 承担整个子集**——把子集各目标仓的 worktree 一并交给这一个 agent 跨仓工作（见 `agent-execution`「agent 节点由一个 agent 跨目标仓工作」），而非每成员各起一个 agent。engine 节点各成员的执行 SHALL 互相独立（某成员失败不阻断其余探测）；agent 节点的越界检测/提交虽由一个 agent 触发，仍 SHALL 按每个目标仓各自成立。两类节点的阶段推进 MUST 等其对子集的作用全部收敛后再依失败归宿处理。

#### Scenario: 引擎节点子集逐成员各执行一次
- **WHEN** `create-branch` 节点 `target=all`,卡 `repos` = [A, B]
- **THEN** 引擎对 A、B 各确保同名分支存在,两者皆达成才推进该节点

#### Scenario: agent 节点子集由一个 agent 跨仓承担
- **WHEN** 一个 `agent` 节点 `target=all`,卡 `repos` = [A, B]
- **THEN** 引擎拉起一个 agent 并把 A、B 两个 worktree 都交给它跨仓工作（非每成员各起一个），完成后推进该节点

#### Scenario: 引擎节点子集中某成员失败进入可见停点
- **WHEN** `engine` 节点扇出执行中成员 B 的操作终局失败、A 成功
- **THEN** 运行进入可见的等待决策(携带是哪个成员、何种失败),绝不静默卡住
