## 1. 共享层：类型与纯数据/纯函数（测试先行）

- [x] 1.1 在 `src/shared/types.ts` 扩展 `AppSettings`，新增 `defaultAgent?: AgentId` 与 `defaultModel?: string`；新增 `AgentId`、`DetectedAgent`（`{ id; name; models: AgentModel[] }`）、`AgentModel`（`{ id; name }`）类型
- [x] 1.2 先写测试：`src/shared/agents.test.ts` 覆盖 `listSupportedAgents()`、`modelsForAgent(id)`、`coerceDefaultModel(agentId, modelId)`（含：非法 model 回退/清空、切换 agent 后旧 model 不匹配被重置、未知 agent 安全处理）
- [x] 1.3 实现 `src/shared/agents.ts`：受支持 agent 静态表（Claude Code / Codex / Cursor 起步，含各自可执行名与模型清单）+ 上述纯函数，使 1.2 由红转绿

## 2. 主进程：agent 扫描

- [x] 2.1 先写测试：`src/main/agents.test.ts`，对扫描逻辑注入可替换的探测函数，覆盖「检测到部分 agent」「未检测到任何 agent 返回空」「单个探测异常/超时不影响整体」
- [x] 2.2 实现 `src/main/agents.ts`：`scanAgents()` 对受支持 agent 逐一用 `child_process`（跨平台 `where`/`which` + `--version`，类比 `git.ts`）探测，单个 try/catch + 超时，返回 `DetectedAgent[]`（内联其模型清单），永不抛出

## 3. 主进程：偏好读写与首启初始化

- [x] 3.1 先写测试：扩展 `src/main/settings.test.ts`（或同级），覆盖默认 agent/model 的读取、更新即持久化、写入经 `coerceDefaultModel` 归一、设置文件损坏时安全回退为「未选择」、已有 `defaultAgent` 时不视为首启
- [x] 3.2 在 `src/main/settings.ts` 增加 `getDefaultAgent/setDefaultAgent/getDefaultModel/setDefaultModel`，写入前用共享纯函数校验与归一；确认 `defaultAgent === undefined` 作为首启信号，不持久化扫描结果

## 4. IPC 与 preload 接线

- [x] 4.1 在 `src/shared/ipc.ts` 增加 channel：`agents:scan`、`settings:getDefaultAgent`、`settings:setDefaultAgent`、`settings:getDefaultModel`、`settings:setDefaultModel`
- [x] 4.2 在 `src/main/index.ts` 的 `app.whenReady()` 内注册对应 handler，并在初始化段触发一次 `scanAgents()`（异步、不阻塞窗口创建）
- [x] 4.3 在 preload 暴露并扩展 `KlaritApi`（`src/shared/types.ts`）：`scanAgents()`、`getDefaultAgent/setDefaultAgent/getDefaultModel/setDefaultModel`

## 5. 渲染层：首次启动引导弹窗

- [x] 5.1 先写组件测试：`AgentOnboardingDialog` 在「有 agent 列表」时渲染 agent 下拉与联动模型下拉；「确认」回调带所选 agent+model；「跳过」回调不带值；空列表不渲染
- [x] 5.2 实现 `src/renderer/src/components/AgentOnboardingDialog.tsx`（顶层 portal，复用 `SettingsPanel` 浮层与品牌 `@theme` 令牌，深浅两套），agent→model 联动，含「确认」「跳过」
- [x] 5.3 在 `src/renderer/src/App.tsx` 挂载时拉 `getDefaultAgent()` 与 `scanAgents()`：当 `defaultAgent` 未设置且扫描列表非空 → 显示弹窗；确认走 set 持久化、跳过仅关闭；列表为空不显示

## 6. 渲染层：设置 → 应用设置 → 通用

- [x] 6.1 先写测试：`SettingsPanel` 的 `app-general` 区渲染「默认 agent」「默认模型」两个联动下拉，切换 agent 联动模型并触发持久化回调；无检测到 agent 时显示空态而非报错
- [x] 6.2 在 `src/renderer/src/components/SettingsPanel.tsx` 的 `app-general` 区新增两个下拉（复用既有 select 样式与令牌），模型随 agent 联动，切换即调用 set 方法持久化
- [x] 6.3 在 `App.tsx` 持有 `defaultAgent/defaultModel/detectedAgents` 状态并下发到 `SettingsPanel`，沿用现有 props 串联模式

## 7. 验证与收尾

- [x] 7.1 `npm run typecheck` 两套 config 通过
- [x] 7.2 `npm run test:run` 全绿（含新增单测）
- [ ] 7.3 `npm start`（不监听源码，dogfood）手动验证：首启扫到 agent 弹窗可选可跳过、扫不到不弹、设置通用里两下拉联动并持久化、重启保持
