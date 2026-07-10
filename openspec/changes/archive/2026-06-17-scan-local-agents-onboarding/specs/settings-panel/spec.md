## ADDED Requirements

### Requirement: 默认 agent 与默认模型设置项

设置面板「应用设置 → 通用」SHALL 包含「默认 agent」与「默认模型」两个设置项，均以下拉选择（dropdown）样式呈现。「默认 agent」下拉 MUST 列出本地已检测到的 agent（见 `agent-detection`），并以当前默认 agent 为选中项；「默认模型」下拉 MUST 随当前所选 agent 联动，列出该 agent 的可选模型，并以当前默认模型为选中项。选择某一 agent 或模型 MUST 立即生效并持久化保存（见 `agent-preference`），重启后保持。切换 agent 后若原默认模型不属于新 agent，模型下拉 MUST 重置为新 agent 的合理状态而非保留不匹配项。当本地未检测到任何 agent 时，本设置项 MUST 给出明确空态（如提示去安装 agent）而非报错。其样式 MUST 遵循品牌规范（`docs/brand`）与 `index.css` 的 `@theme` 设计令牌，不另起一套配色或投影。

#### Scenario: 展示当前默认 agent 与模型
- **WHEN** 用户打开设置面板的「应用设置 → 通用」，本地已检测到 agent 且已设默认值
- **THEN** 「默认 agent」下拉列出已检测到的 agent 且当前默认 agent 为选中项，「默认模型」下拉列出该 agent 的可选模型且当前默认模型为选中项

#### Scenario: 切换默认 agent 即时持久化并联动模型
- **WHEN** 用户在「默认 agent」下拉中选择另一个已检测到的 agent
- **THEN** 该 agent 立即成为默认 agent 并被持久化，「默认模型」下拉随之切换为该 agent 的可选模型，原不匹配的模型不被保留

#### Scenario: 切换默认模型即时持久化
- **WHEN** 用户在「默认模型」下拉中选择当前 agent 模型清单内的另一模型
- **THEN** 该模型立即成为默认模型并被持久化，重启后仍为所选模型

#### Scenario: 未检测到 agent 时的空态
- **WHEN** 用户打开「应用设置 → 通用」，本地未检测到任何受支持 agent
- **THEN** 「默认 agent / 默认模型」处显示空态提示（引导用户安装 agent），不报错、不展示可选项
