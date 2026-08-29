# agent-detection Specification

## Purpose
TBD - created by archiving change scan-local-agents-onboarding. Update Purpose after archive.
## Requirements
### Requirement: 扫描本地已安装的 agent

应用 SHALL 提供探测本机已安装的受支持 agent CLI 的能力。探测 MUST 针对一组受支持 agent（至少包含 Claude Code、Codex、Cursor）逐一检查其 CLI 是否可用，并返回「已检测到的 agent 列表」。每个已检测到的 agent MUST 带有稳定的标识（id）、展示名（name），以及其 CLI 的**可执行绝对路径**。探测 MUST NOT 因任一 agent 缺失而失败，未安装的 agent 仅表现为不出现在结果中。

探测 MUST 解析出路径本身，MUST NOT 只回答「有没有」——路径是后续启动 agent 的**唯一可信来源**（见 `agent-execution`「agent CLI 以解析出的绝对路径启动」）。

路径解析 MUST 满足以下全部约束，任一不满足即视为**该 agent 未检测到**（而非降级使用）：

- 解析过程 MUST 在**受控工作目录**下进行——MUST NOT 在任何已注册项目目录或需求卡 worktree 目录下执行解析命令（Windows 的 `where` 搜索范围含当前目录，否则护栏在解析这一步即被绕过）。
- 结果 MUST 是**绝对路径**；相对路径 MUST 被拒绝。
- 结果 MUST 指向一个**真实存在的文件**。
- 结果 MUST NOT 落在任何已注册项目目录或需求卡 worktree 目录**之内**。
- 结果的可执行形态 MUST 属于该平台的已知形态（Windows 上为 `.exe` / `.cmd`）。

解析失败时，系统 SHALL 能给出**可辨认的原因**（未解析到 / 解析结果被护栏拒绝），而非一律笼统归为「未安装」。

#### Scenario: 检测到部分 agent
- **WHEN** 本机安装了 Claude Code 与 Cursor，未安装 Codex，应用执行 agent 扫描
- **THEN** 返回的列表包含 Claude Code 与 Cursor（各带其可执行绝对路径），不包含 Codex

#### Scenario: 未检测到任何 agent
- **WHEN** 本机未安装任何受支持 agent，应用执行 agent 扫描
- **THEN** 返回空列表，且不抛出错误

#### Scenario: 解析结果落在项目目录内被拒绝
- **WHEN** 某次解析得到的候选路径位于一个已注册项目目录或需求卡 worktree 之内
- **THEN** 该候选 MUST 被拒绝，该 agent 视为未检测到，且原因可辨认为「解析结果被护栏拒绝」而非「未安装」

#### Scenario: 相对路径或非文件候选被拒绝
- **WHEN** 某次解析得到的候选是相对路径，或指向的目标不是真实文件
- **THEN** 该候选 MUST 被拒绝，该 agent 视为未检测到

#### Scenario: 解析在受控工作目录下进行
- **WHEN** 应用执行 agent 扫描，而某需求卡 worktree 内放有与 agent CLI 同名的文件
- **THEN** 该文件 MUST NOT 被解析为候选（解析不在该目录下进行，且该候选亦落在护栏拒绝范围内）

### Requirement: 提供每个 agent 的可选模型

对于每个受支持 agent，应用 SHALL 能给出该 agent 的可选模型清单，供用户为其选择默认模型。每个模型 MUST 带有稳定标识（id）与展示名（name）。当某 agent 的模型清单未知或为空时，模型选择 MUST 能安全表现为「无可选模型」而非报错。

#### Scenario: 返回某 agent 的模型清单
- **WHEN** 调用方请求某已检测到 agent 的可选模型
- **THEN** 返回该 agent 的模型清单，每个模型含标识与展示名

#### Scenario: 模型清单为空时安全表现
- **WHEN** 某 agent 没有可选模型
- **THEN** 该 agent 的模型清单返回为空，调用方据此呈现「无可选模型」而不报错

### Requirement: 扫描的健壮性

agent 扫描 SHALL 安全运行：当探测过程中发生异常（CLI 探测命令报错、超时、权限不足、路径解析被护栏拒绝等）时，MUST 将对应 agent 视为「未检测到」并继续探测其余 agent，整体 MUST NOT 导致应用启动或调用方崩溃。

#### Scenario: 单个探测异常不影响整体
- **WHEN** 探测某一 agent 时其探测命令报错或超时
- **THEN** 该 agent 被视为未检测到，其余 agent 的探测照常完成，扫描整体成功返回

#### Scenario: 单个候选被护栏拒绝不影响整体
- **WHEN** 某一 agent 的路径候选被安全护栏拒绝
- **THEN** 该 agent 被视为未检测到，其余 agent 的探测照常完成，扫描整体成功返回

