## Context

设置面板已落地（`SettingsPanel.tsx` 模态 + 左侧分组导航），「应用设置-通用」当前仅有「语言」一项，用一列单选按钮（`role=radio`）呈现。语言偏好通过 `AppSettings.language` 持久化于 userData 的 `settings.json`，链路为 `shared/language.ts`（受支持值/默认/收敛）→ `main/settings.ts`（初始化/写入）→ IPC（`settings:getLanguage` / `settings:setLanguage`）→ `preload` → `App.tsx`。

本次要在同一「通用」区新增「外观」偏好，并把语言与外观都改成下拉样式，同时去掉右侧内容区顶部那个与左导航重复的「设置」标题。明确约束：**不渲染实际深浅色主题**——外观偏好只存储和读写，不改变应用配色。

## Goals / Non-Goals

**Goals:**
- 新增 `appearance` 应用偏好（`dark` / `light` / `system`，默认 `system`），存储与读写链路与 `language` 对齐。
- 「外观」与「语言」在「通用」区以下拉（`<select>` 风格）呈现，选中即时生效并持久化。
- 移除设置面板右侧内容区顶部的「设置」标题（保留关闭按钮）。

**Non-Goals:**
- 不实现深色/浅色主题的实际渲染，不改 `@theme` 令牌、不切换应用配色。
- 不改动语言已有的检测/回退/持久化行为。
- 不动项目设置、工作流相关区块。

## Decisions

- **新增 `src/shared/appearance.ts`，与 `language.ts` 同构**：导出 `Appearance` 类型（`'dark' | 'light' | 'system'`）、`SUPPORTED_APPEARANCES`、`DEFAULT_APPEARANCE = 'system'`、`APPEARANCE_LABELS`、`coerceAppearance(value): Appearance`。理由：复用已被验证的「单一来源 + 收敛兜底」模式，UI 由数组驱动渲染，新增取值只改一处。
- **`AppSettings` 增加可选 `appearance?: Appearance`**：与 `language?` 一样「缺省即未初始化」。读取时在 `main/settings.ts` 用 `coerceAppearance(stored.appearance)`（`undefined` → 默认 `system`）。`setAppearance(current, value, deps)` 与现有 `setLanguage` 同形：收敛后写回。理由：外观默认值不依赖系统语言那类副作用，逻辑比 language 更简单，沿用同一函数族即可。
- **新增 IPC 通道 `settings:getAppearance` / `settings:setAppearance`**，在 `shared/ipc.ts`、`shared/types.ts`（`getAppearance/setAppearance` 接口）、`preload/index.ts`、`main/index.ts` 各加一对，镜像 language 现有注册。
- **UI 用原生 `<select>` 而非自绘下拉**：语言与外观都改成 `<select>`，`value` 绑定当前值，`onChange` 调用回调。理由：原生 select 自带键盘可达性与选中态，样式上加 Tailwind 类对齐品牌令牌即可，避免引入自绘弹层的可达性负担；与「不另起一套配色/投影」一致。语言由此从 `role=radio` 列表迁移为单个 `<select>`。
- **移除右侧 header 的 `<h2>设置</h2>`**：保留含关闭按钮的那条 header bar（或将关闭按钮右对齐保留），仅删标题文字。`aria-label="设置"` 仍在 dialog 根上，可访问名不丢失。
- **`App.tsx` 增加 `appearance` 状态与 `onChangeAppearance`**：启动时 `getAppearance()` 读入；切换时 `setAppearance()` 持久化并更新本地 state。因不渲染主题，**不**写 `document.documentElement` 的 class/data 属性（留待后续 change）。

## Risks / Trade-offs

- [用户误以为选了外观就能变色] → 本 change 仅存偏好不渲染；通过 proposal/spec 明确「不含渲染」，UI 文案保持中性，后续 change 接主题渲染即可消费该偏好。
- [语言从 radio 改 select 影响既有测试] → `Settings.test.tsx` 等可能断言 `role=radio`；实现阶段需同步更新这些测试断言为 select 语义（先红后绿）。
- [原生 select 跨平台样式差异] → 用最小 Tailwind 包裹并接受系统原生下拉外观；与品牌令牌仅做颜色/边框对齐，不追求像素级自绘。

## Migration Plan

- 纯增量：新增字段为可选，旧 `settings.json`（仅含 language）读取时 `appearance` 走默认 `system`，无需数据迁移。
- 回滚：移除新增 IPC/字段/UI 即可，`settings.json` 中遗留的 `appearance` 字段对旧逻辑无害（被忽略）。

## Open Questions

- 无（外观渲染的承接 change 另议；本 change 范围已固定为「偏好 + 下拉 UI + 去标题」）。
