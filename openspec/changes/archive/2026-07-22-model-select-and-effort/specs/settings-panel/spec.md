# settings-panel Delta

## MODIFIED Requirements

### Requirement: 默认 agent 与默认模型设置项

设置面板「应用设置 → 通用」SHALL 包含「默认 agent」与「默认模型」两个设置项。「默认 agent」以下拉选择（dropdown）呈现，MUST 列出本地已检测到的 agent（见 `agent-detection`），并以当前默认 agent 为选中项。「默认模型」MUST 为 **combobox（可选可输）**：聚焦时展示当前所选 agent 的**完整建议模型列表**（「别名＝自动最新」条目排在前，如 claude 的 `opus`/`sonnet`/`haiku`），且 MUST NOT 按输入框已有值过滤建议（已有值时仍能看到全部建议并换选，原生 datalist 的前缀过滤行为不满足本要求）；同时允许用户**直接键入任意模型 id** 提交——不限于建议列表，使新模型无需应用更新即可使用。选择或输入某一 agent/模型 MUST 立即生效并持久化保存（见 `agent-preference`），重启后保持。切换 agent 后模型 MUST 重置（清空并展示新 agent 的建议列表），不保留原 agent 的模型值。当本地未检测到任何 agent 时，本设置项 MUST 给出明确空态（如提示去安装 agent）而非报错。其样式 MUST 遵循品牌规范（`docs/brand`）与 `index.css` 的 `@theme` 设计令牌、深浅双主题，不另起一套配色或投影。

#### Scenario: 展示当前默认 agent 与模型
- **WHEN** 用户打开设置面板的「应用设置 → 通用」，本地已检测到 agent 且已设默认值
- **THEN** 「默认 agent」下拉列出已检测到的 agent 且当前默认 agent 为选中项，「默认模型」combobox 显示当前默认模型，聚焦时展示该 agent 的**完整**建议列表（别名条目在前，不因已有值而被过滤）

#### Scenario: 切换默认 agent 即时持久化并联动模型
- **WHEN** 用户在「默认 agent」下拉中选择另一个已检测到的 agent
- **THEN** 该 agent 立即成为默认 agent 并被持久化，「默认模型」重置并改为展示新 agent 的建议列表，原 agent 的模型值不被保留

#### Scenario: 从建议列表选择模型即时持久化
- **WHEN** 用户在「默认模型」combobox 的建议列表中选择某条目（含别名条目）
- **THEN** 该模型立即成为默认模型并被持久化，重启后仍为所选模型

#### Scenario: 手输任意模型 id 即时持久化
- **WHEN** 用户在「默认模型」combobox 中键入一个不在建议列表内的模型 id 并提交
- **THEN** 该 id 立即成为默认模型并被持久化，不被拒绝或清空

#### Scenario: 未检测到 agent 时的空态
- **WHEN** 用户打开「应用设置 → 通用」，本地未检测到任何受支持 agent
- **THEN** 「默认 agent / 默认模型」处显示空态提示（引导用户安装 agent），不报错、不展示可选项

## ADDED Requirements

### Requirement: 默认 effort 设置项

设置面板「应用设置 → 通用」SHALL 包含「默认 effort（推理力度）」设置项，提供七个互斥选项：`low` / `medium` / `high` / `xhigh` / `max` / `ultracode` / 「跟随 agent 默认」（即未设置）。档位选项 MUST 显示 CLI 原文（不翻译）。选择 MUST 立即生效并持久化（见 `agent-preference`），重启后保持。该设置项 MUST 附简短说明文案，说明其作用于 agent 推理力度、由各家 agent 各自解释、不支持的 agent 将忽略。样式 MUST 遵循品牌规范与 `@theme` 设计令牌、深浅双主题。

#### Scenario: 选择 effort 档位即时持久化
- **WHEN** 用户把默认 effort 从「跟随 agent 默认」改为 `high`
- **THEN** 立即持久化，重启后设置面板仍显示 `high`

#### Scenario: 回到跟随 agent 默认
- **WHEN** 用户把默认 effort 改回「跟随 agent 默认」
- **THEN** 默认 effort 变为「未设置」，后续 agent 启动不再注入 effort 参数
