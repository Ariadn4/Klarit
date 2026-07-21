## ADDED Requirements

### Requirement: 归档读登记表并按 kind 路由

`archive-docs` 引擎操作运行时 SHALL 读当前成员仓的文档登记表（来自 `add-document-registry` 的 `document-store`）。对每条 `ManagedDoc` MUST 按 `kind` 路由归档动作：

- `dynamic`：**就地更新** `location`——只留最新现状、不留旧版/差异（动态文档语义）。
- `snapshot`：按习惯**决定是否追加一条冻结记录**到 `location`；既有快照内容 MUST NOT 被回改。

文件夹坍缩条目（`isFolder` 带 `coversFiles`）的归档 MUST 作用于该文件夹这一类文档（如向一个 ADR 文件夹追加一条新记录），而非某个固定叶子。

#### Scenario: 动态文档就地更新
- **WHEN** 归档遇到一条 `kind: 'dynamic'` 的 `docs/architecture.md`
- **THEN** 它被就地更新为最新现状，不新增历史版本文件

#### Scenario: 快照文档追加不回改
- **WHEN** 归档遇到一条 `kind: 'snapshot'` 的 ADR 文件夹
- **THEN** 至多向其**追加**一条新记录，既有内容不被修改

### Requirement: 归档照审批过的习惯 prompt，未审批仅按 kind 兜底

归档委派指令 SHALL 由登记表合成：对某条 `ManagedDoc`，仅当其 `approved` 为 `true` 时把 `habitPrompt` 注入委派指令；`approved` 为 `false` 时 MUST NOT 注入该习惯，至多按 `kind` 兜底（dynamic 就地更新、snapshot 谨慎追加）。项目级 `conventionPreamble` 同理，仅 `conventionApproved` 为 `true` 时作为前言注入。

"本次该不该落快照"由 agent 依习惯意图 + 本次任务上下文判断；引擎 MUST NOT 硬编码频率规则。

#### Scenario: 审批过的习惯被注入
- **WHEN** 某快照文档的 `habitPrompt`（含"仅重大改动才落"）已审批
- **THEN** 委派指令含该习惯，agent 据此判本次改动够不够格落记录

#### Scenario: 未审批习惯不注入
- **WHEN** 某条的 `habitPrompt` 未审批
- **THEN** 委派指令不含该习惯，仅按其 `kind` 兜底

#### Scenario: agent 判定本次不落快照
- **WHEN** 习惯为"仅重大改动才落"，本次为日常小改
- **THEN** agent 可判定本次**不**追加记录，节点照常过

### Requirement: 子 agent 并行，缺则串行退化

`archive-docs` 执行时 SHALL 探测运行时 agent/模型是否支持子 agent：**支持**时按 `ManagedDoc` 条目分组、派多个子 agent**并行**处理不同文档（一条坍缩条目归同一子 agent）；**不支持**时退化为**单 agent 串行**顺次处理全部条目。两路产出语义 MUST 等价，仅并发度不同。能力探测不确定时 MUST 保守走串行退化。

#### Scenario: 支持子 agent 时并行
- **WHEN** 运行时支持子 agent，登记表有 3 条独立文档
- **THEN** 归档派 3 个子 agent 并行，各处理一条

#### Scenario: 不支持子 agent 时串行
- **WHEN** 运行时不支持子 agent
- **THEN** 归档以单 agent 顺次处理全部条目，结果与并行等价

#### Scenario: 探测不确定走串行
- **WHEN** 子 agent 能力探测结果不确定
- **THEN** 归档保守选择串行退化，不因误判并行而失败

### Requirement: 缺表 / 无 agent / 空表的兜底

`archive-docs` MUST 有清楚兜底：无可用 agent → 失败挂起、决策 `no-agent`（比照 `open-pr`）；当前成员仓无登记表 → 失败挂起、提示先建立文档登记表；登记表 `docs[]` 为空 → **noop 过节点**（无可归档，不算失败）。多仓项目每个涉及成员仓各自归档、各自兜底。

#### Scenario: 无 agent 挂起
- **WHEN** 运行 `archive-docs` 时无可用默认 agent
- **THEN** 节点失败挂起，抛 `no-agent` 决策与可读提示

#### Scenario: 无登记表提示建表
- **WHEN** 当前成员仓从未建立文档登记表
- **THEN** 节点失败挂起，提示先在设置/onboarding 里建立登记表

#### Scenario: 空表 noop
- **WHEN** 登记表存在但 `docs[]` 为空
- **THEN** 节点 noop 通过，不算失败

### Requirement: 归档产生文档写入并提交

与 `open-pr`（外部动作、不提交）不同，`archive-docs` MUST 把归档产生的文档改动**提交**到该成员仓的当前分支，使沉淀的内容进入版本历史。

#### Scenario: 归档改动被提交
- **WHEN** 归档更新了一个动态文档并追加了一条快照记录
- **THEN** 这些文档改动被提交，不被当作外部动作丢弃
