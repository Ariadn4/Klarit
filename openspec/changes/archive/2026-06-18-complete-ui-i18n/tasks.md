## 1. 接入 i18n 运行时（先红后绿的最小闭环）

- [x] 1.1 安装依赖：`react-i18next@^17`、`i18next@^26`（先 `npm view` 确认 latest 后再装）
- [x] 1.2 写完整性测试（应先红）：导入 `zh`/`en` 词典，断言扁平化键集合相等（对称差为空）
- [x] 1.3 写切换渲染测试（应先红）：渲染接入 i18n 的界面，`changeLanguage('en')` 后某标志性文案（如设置标题）变英文，且无裸键名
- [x] 1.4 创建 `src/renderer/src/i18n/index.ts`：init i18next 单例（`resources:{zh,en}`、`fallbackLng: DEFAULT_LANGUAGE`、`interpolation.escapeValue:false`、`lng` 初值取默认语言）
- [x] 1.5 创建空骨架词典 `src/renderer/src/i18n/locales/zh.ts` 与 `en.ts`（含 `common.*` 起步键）
- [x] 1.6 在 `main.tsx` 顶层 `import './i18n'`；在 `App.tsx` 读到持久化 `language` 后 `i18n.changeLanguage(language)`，并在 `onChangeLanguage` 持久化的同时调用 `changeLanguage(next)`
- [x] 1.7 跑 1.2/1.3 测试转绿，确认最小闭环（切换即时翻译 + 回退）成立

## 2. 抽取组件文案（按重灾→轻量顺序，每组件：抽取到 zh 原文 + 补 en 译文）

- [x] 2.1 SettingsPanel.tsx：导航标签、外观/语言/默认 agent 标签、占位符、空状态文案、`aria-label`
- [x] 2.2 WorkflowEditor.tsx（最重，~142 处）：全部可见文案、占位符、`title`、`aria-label`
- [x] 2.3 RuleLibrary.tsx：列表/操作/空状态文案与无障碍标签
- [x] 2.4 Sidebar.tsx：导航与区段文案、`aria-label`
- [x] 2.5 FileViewer.tsx：文案与无障碍标签
- [x] 2.6 AgentOnboardingDialog.tsx：对话框文案与按钮
- [x] 2.7 WorkflowLibrary.tsx：文案与无障碍标签
- [x] 2.8 Topbar.tsx：折叠/展开侧边栏等 `aria-label`
- [x] 2.9 其余渲染层组件（Settings/ConstitutionSettings/WorkflowPicker/ProjectSwitcher/RepoGroup/GitView/WindowControls/ManageProjectsScreen）逐一抽取；FileTree 无可渲染文案
- [x] 2.10 含变量文案统一改为插值（如 `t('...', { count })`），移除字符串拼接

## 3. 校验与收尾

- [x] 3.1 补/更新词典使 `zh`/`en` 键集合完全一致，完整性测试转绿（并由 `Dictionary` 类型在编译期强约束）
- [x] 3.2 既有测试无需修改：zh 文案与原字面量逐字一致 + 默认语言为 zh，349 个测试全绿
- [x] 3.3 全局自查：渲染层组件无残留硬编码面向用户中文字面量（剩余中文均为注释/JSDoc）
- [x] 3.4 `npm run typecheck` 与 `npm run test:run` 全绿；并 `npm run build` 通过
- [x] 3.5 `npm start` dogfood：用户已切换中/英文走查关键界面并验收通过
