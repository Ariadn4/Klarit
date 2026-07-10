## ADDED Requirements

### Requirement: 扫描本地已安装的 agent

应用 SHALL 提供探测本机已安装的受支持 agent CLI 的能力。探测 MUST 针对一组受支持 agent（至少包含 Claude Code、Codex、Cursor）逐一检查其 CLI 是否可用，并返回「已检测到的 agent 列表」。每个已检测到的 agent MUST 带有稳定的标识（id）与展示名（name）。探测 MUST NOT 因任一 agent 缺失而失败，未安装的 agent 仅表现为不出现在结果中。

#### Scenario: 检测到部分 agent
- **WHEN** 本机安装了 Claude Code 与 Cursor，未安装 Codex，应用执行 agent 扫描
- **THEN** 返回的列表包含 Claude Code 与 Cursor，不包含 Codex

#### Scenario: 未检测到任何 agent
- **WHEN** 本机未安装任何受支持 agent，应用执行 agent 扫描
- **THEN** 返回空列表，且不抛出错误

### Requirement: 提供每个 agent 的可选模型

对于每个受支持 agent，应用 SHALL 能给出该 agent 的可选模型清单，供用户为其选择默认模型。每个模型 MUST 带有稳定标识（id）与展示名（name）。当某 agent 的模型清单未知或为空时，模型选择 MUST 能安全表现为「无可选模型」而非报错。

#### Scenario: 返回某 agent 的模型清单
- **WHEN** 调用方请求某已检测到 agent 的可选模型
- **THEN** 返回该 agent 的模型清单，每个模型含标识与展示名

#### Scenario: 模型清单为空时安全表现
- **WHEN** 某 agent 没有可选模型
- **THEN** 该 agent 的模型清单返回为空，调用方据此呈现「无可选模型」而不报错

### Requirement: 扫描的健壮性

agent 扫描 SHALL 安全运行：当探测过程中发生异常（CLI 探测命令报错、超时、权限不足等）时，MUST 将对应 agent 视为「未检测到」并继续探测其余 agent，整体 MUST NOT 导致应用启动或调用方崩溃。

#### Scenario: 单个探测异常不影响整体
- **WHEN** 探测某一 agent 时其探测命令报错或超时
- **THEN** 该 agent 被视为未检测到，其余 agent 的探测照常完成，扫描整体成功返回
