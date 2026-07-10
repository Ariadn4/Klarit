## Why

上一个 change（已归档 `settings-appearance-language`）落地了「外观」偏好（深色/浅色/跟随系统）的存储与下拉入口，但明确不含实际渲染——选了「深色」界面也不变。本 change 补上缺失的一环：把外观偏好真正渲染成深/浅色界面，并让「跟随系统」实时跟随操作系统主题。

## What Changes

- 新增**主题渲染**能力：依据已持久化的「外观」偏好解析出「生效主题」（深/浅），应用到整个应用界面；「跟随系统」时随操作系统明暗实时切换。
- 在 `index.css` 为深色主题新增一套 `@theme` 令牌覆盖（`html[data-theme="dark"]`），组件不改类名、仅令牌值变化即整体翻色。
- 在 `docs/brand/klarit-brand-system.html` **补入深色调色板规范**（品牌文档当前缺夜间配色，按仓库约定先申请并补齐，使设计令牌仍是单一来源）。
- 内嵌**代码编辑器（Monaco）**随主题切换（浅色 `vs` / 深色主题）。
- 主进程窗口 `backgroundColor` 由硬编码改为按生效主题取值，消除深色下首帧白底闪屏；以 Electron `nativeTheme` 作为「跟随系统」与明暗判定的单一来源。
- 说明：内嵌终端（xterm/node-pty）目前尚未进入本仓库依赖，故本 change 不含终端主题；但渲染机制会立成「消费生效主题」的通用模式，终端落地时直接接入。

## Capabilities

### New Capabilities
- `theme-rendering`: 把「外观」偏好解析为「生效主题」（深/浅）并渲染到界面——含跟随系统的实时切换、深色令牌覆盖、Monaco 主题联动、无闪屏首帧。

### Modified Capabilities
- `appearance-preference`: 更新外观偏好时，除持久化外 SHALL 同时驱动「生效主题」更新（原能力仅存储读写、显式不含渲染；本 change 解除该限制并衔接到 `theme-rendering`）。

## Impact

- 代码：
  - `src/renderer/src/index.css`（深色 `@theme` 令牌覆盖）。
  - `src/main/index.ts`（`nativeTheme.themeSource` 接入、窗口 `backgroundColor` 按主题取值、生效主题广播）。
  - `src/shared/ipc.ts` / `src/shared/types.ts` / `src/preload/index.ts`（新增「读取生效主题」与「主题变更」订阅通道）。
  - `src/renderer/src/App.tsx`（启动读生效主题写 `data-theme`、订阅变更、切换外观时联动）。
  - `src/renderer/src/components/MonacoViewer.tsx` 及 `lib/monaco`（按生效主题 set/define 主题）。
- 文档：`docs/brand/klarit-brand-system.html` 新增深色调色板段落。
- 不影响：外观偏好的存储格式与既有读写行为、语言、项目/工作流能力。
- 依赖：无新增 npm 依赖（Monaco、Electron `nativeTheme` 均已具备）。
