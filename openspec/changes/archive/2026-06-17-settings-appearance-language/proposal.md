## Why

设置面板「应用设置-通用」目前只有「语言」一项，缺少外观（深色/浅色）偏好的入口；语言用一列单选按钮呈现，占空间且与未来要加的外观项风格不统一。同时右侧内容区顶部还顶着一个多余的「设置」标题，与左侧导航重复。统一成下拉选择并补上外观入口，能让通用设置更紧凑、可扩展。

## What Changes

- 在「应用设置-通用」新增「外观」设置项，下拉可选「深色」「浅色」「跟随系统」，默认「跟随系统」；选择后立即持久化，重启沿用。
- 「语言」从单选按钮列表改为下拉选择样式，行为（即时生效 + 持久化）不变。
- 去掉设置面板右侧内容区顶部的「设置」标题（关闭按钮保留）。
- **本 change 不包含界面外观的实际渲染**：只新增并持久化「外观」偏好与其下拉入口，不真正切换应用配色/主题（深浅色渲染留待后续 change）。

## Capabilities

### New Capabilities
- `appearance-preference`: 应用外观偏好的存储与读写——取值为「深色 / 浅色 / 跟随系统」，默认「跟随系统」，持久化于应用设置存储，提供读取与更新能力（不含主题渲染）。

### Modified Capabilities
- `settings-panel`: 通用设置新增「外观」下拉项；「语言」项由单选列表改为下拉样式；移除右侧内容区顶部的「设置」标题。

## Impact

- 代码：`src/renderer/src/components/SettingsPanel.tsx`（外观下拉、语言改下拉、移除标题）、`src/renderer/src/App.tsx`（外观状态与回调）、`src/main/settings.ts`（外观读写）、`src/shared/types.ts`（`AppSettings.appearance` 字段与 IPC 接口）、`src/shared/ipc.ts`（新增外观通道）、`src/preload/index.ts`、`src/main/index.ts`（IPC 注册）。
- 新增共享模块 `src/shared/appearance.ts`（受支持外观值、默认值、展示名、收敛函数），与 `src/shared/language.ts` 对齐。
- 不影响：实际界面配色、现有语言行为、项目设置与工作流相关能力。
