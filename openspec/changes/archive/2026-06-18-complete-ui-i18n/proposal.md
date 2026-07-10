## Why

语言偏好的「存储与选择」早已就绪（`language-preference`：检测系统语言、持久化 `zh`/`en`、设置里有切换下拉、启动写 `<html lang>`），但界面文案至今全是硬编码中文——切到 English 只改了 `<html lang="en">`，界面纹丝不动。这就像有了「外观偏好」却没有 `theme-rendering`：偏好能选，却没有把它渲染出来的那一半。本次补齐缺失的「翻译渲染层」，让界面真正随语言切换。

## What Changes

- 引入 i18n 运行时（翻译库 + 词典 + 翻译 hook），作为渲染层消费已有的 `language` 状态——类比 `data-theme` 驱动令牌覆盖那样，由 `language` 驱动文案选择。
- 建立 `zh`/`en` 两套词典作为文案单一来源（默认 `zh`），覆盖全部界面可见文案与无障碍标签（`aria-label`/`title`/占位符等）。
- 把 19 个渲染层组件中的硬编码中文逐一抽取为词典键（含 SettingsPanel、WorkflowEditor、RuleLibrary、Sidebar、FileViewer、AgentOnboardingDialog 等）。
- 切换语言即时重渲染（依托现有 App 内的 React `language` 状态，无需重启、无需新增 IPC 推送）。
- 缺失翻译键时回退到默认语言（`zh`）文案，绝不渲染裸键名。
- 带变量/复数的文案通过插值表达，不靠中文字符串拼接。

## Capabilities

### New Capabilities
- `ui-localization`: 把已选「语言」偏好渲染到整个界面——提供翻译机制（词典 + 翻译入口）、`zh`/`en` 双词典作为文案单一来源、切换语言即时翻译、缺键安全回退到默认语言，以及全部界面文案与无障碍标签的可本地化。这是 `language-preference`（存储/选择）缺失的「渲染」对偶，类比 `theme-rendering` 之于 `appearance-preference`。

### Modified Capabilities
<!-- 无：language-preference 的「存储/选择」需求不变；settings-panel 的切换 UI 已存在，行为不变。新增的「切换即时翻译/缺键回退」属于新能力 ui-localization。 -->

## Impact

- **新增依赖**：i18n 运行时库（取最新稳定版，design 定型；当前无任何 i18n 依赖）。
- **新增代码**：渲染层 i18n 模块（词典 `zh`/`en` + 翻译 hook/入口），自然落在 `src/renderer/src/`（词典与 hook），语言契约沿用既有 `src/shared/language.ts`。
- **改动代码**：`src/renderer/src/components/` 下全部 19 个组件的文案抽取；`App.tsx` 接入 i18n provider/初始化并在 `language` 变更时驱动重渲染。
- **不改动**：`src/shared/language.ts`、`src/main/settings.ts`、IPC 契约、设置里的语言下拉——存储与选择层保持原样。
- **测试**：词典完整性（两套键齐全、无缺键）、缺键回退、切换语言后关键界面文案改变、无裸键名渲染。
