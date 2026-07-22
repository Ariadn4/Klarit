# workflow-definition Delta

## MODIFIED Requirements

### Requirement: agent 执行配置

`agent` 执行者 MAY 携带一份可选**执行配置**，声明本节点用哪个**编程工具**（adapter）、哪个**模型**、哪档 **effort（推理力度）**、以及**额外参数**：`{ 工具?, 模型?, effort?, 额外参数? }`，各字段均可空。effort 取统一枚举 `low | medium | high | xhigh | max | ultracode`。配置 SHALL 为**声明式**——记录工具/模型/effort 标识而非裸启动命令，使工作流可移植、可分享。

执行配置的生效遵循**两层级联**：**全局设置 < 节点声明**。节点未声明某字段即跟随全局设置；**不存在「工作流默认」层**。工具/模型的可选标识来源由引擎的编程工具/agent 扫描提供（模型不限于建议清单，任意非空字符串合法）；本能力只负责存储与往返，不校验其在某机器上是否真实可用（属引擎运行期）。effort 枚举外的值在校验时 MUST 判为非法并给出可读原因。

#### Scenario: 声明工具与模型往返保持
- **WHEN** 某 agent 节点声明执行配置的工具/模型/effort/额外参数并保存后读回
- **THEN** 这些字段完整保留在定义中

#### Scenario: 不声明执行配置时跟随全局
- **WHEN** 某 agent 节点未声明执行配置（或其某字段为空）
- **THEN** 该节点（该字段）跟随全局设置，定义仍可被保存与读回，不因缺省判为非法

#### Scenario: 节点 effort 覆盖全局默认
- **WHEN** 全局默认 effort 为 `medium`，某 agent 节点声明 `effort=high`
- **THEN** 该节点按 `high` 执行，其它未声明 effort 的节点跟随全局 `medium`

#### Scenario: effort 枚举外值校验失败
- **WHEN** 某工作流的 agent 节点执行配置声明 `effort=ultra`
- **THEN** 校验失败并给出可读原因，阻止写入

#### Scenario: 旧定义无 effort 字段仍合法
- **WHEN** 载入一份早于本变更、执行配置无 effort 字段的 `workflow.yaml`
- **THEN** 载入成功，该节点 effort 视为未声明（跟随全局），无需迁移
