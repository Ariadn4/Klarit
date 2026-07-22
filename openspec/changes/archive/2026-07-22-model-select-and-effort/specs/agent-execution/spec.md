# agent-execution Delta

## MODIFIED Requirements

### Requirement: 无头 adapter 拉起 agent CLI 在 worktree 干活

系统 SHALL 提供一个 **adapter 层**，把 agent 节点的执行配置 `{toolId, model, effort, extraArgs}` 声明式翻译成一次**无头（非交互）**的 agent CLI 启动。一个 agent 节点由**一个 agent** 承担其**全部目标成员仓**的工作——引擎 MUST 把该节点各目标成员仓的 worktree 目录一并交给这个 agent（如 claude `--add-dir` 追加工作目录），使它能在这些仓间做紧耦合改动、必要时自行起子 agent 并行；引擎不为「同一节点的多仓」拆成多个 agent。首发 MUST 支持三个 agent 外壳：`claude`、`codex`、`cursor`；adapter 接口 MUST 可扩展以容纳后续外壳。adapter MUST NOT 接入模型/后端（如经 base-url 改写的第三方模型）——本能力只接 agent 外壳、不接模型。

adapter 翻译 MUST 满足：

- **无头运行、无需 TTY**：经管道 stdio 启动（复用可取消 spawn 运行器的杀进程树 / 流式 / 可取消能力），不依赖伪终端。
- **免交互写文件**：注入各家「自动批准工具/编辑」的开关，使 agent 能在无人值守下写文件（如 `claude --dangerously-skip-permissions`、`codex --sandbox workspace-write --ask-for-approval never`、`cursor -p --force --trust`）。
- **选模型经 flag**（非环境变量）；模型值为**任意非空字符串**（含 `opus` 等「自动最新」别名），adapter MUST 原样透传、不校验其属于某清单；`extraArgs` 透传。
- **effort 按家翻译**：effort 取统一枚举 `low | medium | high | xhigh | max | ultracode`。claude MUST 把前五档翻成 `--effort <level>`（全档直传）；**`ultracode` 档不是 `--effort` 取值，claude MUST 改为把 `ultracode` 关键词注入喂给 agent 的文本开头**（start 的 prompt 与 resume 的注入文本均注入），且 MUST NOT 传 `--effort`。codex MUST 翻成 `-c model_reasoning_effort=<level>`，其档位止于 high，`xhigh`/`max`/`ultracode` MUST 收敛为 `high`（就近取该家最高档，不报错）；cursor 及其它不支持 effort 的外壳 MUST 忽略该字段（不注入参数、不报错、不降级）。effort 未设置时 MUST NOT 注入任何 effort 参数（用各家自身默认）。
- **流式输出**：agent 的 stdout/stderr MUST 边收边流式回显，详情面板展示该 agent 的实时输出。一个 agent 节点一条输出流（一个 agent 跨目标仓工作），无需按成员仓分流。

启动失败（外壳未装 / 拉起即崩 / 声明的模型不可用）MUST 归「技术失败」，按失败归宿处理（有限次重试 → 超限抛决策），MUST NOT 静默降级。

#### Scenario: 无头拉起并在目标仓 worktree 写文件
- **WHEN** 引擎执行一个 agent 节点，`target=all`、卡 `repos`=[web, api]、`toolId=claude`
- **THEN** adapter 无头启动**一个** `claude`（带免交互写文件与选模型 flag），把 web、api 两个 worktree 都交给它（如 `--add-dir`），agent 在两仓间改动文件、stdout 流式回显

#### Scenario: effort 按家翻译成对应 flag
- **WHEN** 一次 agent 启动解析出 `effort=high`，外壳分别为 claude 与 codex
- **THEN** claude 的 argv 含 `--effort high`，codex 的 argv 含 `-c model_reasoning_effort=high`

#### Scenario: codex 对超出档位的 effort 收敛为最高档
- **WHEN** 一次 codex 启动解析出 `effort=max`（或 `xhigh`）
- **THEN** codex 的 argv 含 `-c model_reasoning_effort=high`（收敛为该家最高档），claude 同配置则为 `--effort max` 直传

#### Scenario: ultracode 档经提示词关键词注入而非 flag
- **WHEN** 一次 claude 启动解析出 `effort=ultracode`
- **THEN** argv 不含 `--effort`，喂给 agent 的文本以 `ultracode` 关键词开头（start 与 resume 皆然）；codex 同配置收敛为 `-c model_reasoning_effort=high`，cursor 忽略

#### Scenario: 不支持 effort 的外壳静默忽略
- **WHEN** 一次 cursor 启动解析出 `effort=high`
- **THEN** cursor 的 argv 不含任何 effort 参数，启动照常进行、不报错

#### Scenario: effort 未设置不注入参数
- **WHEN** 全局默认 effort 未设置且节点未声明 effort
- **THEN** 任何外壳的 argv 均不含 effort 参数

#### Scenario: 清单外模型 id 原样透传
- **WHEN** 一次 claude 启动的模型值为建议清单外的字符串（如 `opus` 别名或新模型 id）
- **THEN** adapter 把该值原样翻成 `--model <值>`，不做清单校验

#### Scenario: 声明的外壳不可用归技术失败
- **WHEN** agent 节点声明 `toolId` 对应的 CLI 未安装或拉起即崩
- **THEN** 引擎按技术失败处理（有限次重试后抛人工决策），不静默改用别的外壳

#### Scenario: adapter 不接模型/后端
- **WHEN** 用户希望用某第三方模型（无独立 agent CLI）
- **THEN** 本能力不提供该路径（只接三家 agent 外壳），不通过 base-url 改写把模型伪装成外壳
