## Context

Klarit 当前没有任何国际化基础设施：界面文案全部硬编码为中文，没有设置存储，也没有设置界面。持久化只有手写的 `src/main/store.ts`（`readJson` / `writeJson`），分别支撑 `registry.json` 与 `session.json`。主进程→渲染进程通过一套干净的 `contextBridge` 暴露：通道名集中在 `src/shared/ipc.ts`，契约在 `src/shared/types.ts` 的 `KlaritApi`，预加载在 `src/preload/index.ts` 包薄壳，主进程在 `src/main/index.ts` 的 `registerIpc()` 注册 `ipcMain.handle`。侧边栏折叠设置（`getSidebarCollapsed` / `setSidebarCollapsed`）是贯穿四个文件的现成模板。

本设计为「首启检测系统语言 + 可调语言的设置入口」给出落地方案，并刻意把它做成后续完整 i18n 的地基，而非一次性铺开翻译。

## Goals / Non-Goals

**Goals:**
- 首次启动按系统语言（`app.getLocale()`）初始化「语言」偏好，归一化 + 受支持列表 + 默认回退。
- 用与现有约定一致的方式持久化设置（新增 `settings.json`，复用 `store.ts`）。
- 通过 IPC 暴露读取系统语言 / 读取语言 / 设置语言三个能力，沿用 sidebar 模板。
- 顶栏新增设置入口 + 设置面板，提供「语言」选择项，切换即时持久化。
- 语言归一化与受支持列表的逻辑放在 `@shared`，主进程与渲染进程共用、可单测。

**Non-Goals:**
- 不把现有界面文案接入翻译目录、不交付逐字翻译（独立后续 change）。
- 不引入 i18next/react-i18next 等第三方 i18n 框架。
- 不做按语言的日期/数字本地化格式、不做 RTL 布局。
- 不在本次新建通用 zustand store 体系（语言面板用最小状态即可）。

## Decisions

### 决策 1：新增独立 `settings.json`，复用 `store.ts`，不引入 electron-store
应用级设置与项目注册表、窗口会话是不同关注点，单独成文件最清晰，并能直接套用 `readJson<T>(file, fallback)` / `writeJson(file, data)` 的既有健壮性（缺失/损坏回退 fallback）。
- **取舍**：electron-store 能省点样板，但与「依赖默认上前沿但工具链以编排器为上限、能不加就不加」的取向冲突，且与现有两份 JSON 的写法不一致。否决。
- **形状**：`AppSettings = { language?: SupportedLanguage }`。`language` 可缺省——缺省即「首次启动」的判定信号。

### 决策 2：首次启动 = 「设置里没有 language」，而非单独的 first-run 标志
读取 `settings.json` 后若 `language` 为空，则调用 `app.getLocale()` 归一化并写回；写回后该字段恒存在，天然只跑一次。无需额外的 hasLaunchedBefore 标志。
- **取舍**：单独 first-run 标志会引入第二个需要同步的状态源，易产生「标志已置位但 language 丢失」的不一致。以数据存在性作为信号更简单、自洽。

### 决策 3：语言归一化与受支持列表放在 `src/shared`，纯函数、可单测
新增 `src/shared/language.ts`（随 `@shared` 别名被主进程与渲染进程共用），导出：
- `SUPPORTED_LANGUAGES`（如 `['zh', 'en']`）与 `DEFAULT_LANGUAGE = 'zh'`、`SupportedLanguage` 类型；
- `normalizeLocale(locale: string): SupportedLanguage`——把 `zh-CN` / `zh-Hans` / `en-US` 等映射到基础语言，未命中回退 `DEFAULT_LANGUAGE`；
- `coerceLanguage(value: unknown): SupportedLanguage`——把任意输入收敛为受支持值（用于 setLanguage 的非法值回退与读取时的兜底）。

这样「归一化 / 回退 / 非法值收敛」这组核心行为是公共 API、可直接对照 spec 场景写测试（先红后绿），无需为可测性导出私有。

### 决策 4：IPC 沿用 sidebar 模板，新增三个 invoke 通道
- `src/shared/ipc.ts`：`getSystemLocale: 'settings:systemLocale'`、`getLanguage: 'settings:getLanguage'`、`setLanguage: 'settings:setLanguage'`。
- `src/main/index.ts`：`SETTINGS_FILE = join(app.getPath('userData'), 'settings.json')`；启动时加载 + 首启初始化；`registerIpc()` 内注册三个 handler。`getSystemLocale → app.getLocale()`；`setLanguage` 用 `coerceLanguage` 收敛后 `writeJson` 持久化。注册发生在 `app.whenReady()` 内，`app.getLocale()` 此时可用。
- `src/preload/index.ts` + `index.d.ts` + `types.ts` 的 `KlaritApi`：加 `getSystemLocale()`、`getLanguage()`、`setLanguage(lang)` 三个薄壳方法。

### 决策 5：设置入口放侧边栏底部（项目切换器旁），面板用最小本地状态
侧边栏页脚（`components/Sidebar.tsx`）现仅有 `ProjectSwitcher`。把它改成一排：`ProjectSwitcher` 占主，右侧放设置（齿轮/`Settings` lucide 图标）按钮。新增 `components/Settings.tsx` 承载齿轮按钮 + 向上弹出的「语言」单选弹层（与 `ProjectSwitcher` 的 `bottom-full` 弹出风格一致）。当前语言由 `App.tsx` 用 `useState` 持有（挂载时 `getLanguage` 读取），切换时调用 `window.klarit.setLanguage` 并更新本地状态——本次无需新建全局 store。`language` / `onChangeLanguage` 经 `Sidebar` 透传给 `Settings`。样式严格用 `index.css` 的 `@theme` 令牌，遵循品牌规范，不另起配色/投影。

### 决策 6：本次「切换语言」的可见效果范围
由于完整翻译是后续 change，本次切换语言的可观察效果限定为：当前语言被持久化、设置面板选中态随之更新、（可选）在根节点设置 `document.documentElement.lang`。界面其余文案仍为中文，直到后续 i18n change 接入翻译目录消费该偏好。这一点在 proposal 已声明为范围内/外边界。

## Risks / Trade-offs

- **[语言设置切了却看不到界面变化，用户困惑]** → 在面板内文案/说明明确「界面翻译陆续接入」，并把本次定位为地基；`document.documentElement.lang` 至少让选择有真实落点。后续 i18n change 紧随其后。
- **[`app.getLocale()` 返回格式多样（`zh`、`zh-CN`、`zh-Hans-CN`…）]** → 归一化只取基础语言段并对中文变体做映射，未命中一律回退默认；用 spec 的多场景单测覆盖常见变体。
- **[`settings.json` 损坏导致启动异常]** → 复用 `readJson` 的 try/catch 回退 fallback，损坏即按首启重新初始化，启动不中断（spec 已有对应场景）。
- **[渲染进程拿不到语言或 IPC 失败]** → 读取失败时渲染层回退 `DEFAULT_LANGUAGE`，保证界面始终可用。
- **[未来加语言时多处遗漏]** → 受支持列表与归一化集中在 `src/shared/language.ts` 单一来源，新增语言只改这一处，UI 由列表驱动渲染。
