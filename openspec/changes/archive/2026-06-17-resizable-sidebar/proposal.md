## Why

侧边栏当前是固定宽度，用户无法根据文件树深度或项目名长度自行调整——名字长或目录层级深时被截断，想腾出更多主内容区时又只能整段折叠。用户已明确反馈希望能拖动调整侧边栏宽度。

## What Changes

- 在侧边栏与主内容区之间新增一条可拖动的分隔条（resize handle），用户可左右拖动改变侧边栏宽度。
- 宽度有合理的最小/最大约束，避免拖到不可用或挤占主内容区。
- 调整后的宽度按窗口持久化，下次打开该窗口时恢复（与现有折叠状态的持久化方式一致）。
- 折叠状态与宽度互不影响：折叠时隐藏侧边栏，展开后恢复到用户上次设置的宽度。

## Capabilities

### New Capabilities
<!-- 无新增能力，复用现有侧边栏能力 -->

### Modified Capabilities
- `app-shell-sidebar`: 新增「侧边栏宽度可拖动调整」要求——侧边栏从固定宽度改为用户可拖动调整，宽度受最小/最大约束并按窗口持久化。

## Impact

- 受影响代码：
  - 渲染层主布局 `src/renderer/src/App.tsx`（侧边栏 + 主内容区的 flex 容器，宽度状态从这里下发）。
  - 侧边栏组件 `src/renderer/src/components/Sidebar.tsx`（宽度从硬编码 `w-60` 改为动态值，并新增右边缘拖动手柄）。
  - 持久化沿用现有「按窗口」的折叠状态 IPC 模式，跨 `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/index.ts`、`src/main/windows.ts`、`src/shared/types.ts` 新增宽度的读写通道与字段。
- 数据/持久化：在每窗口 `WindowState` 中新增 `sidebarWidth` 字段（与 `sidebarCollapsed` 并列）。
- 依赖：项目目前没有用到 dockview / @dnd-kit / zustand，也无任何现成的分隔/拖拽尺寸组件可复用；以原生指针事件实现拖动手柄，不新增依赖。
- 不影响其它面板行为。
