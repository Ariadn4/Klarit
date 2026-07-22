# Proposal: model-select-and-effort

## Why

模型清单写死在静态表里（Opus 4.8 / Sonnet 4.6 / Haiku 4.5），Fable 5、Sonnet 5 等新模型选不了；`coerceDefaultModel` 把不在表里的模型 id 一律清掉，用户连手改设置绕过都不行——每出一个新模型就要发一版 Klarit 才能用上。同时各家 CLI 已支持推理力度（claude `--effort`、codex `model_reasoning_effort`），Klarit 却没有入口。

## What Changes

- **静态模型表降级为「建议列表」**：补 Fable 5 / Sonnet 5 等当前新模型，并加入「别名」项（claude 的 `opus`/`sonnet`/`haiku`——CLI 自动解析为该系最新模型）；别名作为默认推荐，用户不动手也自动跟新。
- **模型校验从「拒绝未知」改为「放行任意非空字符串」**：`coerceDefaultModel` 不再要求模型属于静态表；切换 agent 时仍清空原模型（不同家的模型 id 互不通用）。
- **设置里的模型下拉改 combobox**：建议列表可选 + 允许自由输入任意模型 id，新模型无需等 Klarit 发版。
- **新增 effort（推理力度）设置**：与 model 同构的两层级联——全局默认（应用偏好）+ 工作流 agent 节点可覆盖；adapter 按家翻译：claude → `--effort <level>`，codex → `-c model_reasoning_effort=<level>`，cursor / 不支持的家忽略（不报错）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `agent-preference`: 默认模型不再限于静态清单（任意非空字符串可持久化）；新增「默认 effort」偏好的存取。
- `settings-panel`: 「默认模型」由封闭下拉改为 combobox（建议 + 自由输入）；新增「默认 effort」设置项。
- `agent-execution`: adapter 翻译从 `{toolId, model, extraArgs}` 扩展为含 `effort`，按家翻成对应 flag，不支持的家静默忽略。
- `workflow-definition`: agent 节点执行配置增加可选 `effort` 字段，级联规则同 model（全局设置 < 节点声明）。

## Impact

- `src/shared/agents.ts`：模型表补新条目与别名项；`coerceDefaultModel` 放宽。
- `src/shared/types.ts`：`AgentExecConfig` 增 `effort`；settings IPC 增默认 effort 读写。
- `src/main/settings.ts`、`src/main/index.ts`：默认 effort 持久化与 IPC。
- `src/main/agent/adapter.ts`：三家 adapter 的 effort 翻译。
- `src/main/engine/engine.ts`、`src/main/agent-runner.ts`：级联解析处把 effort 与 model 同路传入。
- `src/renderer/src/components/SettingsPanel.tsx`、`WorkflowEditor.tsx`、`AgentOnboardingDialog.tsx`：combobox 与 effort 控件；聊天面板的模型选择器沿用建议列表（自动获得新条目，不强制改 combobox）。
- 工作流 `workflow.yaml` 序列化：新增可选字段，向后兼容（旧文件无 effort 即跟随全局）。
