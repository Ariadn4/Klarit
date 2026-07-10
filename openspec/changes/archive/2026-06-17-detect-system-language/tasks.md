## 1. 共享语言工具（先红后绿）

- [x] 1.1 写 `src/shared/language.test.ts`：覆盖 `normalizeLocale`（`en-US→en`、`zh-CN→zh`、`zh-Hans→zh`、未命中 `fr-FR→zh`）、`coerceLanguage`（合法值原样、非法值/`undefined`→`zh`）、以及 `SUPPORTED_LANGUAGES`/`DEFAULT_LANGUAGE` 常量——先确认红
- [x] 1.2 实现 `src/shared/language.ts`：导出 `SupportedLanguage` 类型、`SUPPORTED_LANGUAGES`（`['zh','en']`）、`DEFAULT_LANGUAGE`（`'zh'`）、`LANGUAGE_LABELS`、`normalizeLocale`、`coerceLanguage`，使 1.1 转绿

## 2. 共享契约与 IPC 通道

- [x] 2.1 `src/shared/ipc.ts`：新增 `getSystemLocale`、`getLanguage`、`setLanguage` 三个通道常量（`'settings:...'`）
- [x] 2.2 `src/shared/types.ts`：新增 `AppSettings`（`{ language?: SupportedLanguage }`），并在 `KlaritApi` 加 `getSystemLocale()`、`getLanguage()`、`setLanguage(lang)` 方法签名

## 3. 主进程：设置存储、首启检测与 IPC handler（先红后绿）

- [x] 3.1 写 `src/main/settings.test.ts`：首启无 `language` 时按系统 locale 归一化并持久化、已有 `language` 不被覆盖、`setLanguage` 收敛非法值、损坏文件按首启安全恢复（注入依赖，不依赖 electron）——先确认红
- [x] 3.2 `src/main/settings.ts` + `src/main/index.ts`：纯函数 `initSettings`/`setLanguage`；index 新增 `SETTINGS_FILE`，在 `whenReady` 内用 `normalizeLocale(app.getLocale())` 首启初始化并 `writeJson`（仅一次）
- [x] 3.3 `src/main/index.ts` 的 `registerIpc()`：注册三个 handler——`getSystemLocale→app.getLocale()`、`getLanguage→` 当前设置、`setLanguage→` 收敛后写回并持久化，使 3.1 转绿

## 4. 预加载桥接

- [x] 4.1 `src/preload/index.ts`：为三个方法加 `ipcRenderer.invoke` 薄壳（照搬 sidebar 写法）
- [x] 4.2 `src/preload/index.d.ts`：`Window.klarit` 经 `KlaritApi` 自动覆盖新方法（无需改动）

## 5. 渲染层：设置入口与语言面板（先红后绿）

- [x] 5.1 写 `src/renderer/src/components/Settings.test.tsx`：齿轮按钮点击打开/关闭面板、渲染受支持语言列表、当前语言为选中态、点击另一语言调用 `onChangeLanguage`、重复点当前语言无副作用（选中态保持、不报错）——先确认红
- [x] 5.2 实现 `src/renderer/src/components/Settings.tsx`：齿轮按钮 + 向上弹出的语言单选弹层（风格对齐 `ProjectSwitcher`），用 `SUPPORTED_LANGUAGES`/`LANGUAGE_LABELS` 驱动渲染；样式用 `index.css` `@theme` 令牌、遵循品牌规范
- [x] 5.3 `src/renderer/src/components/Sidebar.tsx`：页脚改为一排，`ProjectSwitcher` 占主、右侧挂 `Settings`；新增 `language`/`onChangeLanguage` props 透传；同步更新 `Sidebar.test.tsx` 渲染辅助
- [x] 5.4 `src/renderer/src/App.tsx`：用 `useState` 持有当前语言，挂载时 `getLanguage` 读取并设置 `document.documentElement.lang`，`onChangeLanguage` 调用 `setLanguage` 持久化并更新状态，透传给 `Sidebar`，使 5.1 转绿

## 6. 验证与收尾

- [x] 6.1 `npm run typecheck` 两套 config 通过
- [x] 6.2 `npm run test:run` 全绿（新增 18 条单测覆盖语言归一化、首启检测、设置面板行为；共 73 条）
- [x] 6.3 `npm run build` 三端打包通过（补 `electron.vite.config.ts` 渲染端 `@shared` 别名——此前渲染层仅以 `import type` 用过 `@shared`，新增运行时值导入需要别名）
- [ ] 6.4 `npm start`（不监听源码）手动校验：首次启动按系统语言初始化、设置面板可切换语言、重启后保持（需用户在桌面端验收）
