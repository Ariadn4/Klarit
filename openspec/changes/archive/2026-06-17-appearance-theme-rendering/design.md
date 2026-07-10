## Context

外观偏好（`dark`/`light`/`system`，默认 `system`）已落地，存于 `settings.json`，链路 `shared/appearance.ts` → `main/settings.ts` → IPC → `App.tsx`，但上一个 change 显式不渲染。配色用 Tailwind v4 `@theme` 语义令牌（`canvas`/`paper`/`stone-*`/`ink`/`cobalt-*` 等）定义在 `index.css`，组件全程引用这些令牌（如 `bg-canvas`/`text-ink`/`border-stone-100`）。品牌文档 `docs/brand/klarit-brand-system.html` 目前**只有浅色调色板**。内嵌代码查看器 Monaco 未显式设主题（默认浅色 `vs`）；内嵌终端（xterm/node-pty）尚未进入依赖。主窗口 `backgroundColor` 硬编码 `#f5f1e8`（浅色 paper）。

## Goals / Non-Goals

**Goals:**
- 把外观偏好解析为「生效主题」（深/浅）并渲染整个应用界面；「跟随系统」实时跟随 OS 明暗。
- 深色配色以**令牌覆盖**实现（组件不改类名），令牌仍是单一来源；并把深色调色板补进品牌文档。
- Monaco 随生效主题切换；窗口首帧按主题着色，消除深色启动白闪。

**Non-Goals:**
- 不改外观偏好的存储格式与既有读写行为。
- 不做终端主题（xterm 尚未引入）——仅立好「消费生效主题」的模式供其日后接入。
- 不引入用户自定义配色/多主题；只有深、浅两套。

## Decisions

- **生效主题单一来源 = Electron `nativeTheme`（主进程）**。`setAppearance(v)` 时令 `nativeTheme.themeSource = v`（`'dark'|'light'|'system'` 直接对应）；生效主题 = `nativeTheme.shouldUseDarkColors ? 'dark' : 'light'`。理由：`nativeTheme` 原生处理「跟随系统」与 OS 实时变化（`nativeTheme.on('updated')`），还能驱动原生 chrome 与窗口底色；比渲染层 `matchMedia` 少一套订阅且语义更准。
- **主进程广播生效主题**：新增 IPC——`theme:getEffective`（renderer 拉取当前生效主题）与 `theme:changed`（main→所有 renderer 广播）。触发广播的时机：`setAppearance` 之后、`nativeTheme` `updated` 事件。preload 暴露 `getEffectiveTheme()` 与 `onThemeChange(cb)`。
- **渲染层用 `data-theme` 属性翻令牌**：`App.tsx` 启动拉 `getEffectiveTheme()` 写 `document.documentElement.dataset.theme`，并订阅 `onThemeChange` 更新之。`index.css` 新增 `html[data-theme='dark'] { --color-*: … }` 覆盖语义令牌值；浅色保持 `@theme` 默认（亦可显式 `data-theme='light'`）。组件因引用令牌而自动翻色，零类名改动。
- **深色调色板（初稿，写入品牌文档 + index.css，待你审阅微调）**：中性反相、品牌色在暗底提亮以保 AA 对比——
  - `--color-canvas:#14141c`，`--color-paper:#1c1c28`（窗口/面板底）
  - `--color-stone-100:#2c2c3a`（边框/hover），`--color-stone-300:#3f3f50`
  - `--color-stone-600:#a0a0ad`（次要文字），`--color-stone-800:#d8d6e0`
  - `--color-ink:#eceaf2`（主文字），`--color-ink-deep:#f6f5fa`
  - `--color-cobalt-500:#5b78ff`（主色提亮），`--color-cobalt-50:#1e2a5e`、`--color-cobalt-800:#aebcff`（设置导航选中态 `bg-cobalt-50 text-cobalt-800` 在暗底正确反转）
  - signal/语义/state 色暂沿用（暗底已可读），如审阅发现对比不足再调。
- **Monaco 主题联动**：`monaco.editor.setTheme` 是全局副作用——`App.tsx` 在主题 effect 里调用（`dark`→`vs-dark`，`light`→`vs`）；`MonacoViewer` 创建时按当前生效主题初始化，避免新开编辑器闪一下默认浅色。首版用内置 `vs-dark`/`vs`；如需贴合品牌再 `defineTheme`（列入开放项）。
- **窗口无闪屏**：`createBrowserWindow` 的 `backgroundColor` 由当前生效主题取（深 `#14141c` / 浅 `#f5f1e8`）；OS/外观变化时对已存在窗口 `win.setBackgroundColor(...)`。

## Risks / Trade-offs

- [覆盖 `cobalt-50`/`cobalt-800` 等具体色阶会影响其所有引用处，不止设置导航] → 仅覆盖语义中性色 + 已确认在用的少量 cobalt 阶；实现后通览深色界面排查个别突兀处，必要时改用更语义化的令牌（如新增 `--color-surface-active`）而非覆盖通用色阶。
- [深色取值未经设计师终审] → 先写初稿入品牌文档 + 令牌并交你审阅；调色板集中在一处，微调成本低。
- [Monaco 内置 `vs-dark` 与品牌深色底略有色差] → 接受首版；开放项里留 `defineTheme` 贴合。
- [主题广播与外观持久化两条链路时序] → 以 `nativeTheme` 为唯一真值源，`setAppearance` 先 set `themeSource` 再读 `shouldUseDarkColors` 广播，避免本地各算一份导致不一致。

## Migration Plan

- 纯增量：浅色为默认令牌，旧行为不变；深色仅在 `data-theme='dark'` 下生效。无数据迁移。
- 回滚：移除 `data-theme` 应用与深色令牌块即恢复纯浅色；外观偏好仍可读写（回到「存而不渲染」）。

## Open Questions

- Monaco 是否需要 `defineTheme` 自定义深色以严格贴合品牌底色（首版先用内置 `vs-dark`）。
- 深色调色板初稿的最终 hex 以你审阅品牌文档后的批注为准。
