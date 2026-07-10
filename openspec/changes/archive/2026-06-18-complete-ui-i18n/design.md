## Context

Klarit 的语言「偏好层」已完整：`src/shared/language.ts` 定义 `SupportedLanguage = 'zh' | 'en'`、`DEFAULT_LANGUAGE = 'zh'`、`LANGUAGE_LABELS`、`normalizeLocale`/`coerceLanguage`；`src/main/settings.ts` 首启按系统语言初始化并持久化到 `settings.json`，经 IPC `getLanguage`/`setLanguage` 暴露；`App.tsx` 持有 `language` 状态、挂载时读取并写 `document.documentElement.lang`，切换时持久化并更新 `<html lang>`；设置面板（SettingsPanel.tsx）已有语言下拉。

缺的是「渲染层」：`language` 当前只用于设 `<html lang>` 和回填下拉选中值，不参与任何文案选择。全部 19 个渲染层组件的面向用户文本（可见文案、占位符、`title`、`aria-label`）都硬编码中文，没有任何 i18n 库、词典或 `t()`。

本设计是 `theme-rendering` 之于 `appearance-preference` 的同构对偶：偏好 → 渲染。约束沿用 CLAUDE.md：测试先行、依赖上前沿、语义令牌、动态文档只记现状。

## Goals / Non-Goals

**Goals:**
- 引入由现有 `language` 状态驱动的 i18n 运行时，让界面文案随语言切换即时重渲染。
- 建立 `zh`/`en` 双词典作为界面文案单一来源，覆盖全部可见文案与无障碍标签。
- 抽取 19 个组件中的硬编码中文为词典键；缺键安全回退默认语言，绝不渲染裸键名。
- 词典完整性可被测试校验。

**Non-Goals:**
- 不改动偏好层（`shared/language.ts`、`main/settings.ts`、IPC、设置下拉行为）。
- 不新增第三种语言；仅补齐 `zh`/`en`。
- 不做主进程菜单/原生对话框的本地化（本次范围限定渲染层界面文案）。
- 不引入翻译文件的运行时远程加载/懒加载或外部翻译平台；词典随包内置。
- 不新增 `onLanguageChange` IPC 推送——切换在渲染层内由 React 状态驱动即可。

## Decisions

### 决策 1：用 `react-i18next` + `i18next`，而非自造词典 hook

选 `react-i18next@^17`（配 `i18next@^26`，均为当前最新稳定版，与 React 19 兼容）。

理由：
- 开箱即提供缺键回退（`fallbackLng: 'zh'`）、插值、复数、命名空间——正好对应 specs 的「缺键回退」「带变量用插值」「词典完整性」诸要求，自造需重复实现这些。
- `useTranslation()` 的 `t()` 是稳定的社区惯用法，便于后续被 AI 编程工具批量抽取与维护。
- 切换语言时 `i18n.changeLanguage()` 触发订阅组件重渲染，天然契合「即时翻译」，无需 IPC。

考虑过的替代：**自造 `useT(language)` + 普通对象词典**。更轻、零依赖，且与「纯 React 状态驱动」一致；但需自行实现回退/插值/键校验，且与 `theme-rendering` 用浏览器原生 `data-theme`（确实零依赖）不同，i18n 的横切面更大、惯用库收益明显。故选库。**lingui/react-intl** 排除：react-intl 偏 ICU 重量级、lingui 需编译期提取插件，对本仓 dogfood 节奏偏重。

### 决策 2：i18n 单例初始化于渲染层，词典内置于包

新增 `src/renderer/src/i18n/`：
- `index.ts`：创建并 `init` i18next 单例（`resources: { zh, en }`、`fallbackLng: DEFAULT_LANGUAGE`、`lng` 初值由 App 读到的 `language` 决定、`interpolation.escapeValue: false`——React 已防 XSS）。
- `locales/zh.ts`、`locales/en.ts`：两套词典对象（按组件/区域分组的扁平命名空间，如 `settings.title`、`sidebar.collapse`）。

`App.tsx` 在挂载读到 `language` 后调用 `i18n.changeLanguage(language)`；`onChangeLanguage` 在持久化的同时调用 `changeLanguage(next)` 驱动重渲染。`main.tsx` 顶层 `import './i18n'` 确保单例先于渲染就绪。词典随包打包，无运行时加载。

理由：语言契约（受支持列表/默认/labels）仍只在 `shared/language.ts` 这一处；i18n 只是消费它。词典放渲染层，与「文案是界面关注点」一致，类比 `index.css @theme` 作为令牌源。

### 决策 3：键命名与抽取策略

- 键按「区域.含义」分组（`settings.*`、`sidebar.*`、`workflowEditor.*`、`ruleLibrary.*`、`fileViewer.*`、`agentOnboarding.*`、`topbar.*`、`common.*`）。
- 中文 `zh.ts` 取当前界面现有中文作为权威原文；`en.ts` 同键给出英文译文。
- 含变量处改插值（`t('projects.selectedCount', { count })`），不再拼接字符串。
- 技术专名（`agent`/`git`/`Claude Code`/`model`）作为词典文案内容保留。

### 决策 4：词典完整性用测试守护

加单测：导入 `zh`/`en`，断言扁平化后键集合相等（对称差为空）。配合一条渲染层测试：切到 `en` 后某标志性文案（如设置标题）变为英文、且界面无裸键名。符合 CLAUDE.md「测试先行」。

## Risks / Trade-offs

- [抽取遗漏：个别硬编码字面量漏改，英文界面残留中文] → 用「无裸键名」+ 词典键一致性测试兜底；按探查清单逐组件过（19 个，重灾区 WorkflowEditor/SettingsPanel/RuleLibrary）。
- [`en` 译文质量/长度溢出布局] → 译文先求准确达意；布局用现有语义令牌与弹性容器，长文案处避免定宽；必要时在 review 阶段微调。
- [新增依赖增重 + React 19 兼容] → 选定 `react-i18next@^17`/`i18next@^26` 为当前最新稳定版，明确支持 React 19；体积属可接受的 UI 基础设施。
- [i18next 单例初始化时机早于 React 渲染] → 在 `main.tsx` 顶层 import 初始化，初值用同步可得的默认语言，App 读到持久化值后再 `changeLanguage`，避免首帧裸键/错语言闪烁。
- [测试快照/选择器依赖中文字面量而变脆] → 现有测试若按中文文本断言，抽取后同步更新为按键或按当前语言文案断言。

## Migration Plan

1. 装依赖 → 建 i18n 单例与空骨架词典 → 在 `main.tsx`/`App.tsx` 接入并打通切换（先红后绿的最小闭环）。
2. 逐组件抽取文案到 `zh.ts`（原文）并补 `en.ts`（译文），高频/重灾组件优先。
3. 完整性与渲染测试转绿；手动 dogf8 切换中英文走查关键界面。
- 回滚：i18n 接入与词典抽取是增量的；若需回退可移除 provider 接入，组件仍可暂留 `t()`（取默认语言等价于原中文）。无数据/持久化结构变更，故无数据迁移风险。

## Open Questions

- 是否需要在本次顺带本地化原生菜单/系统对话框？当前列为 Non-Goal，若产品要求再起单独 change。
- `en` 译文是否需要母语者校对？本次以达意为准，校对可作为后续 polish。
