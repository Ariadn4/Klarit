# agent-preference Specification

## Purpose
TBD - created by archiving change scan-local-agents-onboarding. Update Purpose after archive.
## Requirements
### Requirement: 默认 agent 与默认模型偏好的存储

应用 SHALL 把「默认 agent」与「默认模型」作为应用级偏好持久化保存，存放在与语言/外观相同的应用设置存储中（独立于项目注册表与会话状态）。两者缺省（未设置）即视为「未选择」，并作为首次启动的信号（类比语言设置的 `undefined`）。当设置文件缺失或损坏时，读取 MUST 安全回退为「未选择」，不得导致启动失败。

#### Scenario: 偏好被持久化并在重启后保留
- **WHEN** 用户已将默认 agent 设为 Claude Code、默认模型设为某模型，应用重启
- **THEN** 默认 agent 仍为 Claude Code、默认模型仍为该模型

#### Scenario: 设置文件损坏时安全回退
- **WHEN** 应用设置文件内容损坏或无法解析，应用启动
- **THEN** 默认 agent 与默认模型读取为「未选择」，启动不中断

### Requirement: 读取与更新默认 agent / 默认模型

应用 SHALL 提供读取「当前默认 agent」「当前默认模型」以及更新二者的能力。更新 MUST 立即持久化，使其在下次启动时生效。写入的默认 agent MUST 是「已检测到的受支持 agent」之一；写入的默认模型 MUST 属于所选 agent 的可选模型清单。当默认 agent 发生变更且原默认模型不属于新 agent 的模型清单时，默认模型 MUST 被重置（清空或归一为新 agent 的合理缺省），不得保留与 agent 不匹配的模型。

#### Scenario: 更新默认 agent 并持久化
- **WHEN** 调用方将默认 agent 更新为已检测到的 Cursor
- **THEN** 当前默认 agent 变为 Cursor 且被持久化，重启后仍为 Cursor

#### Scenario: 更新默认模型并持久化
- **WHEN** 调用方将默认模型更新为当前默认 agent 模型清单内的某模型
- **THEN** 当前默认模型变为该模型且被持久化，重启后仍为该模型

#### Scenario: 切换 agent 后清理不匹配的模型
- **WHEN** 当前默认模型属于 agent A，调用方把默认 agent 改为 agent B，而原模型不在 B 的清单内
- **THEN** 默认模型被重置为不匹配状态被清除，不保留属于 A 的模型

### Requirement: 首次启动引导弹窗

首次启动（即尚无默认 agent 值）时，应用 SHALL 先执行本地 agent 扫描（见 `agent-detection`）。当扫描到至少一个 agent 时，应用 MUST 弹出引导弹窗，引导用户选择默认 agent 及其默认模型；弹窗 MUST 仅让用户选择 agent 与模型，不包含其它选项。当扫描结果为空时，应用 MUST NOT 弹出该弹窗。弹窗样式 MUST 遵循品牌规范（`docs/brand`）与 `index.css` 的 `@theme` 设计令牌，提供深浅两套，不另起一套配色或投影。

#### Scenario: 扫描到 agent 时弹出引导
- **WHEN** 应用首次启动且本地扫描到至少一个 agent
- **THEN** 弹出引导弹窗，列出已检测到的 agent 供选择，并按所选 agent 联动展示其可选模型

#### Scenario: 未扫描到 agent 时不弹窗
- **WHEN** 应用首次启动但本地未扫描到任何 agent
- **THEN** 不弹出引导弹窗，应用照常进入主界面

#### Scenario: 已有默认 agent 时不再弹窗
- **WHEN** 用户此前已设置过默认 agent，应用再次启动
- **THEN** 不弹出引导弹窗，沿用已保存的默认 agent 与默认模型

### Requirement: 引导弹窗可跳过

引导弹窗 SHALL 允许用户「跳过」。用户跳过时 MUST NOT 写入任何默认 agent / 默认模型值（保持「未选择」），并 MUST 不阻塞进入主界面。用户可稍后在「设置 → 应用设置 → 通用」完成选择（见 `settings-panel`）。用户在弹窗中确认选择时，所选默认 agent 与默认模型 MUST 被持久化保存。

#### Scenario: 跳过引导不写入偏好
- **WHEN** 引导弹窗出现，用户点击「跳过」
- **THEN** 不写入默认 agent / 默认模型，弹窗关闭并进入主界面，下次仍可在设置中选择

#### Scenario: 在引导弹窗确认选择
- **WHEN** 用户在引导弹窗中选择某 agent 及其某模型并确认
- **THEN** 该默认 agent 与默认模型被持久化保存，重启后保持，且不再次弹出引导

