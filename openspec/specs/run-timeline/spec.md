# run-timeline Specification

## Purpose
TBD - created by archiving change run-timeline-view. Update Purpose after archive.
## Requirements
### Requirement: 运行日志由既有事件流派生，不新增埋点

系统 SHALL 为每个运行维护一份 **append-only 的运行日志（journal）**，其条目**全部由既有 `EngineProgressEvent` 派生**——在引擎已有的事件发射处旁挂写入。系统 MUST NOT 为 journal 在各执行路径里另插一套埋点调用，以免埋点漏写或与事件流分叉。

journal MUST 收录的事件类型：`node-enter`、`node-exit`、`phase`、`skip`、`gate-retry`、`background`、`decision`、`state`。

journal MUST **排除** `op-chunk`：流式增量输出已由既有输出缓冲按桶持久化，journal 只记录**桶名引用**，MUST NOT 复制输出字节。

每条 journal 条目 SHALL 至少含：事件类型、发生时刻（毫秒时间戳）、所属 `runId`，以及该事件类型自身的载荷字段。

#### Scenario: 结构性事件入 journal

- **WHEN** 引擎为某运行发出 `node-enter`、`gate-retry`、`decision` 事件
- **THEN** journal 追加三条对应条目，各带发生时刻

#### Scenario: 流式输出不入 journal

- **WHEN** 引擎为某节点发出大量 `op-chunk` 事件
- **THEN** journal MUST NOT 追加对应条目（输出仍由既有输出缓冲按桶持久化）

#### Scenario: 新增事件类型自动进入

- **WHEN** `EngineProgressEvent` 未来新增一个结构性事件类型
- **THEN** 它经同一旁挂路径进入 journal，无需为其单独改动 journal 写入逻辑

### Requirement: 运行日志的持久化与保留

journal SHALL 按 `runId` 持久化，运行结束后仍可读取——用户 MUST 能在运行完成、软件重开后回看该运行的时间线。

journal 的保留与清理口径 MUST 与既有输出缓冲一致（二者同生共死：journal 引用输出桶，桶被清理后单留 journal 无意义）。系统 MUST NOT 为 journal 另立一套保留策略。

读取一个不存在 journal 的 `runId`（本能力上线前的历史运行）MUST 返回空而非报错。

#### Scenario: 重开软件后仍可读

- **WHEN** 某运行已完成，用户关闭并重开软件后请求该运行的 journal
- **THEN** 系统返回该运行完整的结构性事件序列

#### Scenario: 历史运行无 journal 不报错

- **WHEN** 请求一个本能力上线前完成的运行的 journal
- **THEN** 系统返回空，不报错

### Requirement: 时间线按节点分段，回退产生多段

系统 SHALL 提供一个**确定性纯函数**，把 journal 事件序列分组成**按节点的段序列**。每段 SHALL 至少含：节点 id、进入时刻、退出时刻（未结束则缺省）、耗时、经历的阶段、终局（完成 / 跳过+原因 / 停在决策）、门重试摘要（次数与各次 `cause`/`rerun`）、后台任务列表及其结局、该节点的输出桶引用。

分段 MUST 按**进入次序**切段，MUST NOT 按 nodeId 合并：内容驱动回退后重入同一节点时，该节点 MUST 呈现为**多段**，使「这节点跑了两遍」对用户可见。

段**未结束**（无 `node-exit`：运行停在该节点的决策上、或进程中断）时，该段 MUST 标记为未结束并以最后一个事件的时刻计算「至今耗时」，MUST NOT 因缺 `node-exit` 而丢弃该段。

#### Scenario: 正常节点成一段

- **WHEN** 事件序列含某节点的 `node-enter`、若干 `phase`、`node-exit`
- **THEN** 产出该节点一段，含进入/退出时刻、耗时与经历的阶段

#### Scenario: 回退重入产生两段

- **WHEN** 某节点先被进入并退出，内容驱动回退后又被进入
- **THEN** 该节点产出两段，按进入次序排列，不合并

#### Scenario: 停在决策上的节点标记未结束

- **WHEN** 某节点 `node-enter` 后抛出决策、无 `node-exit`
- **THEN** 该段标记为未结束，耗时按最后事件时刻计算，该段仍出现在时间线上

#### Scenario: 门重试摘要

- **WHEN** 某节点的客观门发生两次 `gate-retry`（一次 `error`/重跑节点、一次 `timeout`/重跑门）
- **THEN** 该段的门重试摘要为两次并各自标明原因与重跑粒度

### Requirement: 时间线展开复用既有输出回看

时间线上每段 SHALL 可展开查看该节点的原始输出，展开内容 MUST 复用既有的输出分桶回看组件与分桶规则（前台节点桶 / 各前台命令桶 / 各后台任务桶），MUST NOT 另实现一套输出渲染。

#### Scenario: 展开节点看输出

- **WHEN** 用户展开时间线上某个节点段
- **THEN** 系统以既有输出回看组件渲染该节点的输出桶（含其各前台命令桶与后台任务桶）

