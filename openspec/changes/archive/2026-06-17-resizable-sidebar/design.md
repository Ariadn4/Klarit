## Context

侧边栏目前是固定宽度：`Sidebar.tsx:35` 上写死 `w-60`（240px），没有任何控制宽度的状态、prop 或常量。布局是纯 flexbox——`App.tsx:126` 的 flex 行里，`!collapsed` 时渲染 `<Sidebar>`，旁边是占满剩余空间的 `<main>`。

关于持久化，项目里**没有 dockview、没有 zustand、没有 @dnd-kit 的实际使用**（CLAUDE.md 里列的 dockview 只在文档/归档里出现，源码未引入），也没有任何现成的分隔条/拖拽改尺寸组件。唯一已持久化的布局状态是「折叠态」，它走的是一条「按窗口」的 IPC 链：

- 渲染层 `App.tsx`：`useState(collapsed)`，挂载时 `getSidebarCollapsed()` 读、切换时 `setSidebarCollapsed(next)` 写。
- 通道名 `src/shared/ipc.ts`：`sidebar:get` / `sidebar:set`。
- preload `src/preload/index.ts` 与 main `src/main/index.ts` 的 handler 转发。
- 每窗口状态在 `src/main/windows.ts`：`WinCtx.sidebarCollapsed`，由 `snapshotSession()` 写入 `WindowState`、`openProject()` 恢复。
- 类型 `src/shared/types.ts`：`WindowState.sidebarCollapsed` 与 `KlaritApi.getSidebarCollapsed/setSidebarCollapsed`。

本设计要在不引入新依赖的前提下，给侧边栏加一条可拖动分隔条，并复用上述「按窗口」模式持久化宽度。

## Goals / Non-Goals

**Goals:**
- 侧边栏右边缘有一条可拖动分隔条，拖动实时改变侧边栏宽度，主内容区相应伸缩。
- 宽度被钳制在最小/最大之间（建议最小 180px，最大为窗口宽度的某比例，如 `min(560px, 窗口宽度的 50%)`）。
- 宽度按窗口持久化、跨会话恢复；折叠再展开恢复到用户上次宽度而非默认。
- 不新增运行时依赖，用原生指针事件实现。

**Non-Goals:**
- 不引入 dockview / 通用面板分隔系统（即便 CLAUDE.md 提到 dockview，本次不为单条侧边栏引入它）。
- 不做右侧/其它面板的可调宽，不做多面板布局。
- 不把折叠态/宽度迁移到 localStorage 或新建 zustand store——沿用现有 IPC 链。
- 不改文件树、项目切换器、折叠开关等既有行为。

## Decisions

### 决策 1：宽度状态放在 `App.tsx`，以内联 `style` 下发给 `Sidebar`
- **做法**：`App.tsx` 新增 `const [width, setWidth] = useState(DEFAULT_WIDTH)`，挂载时 `getSidebarWidth()` 读取并 `setWidth`。把 `width` 作为 prop 传给 `<Sidebar>`；`Sidebar.tsx:35` 把 `w-60` 换成 `style={{ width }}`（保留其余 flex/border 类，去掉固定宽度类）。
- **为什么**：宽度状态须与 `collapsed` 同层，因为 `App.tsx` 已是组合侧边栏+主区的唯一布局点，且分隔条要同时影响两侧。沿用现有「状态在 App、Sidebar 受控」的结构，改动面最小。
- **备选**：在 `Sidebar` 内部自管宽度——否，App 才掌握布局且需持久化协调，状态下沉会让持久化与折叠协调更绕。

### 决策 2：拖动用原生指针事件，不引依赖
- **做法**：分隔条是一个窄的可聚焦元素（放在 `<Sidebar>` 右边缘或 App 里 Sidebar 与 main 之间）。`onPointerDown` 时 `setPointerCapture` 并记录起始 `clientX` 与起始宽度；`onPointerMove` 按位移算新宽度并 `setWidth`（先钳制到 [MIN, MAX]）；`onPointerUp` 释放捕获并把最终宽度 `setSidebarWidth(width)` 持久化。光标用 `cursor-col-resize`。
- **为什么**：项目无任何可复用的分隔/拖拽尺寸组件，@dnd-kit 也未被使用且更适合排序拖拽而非尺寸拖拽；指针事件 + pointer capture 是改尺寸的标准轻量方案，零依赖、行为可控。
- **备选**：CSS `resize: horizontal`——否，外观不可控、不易钳制与持久化，且方向/手柄样式难符合品牌规范。引入 @dnd-kit/第三方 splitter——否，违反「不为单条侧边栏引入重型依赖」。

### 决策 3：持久化只在拖动结束时写一次，复用 `sidebar:*` 同款 IPC 链
- **做法**：新增通道 `sidebar:getWidth` / `sidebar:setWidth`（`ipc.ts`），preload 暴露 `getSidebarWidth/setSidebarWidth`（`types.ts` 的 `KlaritApi` 同步加签名），main 加 handler，`windows.ts` 的 `WinCtx` 加 `sidebarWidth` 字段、`snapshotSession()`/`openProject()`/`createEmptyWindow()`/`register()` 一并带上，`WindowState` 加 `sidebarWidth?: number`。
- **为什么**：与折叠态完全对称，按窗口存储语义一致、可维护；拖动过程中频繁 IPC 没必要——拖动只更新本地 React state，松手才落盘一次。
- **备选**：拖动中节流持续写——否，无收益且增 IPC 噪音。

### 决策 4：折叠与宽度解耦
- **做法**：宽度状态独立于 `collapsed`；折叠时 `App.tsx` 仍按现有逻辑不渲染 `<Sidebar>`（连分隔条一起消失），展开时用持久化的 `width` 渲染。`WindowState.sidebarWidth` 缺省（老会话/新窗口）时回退 `DEFAULT_WIDTH`（240，与现 `w-60` 等值，保证既有观感不变）。
- **为什么**：两个关注点正交，分开存最直观，也满足 spec「折叠再展开恢复用户宽度」。

## Risks / Trade-offs

- **[拖动越过窗口/主区被挤没]** → 用 MAX 上限（`min(绝对上限, 窗口宽度比例)`）钳制；`<main>` 保留 `min-w-0`，保证主区不被完全挤掉。
- **[拖动时选中文本/闪烁]** → 指针按下期间用 pointer capture，并在拖动态下对容器加 `select-none`；不依赖全局 mousemove 监听，避免捕获泄漏。
- **[旧会话无 `sidebarWidth` 字段]** → 字段设为可选并在读取处回退默认值，向后兼容、无需迁移。
- **[最小宽度过小导致内容溢出]** → MIN 取能容纳项目切换器/文件树缩进的经验值（建议 180px），并在 spec 的钳制场景中覆盖。
- **[品牌规范]** → 分隔条的视觉（宽度、hover 颜色、是否显隐）须对照 `docs/brand/klarit-brand-system.html`；若规范未定义分隔条样式，按最克制方案（透明命中区 + hover 细线）实现，必要时向用户申请补充规范。

## Resolved Decisions

- **尺寸**：MIN = 180px，DEFAULT = 240px（与现 `w-60` 等值），MAX = `min(560px, 窗口宽度 × 50%)`。dogfood 后可微调。
- **分隔条样式**：默认隐形（仅留透明命中区），hover 时显形为一条细线；按 `docs/brand/klarit-brand-system.html` 取细线颜色。
- **重置默认宽度**：不做（不加双击重置等交互）。
