# agent-preference Delta

## MODIFIED Requirements

### Requirement: 读取与更新默认 agent / 默认模型

应用 SHALL 提供读取「当前默认 agent」「当前默认模型」以及更新二者的能力。更新 MUST 立即持久化，使其在下次启动时生效。写入的默认 agent MUST 是「已检测到的受支持 agent」之一；写入的默认模型 MUST 为**任意非空字符串**（trim 后非空）——**不要求属于任何静态清单**，静态模型表仅作 UI 建议列表用（含「别名＝该系最新」条目，如 claude 的 `opus`/`sonnet`/`haiku`）。空白/非字符串的模型值 MUST 收敛为「未选择」。当默认 agent 发生变更时，默认模型 MUST 被清空（模型标识家际不通用，MUST NOT 跨 agent 保留）。

#### Scenario: 更新默认 agent 并持久化
- **WHEN** 调用方将默认 agent 更新为已检测到的 Cursor
- **THEN** 当前默认 agent 变为 Cursor 且被持久化，重启后仍为 Cursor

#### Scenario: 建议清单外的模型 id 可被写入
- **WHEN** 调用方把默认模型更新为一个不在建议清单内的非空字符串（如新发布的模型 id 或 `opus` 别名）
- **THEN** 该值被原样持久化并作为当前默认模型返回，不被收敛为「未选择」

#### Scenario: 空白模型值收敛为未选择
- **WHEN** 调用方把默认模型更新为空串或纯空白字符串
- **THEN** 默认模型收敛为「未选择」

#### Scenario: 切换 agent 后清空模型
- **WHEN** 当前已设默认模型，调用方把默认 agent 改为另一个 agent
- **THEN** 默认模型被清空为「未选择」，不保留原 agent 的模型值

## ADDED Requirements

### Requirement: 默认 effort 偏好的存储与读写

应用 SHALL 把「默认 effort（推理力度）」作为应用级偏好持久化保存，与默认 agent/模型同一存储。取值 MUST 限于统一枚举 `low | medium | high | xhigh | max | ultracode`（前五档对齐 claude CLI 完整档位；`ultracode` 为 Claude Code 提示词关键词档；不支持的家由 adapter 收敛或忽略，见 `agent-execution`）；缺省（未设置）表示「跟随各 agent CLI 自身默认」，此时 MUST NOT 向 CLI 注入任何 effort 参数。应用 SHALL 提供读取与更新默认 effort 的能力，更新 MUST 立即持久化；非法值（枚举外）MUST 收敛为「未设置」。设置文件缺失或损坏时读取 MUST 安全回退「未设置」，不得导致启动失败。默认 effort 与 agent 选择相互独立——切换默认 agent MUST NOT 清空默认 effort（枚举语义家际可移植，由 adapter 各自翻译）。

#### Scenario: 更新默认 effort 并持久化
- **WHEN** 调用方将默认 effort 更新为 `max`
- **THEN** 当前默认 effort 变为 `max` 且被持久化，重启后仍为 `max`

#### Scenario: 非法 effort 值收敛为未设置
- **WHEN** 调用方尝试把默认 effort 写为枚举外的值（如 `ultra` 或空串）
- **THEN** 默认 effort 收敛为「未设置」

#### Scenario: 切换 agent 不影响默认 effort
- **WHEN** 默认 effort 为 `high`，调用方把默认 agent 从 Claude Code 改为 Codex
- **THEN** 默认 effort 仍为 `high`
