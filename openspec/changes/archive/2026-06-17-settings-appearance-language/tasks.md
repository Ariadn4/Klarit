## 1. 共享外观模块（single source）

- [x] 1.1 写测试 `src/shared/appearance.test.ts`：覆盖 `SUPPORTED_APPEARANCES`、`DEFAULT_APPEARANCE === 'system'`、`coerceAppearance`（合法值原样返回、非法值/`undefined`/非字符串回退 `system`）、`APPEARANCE_LABELS` 含三项中文展示名（先红）。
- [x] 1.2 新增 `src/shared/appearance.ts`：导出 `Appearance` 类型、`SUPPORTED_APPEARANCES`、`DEFAULT_APPEARANCE`、`APPEARANCE_LABELS`、`coerceAppearance`，与 `shared/language.ts` 同构，跑绿 1.1。

## 2. 设置存储读写（main）

- [x] 2.1 在 `src/main/settings.test.ts` 增测：`initSettings` 在 `appearance` 缺省时返回 `system`、已有值时收敛沿用；新增 `setAppearance` 收敛并写回（合法/非法/损坏文件回退 `system`）（先红）。
- [x] 2.2 `src/shared/types.ts`：`AppSettings` 增加可选 `appearance?: Appearance`。
- [x] 2.3 `src/main/settings.ts`：`initSettings` 读取时用 `coerceAppearance` 兜底 `appearance`；新增 `setAppearance(current, value, deps)` 与 `setLanguage` 同形，跑绿 2.1。

## 3. IPC 链路

- [x] 3.1 `src/shared/ipc.ts`：新增通道 `settings:getAppearance`、`settings:setAppearance`。
- [x] 3.2 `src/shared/types.ts`：在 klarit API 接口加 `getAppearance(): Promise<Appearance>`、`setAppearance(a): Promise<Appearance>`。
- [x] 3.3 `src/preload/index.ts`：暴露 `getAppearance`/`setAppearance`，镜像 language。
- [x] 3.4 `src/main/index.ts`：注册两个 IPC handler，读写经 `main/settings.ts` 持久化。

## 4. 设置面板 UI（外观新增 + 语言改下拉 + 去标题）

- [x] 4.1 更新 `src/renderer/src/components/Settings.test.tsx` / `SettingsPanel` 相关测试：断言「通用」含「外观」下拉（三选项、默认/当前选中态、onChange 触发持久化回调）、「语言」为下拉（`<select>` 语义，替换原 `role=radio` 断言）、右侧内容区不再渲染「设置」标题文字（先红）。
- [x] 4.2 `SettingsPanel.tsx`：把「语言」从 radio 列表改为原生 `<select>`（value 绑定当前语言、onChange 调 `onChangeLanguage`），样式对齐品牌令牌（参考 `docs/brand/klarit-brand-system.html` 与 `index.css` `@theme`，不另起配色/投影）。
- [x] 4.3 `SettingsPanel.tsx`：在「通用」新增「外观」`<select>`（深色/浅色/跟随系统，由 `SUPPORTED_APPEARANCES` + `APPEARANCE_LABELS` 驱动），接 `appearance` / `onChangeAppearance` props。
- [x] 4.4 `SettingsPanel.tsx`：移除右侧内容区顶部 `<h2>设置</h2>` 标题，保留关闭按钮与 dialog 的 `aria-label`。
- [x] 4.5 `Settings.tsx`：透传新增的 `appearance` / `onChangeAppearance` props 到 `SettingsPanel`，跑绿 4.1。

## 5. 应用接线（App）

- [x] 5.1 `src/renderer/src/App.tsx`：新增 `appearance` 状态，启动 `getAppearance()` 读入；`onChangeAppearance` 调 `setAppearance()` 持久化并更新 state（**不**写 `document.documentElement`，不渲染主题）；把 props 传入 `<Settings>`。

## 6. 验收与回归

- [x] 6.1 `npm run test:run` 全绿；`npm run typecheck` 两套 config 通过。
- [ ] 6.2 `npm start` 手动验收：通用区出现外观下拉（默认「跟随系统」）与语言下拉，切换后重启沿用；右侧顶部无「设置」标题；界面配色无变化（确认未渲染主题）。
