# Tasks: model-select-and-effort

> 项目约定：测试先行——每组先写红测试再实现变绿；只测公共 API。

## 1. 共享层：建议列表与校验放宽

- [x] 1.1 撞真 CLI 校准：本机 `claude --help` / 试跑确认 `--effort` 合法取值集合（low/medium/high 是否直接可用），结论记入 adapter 代码注释；codex 未装，按文档 `-c model_reasoning_effort=` 落地并注明待校准
- [x] 1.2 写红测试：`coerceDefaultModel` 放行任意非空字符串（含建议清单外 id 与别名）、空白收敛 undefined、agent 未选仍 undefined；`agents.ts` 建议表含 Fable 5 / Sonnet 5 与别名条目（opus/sonnet/haiku 在前）
- [x] 1.3 实现：`src/shared/agents.ts` 更新模型表（别名条目在前、标注「自动最新」展示名），`coerceDefaultModel` 放宽为「agent 已选 + 非空字符串即放行」

## 2. 默认 effort 偏好（settings + IPC）

- [x] 2.1 写红测试：`src/main/settings.ts` 的 defaultEffort 存取——合法枚举持久化、枚举外/空值收敛未设置、文件损坏安全回退、切换 defaultAgent 不清 effort
- [x] 2.2 实现：settings 增 `defaultEffort`（`'low'|'medium'|'high'|undefined`）与收敛函数；`src/shared/types.ts` 增 `getDefaultEffort`/`setDefaultEffort` IPC 契约；`src/main/index.ts` 注册 handler；preload 桥接

## 3. adapter 的 effort 翻译

- [x] 3.1 写红测试：`AgentInvokeOpts.effort` —— claude start/resume argv 含 `--effort <level>`；codex 含 `-c model_reasoning_effort=<level>`；cursor 忽略；未设置三家均不含 effort 参数；建议清单外模型值原样翻 `--model`
- [x] 3.2 实现：`src/main/agent/adapter.ts` 三家 common 参数函数接 effort 并按家翻译

## 4. 工作流定义的节点 effort

- [x] 4.1 写红测试：`AgentExecConfig.effort` 保存后读回往返保持；枚举外值校验失败给可读原因；旧 `workflow.yaml`（无 effort）载入合法视为未声明
- [x] 4.2 实现：`src/shared/types.ts` 的 `AgentExecConfig` 增 `effort?`；`src/shared/workflow.ts` 序列化/校验；确认 yaml 往返

## 5. 级联解析与注入

- [x] 5.1 写红测试：引擎解析 agent 节点执行配置时 effort 级联「节点声明 > 全局默认 > 不注入」，与 model 同一处解析；聊天/heal 等其它 agent 启动路径带上全局默认 effort
- [x] 5.2 实现：`src/main/engine/engine.ts`、`src/main/agent-runner.ts` 等现有 `model ?? settings.defaultModel` 位置同路解析 effort 并传入 adapter

## 6. UI：combobox 与 effort 控件

- [x] 6.1 写红测试：SettingsPanel「默认模型」combobox——聚焦展示建议列表（别名在前）、点选持久化、手输清单外 id 提交持久化、切 agent 重置模型；「默认 effort」四档互斥选择即时持久化
- [x] 6.2 实现：`SettingsPanel.tsx` 模型控件改 combobox（输入框 + 建议弹层，语义令牌、深浅双主题）、新增 effort 设置项与说明文案；`AgentOnboardingDialog.tsx` 模型选择吃新建议列表（别名为合理缺省）
- [x] 6.3 实现：`WorkflowEditor.tsx` agent 节点执行配置增 effort 选择（含「跟随全局」空态），模型输入同样放开为可输可选
- [x] 6.4 i18n：`zh.ts` / `en.ts` 补 effort 与「自动最新」相关文案

## 7. 收尾验证

- [x] 7.1 `npm run typecheck` 与 `npm run test:run` 全绿
- [x] 7.2 `npm start` dogfood：设置里手输 `claude-fable-5` + effort high，跑一个 agent 节点，确认 argv 与实际行为（登记表/输出面板可见 `--model claude-fable-5 --effort high`）
