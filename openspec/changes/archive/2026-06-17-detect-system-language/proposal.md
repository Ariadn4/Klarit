## Why

应用目前所有界面文案都硬编码为中文，没有任何语言设置，海外用户首次打开只能看到中文，也无从切换。我们希望在用户第一次启动时就贴合他/她的系统语言，并提供一个可随时调整语言的入口——这是后续做完整界面多语言的地基。

## What Changes

- 首次启动时自动读取操作系统语言（`app.getLocale()`），归一化为受支持的语言后，作为「语言」设置持久化保存；此后再启动不再覆盖用户已有选择。
- 新增一份独立的应用设置存储（`settings.json`），与现有 `registry.json` / `session.json` 同一套读写约定，承载「语言」及未来的全局设置。
- 主进程通过 IPC 暴露三个能力：读取系统语言、读取当前语言设置、写入新的语言设置；预加载层和 `KlaritApi` 契约同步扩展。
- 新增「设置」入口与面板：在侧边栏底部、项目切换器旁边增加设置（齿轮）按钮，打开后可查看并切换「语言」，切换即时持久化。
- 当系统语言不在受支持列表内时，回退到默认语言（中文）。
- 范围说明：本 change 只交付「语言偏好的检测、持久化与设置入口」。把已有界面文案接入翻译目录（完整 i18n）不在本次范围内，作为后续 change，由本次确立的语言偏好驱动。

## Capabilities

### New Capabilities
- `language-preference`: 首次启动时基于系统语言的自动检测、归一化、回退与持久化，以及读取/更新当前语言偏好的行为契约。
- `settings-panel`: 应用级设置入口与面板，作为「语言」等全局设置的查看与修改界面。

### Modified Capabilities
<!-- 现有 spec（app-shell-sidebar / project-registry / workspace-windows）的需求不发生变化，无需 delta。 -->

## Impact

- 新增持久化文件：`settings.json`（位于 Electron `userData`，复用 `src/main/store.ts` 的 `readJson` / `writeJson`）。
- `src/shared/types.ts`：新增 `AppSettings` 模型与 `KlaritApi` 上的语言相关方法。
- `src/shared/ipc.ts`：新增语言相关 IPC 通道常量。
- `src/main/index.ts`：启动时加载/初始化设置、实现首启检测、注册新的 IPC handler。
- `src/preload/index.ts` 与 `src/preload/index.d.ts`：暴露新的 API 方法。
- `src/renderer/src/`：侧边栏底部（`components/Sidebar.tsx` 的页脚，与 `ProjectSwitcher` 同排）新增设置（齿轮）按钮，新增 `Settings.tsx` 面板组件；按 `docs/brand/klarit-brand-system.html` 与 `index.css` 的 `@theme` 令牌实现，不另起配色。
- 依赖：无需新增第三方库（不引入 i18n 框架，使用现有 `store.ts` 与可选的 `zustand`）。
