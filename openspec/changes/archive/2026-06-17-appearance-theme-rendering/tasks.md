## 1. 生效主题解析（shared，纯函数先行）

- [x] 1.1 写测试 `src/shared/theme.test.ts`：`resolveEffectiveTheme(appearance, systemDark)` —— `dark`→`dark`、`light`→`light`、`system`+systemDark=true→`dark`、`system`+false→`light`；类型 `EffectiveTheme = 'dark' | 'light'`（先红）。
- [x] 1.2 新增 `src/shared/theme.ts`：导出 `EffectiveTheme` 与 `resolveEffectiveTheme`，跑绿 1.1。

## 2. 主进程：nativeTheme 接入与广播

- [x] 2.1 写/扩 `src/main/index.ts` 相关单测（或新建 `src/main/theme.test.ts`）：抽出可测的 `computeEffective(appearance, shouldUseDark)` 与广播载荷构造，覆盖三种外观；断言 `setAppearance` 路径会把生效主题随外观更新（先红）。
- [x] 2.2 `src/main/index.ts`：`setAppearance` handler 内 `nativeTheme.themeSource = appearance`；新增 `theme:getEffective` handler 返回 `nativeTheme.shouldUseDarkColors ? 'dark' : 'light'`。
- [x] 2.3 `src/main/index.ts`：`nativeTheme.on('updated', …)` 与 `setAppearance` 后，向所有窗口 `webContents.send(IPC.themeChanged, effective)`；`src/shared/ipc.ts` 新增 `getEffectiveTheme: 'theme:getEffective'`、`themeChanged: 'theme:changed'`。
- [x] 2.4 `src/main/index.ts`：`createBrowserWindow` 的 `backgroundColor` 按当前生效主题取（深 `#14141c` / 浅 `#f5f1e8`）；外观/系统变化时对已存在窗口 `setBackgroundColor`。

## 3. 预加载与类型契约

- [x] 3.1 `src/shared/types.ts`：klarit API 加 `getEffectiveTheme(): Promise<EffectiveTheme>` 与 `onThemeChange(cb: (t: EffectiveTheme) => void): () => void`。
- [x] 3.2 `src/preload/index.ts`：暴露 `getEffectiveTheme` 与 `onThemeChange`（`ipcRenderer.on` 订阅 + 返回取消函数，镜像 `onFileTreeChange`）。

## 4. 设计令牌：深色覆盖 + 品牌文档

- [x] 4.1 `docs/brand/klarit-brand-system.html`：新增「深色调色板」段落，列出各语义令牌的深色 hex（canvas/paper/stone-*/ink/ink-deep/cobalt-50/500/800 等），作为单一来源说明。
- [x] 4.2 `src/renderer/src/index.css`：新增 `html[data-theme='dark'] { --color-*: … }` 覆盖块，取值与 4.1 一致；浅色保持 `@theme` 默认。
- [x] 4.3 通览深色界面（构建后 `npm start`）抓出并修复「令牌覆盖对硬编码色无效」类问题：① 模态遮罩 `bg-ink/40`→`bg-black/50`（ink 深色翻白导致白罩）；② 工作流编辑器/库/选择器输入框与卡片的硬编码 `bg-white`→`bg-canvas`（7 处，浅色几乎无变化、深色正确翻深）；③ `index.css` 加 `color-scheme`（深 dark / 浅 light）使原生滚动条、`<select>` 弹层、表单控件随主题。

## 5. 渲染层应用主题（App + Monaco）

- [x] 5.1 扩 `src/renderer/src/App.test.tsx`：mock 加 `getEffectiveTheme`/`onThemeChange`；断言挂载后 `document.documentElement` 的 `data-theme` 等于读取值，且 `onThemeChange` 推送新值时 `data-theme` 同步更新（先红）。
- [x] 5.2 `src/renderer/src/App.tsx`：挂载读 `getEffectiveTheme()` 写 `documentElement.dataset.theme`；订阅 `onThemeChange` 更新之；卸载时取消订阅。
- [x] 5.3 Monaco 主题联动改在 `MonacoViewer` 内实现（而非 App + lib/monaco 接缝）：MonacoViewer 已封装 monaco 且经 `React.lazy` 不在测试环境加载，故由它订阅 `onThemeChange` 调 `monaco.editor.setTheme`，App 保持零 monaco 依赖——更干净且天然避开 happy-dom worker 问题。
- [x] 5.4 `src/renderer/src/components/MonacoViewer.tsx`：`monaco.editor.create` 时按当前 `<html data-theme>` 传 `theme`（`vs-dark`/`vs`），避免新开编辑器首帧用默认浅色。

## 6. 验收与回归

- [x] 6.1 `npm run test:run` 全绿；`npm run typecheck` 两套 config 通过。
- [x] 6.2 `npm start` 手动验收通过：三态切换即时翻色、跟随系统实时跟随、深色无白闪、代码查看器随主题；并据复看修了遮罩/输入框/滚动条（见 4.3）。
