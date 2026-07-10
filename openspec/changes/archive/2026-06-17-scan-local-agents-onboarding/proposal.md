## Why

Klarit 要编排各家 AI 编程工具（Claude Code / Codex / Cursor 等）执行需求，但它现在既不知道用户本地装了哪些 agent，也没有「默认用哪个 agent、哪个模型」的概念——首次启动只检测了界面语言。用户得先把这件事说清楚，后续的需求编排才有可执行的对象。所以在首次启动时扫描本地 agent、并引导用户挑一个默认 agent 和模型，是让产品跑起来的前置一步。

## What Changes

- 新增**本地 agent 扫描**：应用能探测本机已安装的受支持 agent CLI（如 Claude Code / Codex / Cursor），并为每个 agent 提供其可选模型清单。
- 新增**默认 agent / 默认模型偏好**：作为应用级设置持久化保存，可读取与更新，缺省即「未选择」（首次启动信号，类比语言设置的 `undefined`）。
- 新增**首次启动引导弹窗**：首次启动（尚无默认 agent 值）且**扫描到至少一个 agent**时，弹窗引导用户选择默认 agent 及其默认模型；用户可「跳过」。**扫描结果为空时不弹窗**（不打扰、不强制安装）。弹窗只让用户选 agent + 模型，不涉及其它项。
- **修改设置面板**：在「应用设置 → 通用」增加「默认 agent」与「默认模型」两个下拉，随时可改并持久化；模型下拉随所选 agent 联动。

## Capabilities

### New Capabilities
- `agent-detection`: 探测本机已安装的受支持 agent CLI，给出可用 agent 清单及每个 agent 的可选模型清单；探测失败/未安装时安全返回空，不影响启动。
- `agent-preference`: 默认 agent / 默认模型偏好的持久化、读取与更新，以及首次启动「扫描到 agent 才弹、可跳过」的引导弹窗行为。

### Modified Capabilities
- `settings-panel`: 「应用设置 → 通用」新增「默认 agent」「默认模型」设置项（下拉，模型随 agent 联动），即时持久化。

## Impact

- **主进程**：新增 agent 扫描模块（net-new，类比 `src/main/git.ts` 的 `execFile`/`which` 探测）；扩展 `src/main/settings.ts` 的初始化与读写；`src/main/index.ts` 注册新 IPC handler 并在 `app.whenReady()` 内触发扫描。
- **共享层**：`src/shared/types.ts` 扩展 `AppSettings`（新增 `defaultAgent?` / `defaultModel?`）与新增 agent/model 类型；新增纯函数校验/归一化助手；`src/shared/ipc.ts` 增加 agent 相关 channel；`KlaritApi` 暴露新方法。
- **渲染层**：新增首次启动引导弹窗组件；`SettingsPanel.tsx` 的 `app-general` 区新增两个联动下拉；`App.tsx` 持有并下发新状态（沿用现有 `useState` + IPC 模式）。
- **依赖**：暂不需要新增运行时依赖（探测走 Node 内置 `child_process`）。
- **UI**：弹窗与下拉均须遵循 `docs/brand` 品牌规范与 `index.css` 的 `@theme` 设计令牌，深浅两套。
