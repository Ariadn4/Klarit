# Design: model-select-and-effort

## Context

模型清单与校验的现状是一条封闭链：`src/shared/agents.ts` 的静态表 → 设置/引导/工作流编辑器的封闭下拉 → `coerceDefaultModel` 拒绝表外值 → adapter 把选中 id 翻成 `--model`。CLI 本身接受任意模型字符串（claude 还支持 `opus`/`sonnet`/`haiku` 这类「自动解析为该系最新」的别名），封闭是 Klarit 自己加的。effort（推理力度）各家 CLI 已支持（本机 `claude --help` 确证有 `--effort <level>`；codex 为 `-c model_reasoning_effort=<level>`），Klarit 无入口，只能靠节点 `extraArgs` 手填。

用户已定的两个取向：**effort 对齐 model 的两层级联（全局默认 + 节点覆盖）**；**默认推荐别名（自动用最新）**。

## Goals / Non-Goals

**Goals:**

- 新模型（Fable 5 / Sonnet 5 及未来任何模型）无需 Klarit 发版即可使用。
- 默认推荐别名条目，模型随 CLI 自动跟新。
- effort 成为一等设置：全局默认 + agent 节点覆盖，adapter 按家翻译。

**Non-Goals:**

- 不做模型清单的动态获取/远程目录（CLI 无枚举命令、API 需 key，不可靠；建议列表随 Klarit 版本维护即可，逃生口是自由输入）。
- 不接第三方模型/后端（维持 agent-execution「只接外壳不接模型」的边界）。
- 聊天会话（全局对话 / 卡咨询）不加会话级 effort 覆盖——跟随全局默认即可，选择器沿用建议列表。
- 不校验用户输入的模型 id 是否真实存在（CLI 启动失败已有「技术失败→有限重试→抛决策」归宿兜底）。

## Decisions

1. **静态表降级为「建议列表」，校验放宽为「任意非空字符串」**
   `coerceDefaultModel(agentId, modelId)` 语义改为：agent 未选 → undefined；`modelId` 非字符串或 trim 后为空 → undefined；其余原样放行。切换 agent 时**仍清空**原模型——模型 id 家际不通用，保留会把 claude 的 id 喂给 codex。
   *备选*：维持封闭表、只补条目——被否，打地鼠，下次新模型又卡住。

2. **别名条目进建议列表并作默认推荐**
   claude-code 的建议列表头部加别名项：`opus` / `sonnet` / `haiku`（展示名标注「自动最新」），钉死 id 的条目（`claude-fable-5`、`claude-opus-4-8`、`claude-sonnet-5`、`claude-haiku-4-5`）保留在后供想复现的用户选。引导弹窗与设置的「合理缺省」推荐别名项。cursor 已有 `auto` 同义条目；codex 维持显式 id（其 CLI 无同类别名机制）。
   *权衡*：别名自动跟新意味着模型可能悄悄升级、行为漂移——用户已明确选择此取向；想钉死的用户选完整 id 即可。

3. **effort 为 Klarit 层统一枚举 `low | medium | high | xhigh | max | ultracode`，未设置＝不传 flag**
   前五档对齐 claude CLI 的完整档位（撞真 CLI 确证：low/medium/high/xhigh/max）；不设值时不注入任何 effort 参数，用各家自身默认。翻译：claude → `--effort <level>` 全档直传；codex → `-c model_reasoning_effort=<level>`，其档位止于 high，**`xhigh`/`max` 收敛为 `high`**（clamp，不报错——就近取该家最高档，好过静默丢弃）；cursor 及未来不支持的家 → 忽略（不报错、不降级）。
   **`ultracode` 是特殊档**：它不是 `--effort` 的合法取值，而是 Claude Code 的**提示词关键词**（出现在 prompt 里即为该轮开启多 agent 编排）。翻译：claude → **把 `ultracode` 关键词注入 prompt 开头**（start 与 resume 注入文本均注入），不传 `--effort`；codex → 收敛为 `high`（无编排等价物，就高）；cursor → 忽略。无头小任务路径（分解/起草，走 `headlessInvocation`）不注入关键词——结构化小任务不宜编排，该路径遇 ultracode 视同未设置。档位在 UI 一律显示 CLI 原文，不翻译。
   *备选一*：只取三家交集 low/medium/high——被否，白白砍掉 claude 的上限档，用户要不到 max。
   *备选二*：自由字符串透传——被否，工作流分享到另一家 agent 时无从翻译，且拼写错误静默失效。

4. **级联与注入点：与 model 完全同路**
   `AgentInvokeOpts` 增 `effort?`；`AgentExecConfig`（工作流节点）增 `effort?`，级联「全局设置 < 节点声明」与 model 同一处解析（engine / agent-runner 现有 `model ?? settings.defaultModel` 的位置）。聊天等其它 agent 启动路径在同一注入点自动获得全局默认 effort。settings 增 `defaultEffort` 持久化 + IPC 读写（`getDefaultEffort` / `setDefaultEffort`），损坏/缺失安全回退「未设置」。

5. **combobox：输入框 + 自绘建议弹层（不用原生 datalist），复用现有下拉视觉**
   「默认模型」控件改为可输入可选：**聚焦即展示完整建议列表（别名在前），不按已输入值过滤**——原生 `<datalist>` 按前缀过滤，输入框已有值时建议只剩自身，别名根本看不见（dogfood 实测踩坑），故自绘弹层。也可直接键入任意 id；样式走 `@theme` 语义令牌、深浅双主题，不引入新配色。设置与工作流编辑器共用同一 combobox 组件；聊天面板的模型选择器只需继续吃建议列表（自动获得新条目），不强制改 combobox。

## Risks / Trade-offs

- [用户输错模型 id → agent 拉起失败] → 既有「技术失败：有限重试→超限抛决策」归宿兜底，不静默降级；失败输出里 CLI 会说明模型不可用。
- [别名自动跟新 → 长任务行为漂移] → 用户明确选择的取向；需要复现的场景选完整 id 条目即可。
- [claude `--effort` 取值集合] → 已撞真 CLI 校准：low/medium/high/xhigh/max，非法值仅警告忽略。
- [codex 翻译未经本机验证] → 与现有 codex 参数同等待遇：按文档落地（含 xhigh/max→high 的 clamp），B 里程碑撞真 CLI 校准。
- [旧 workflow.yaml 无 effort 字段] → 可选字段，缺省＝跟随全局，天然向后兼容，无迁移。
