## 1. 持久化层：宽度通道与每窗口状态

- [x] 1.1 在 `src/shared/ipc.ts` 的 `IPC` 中新增 `getSidebarWidth: 'sidebar:getWidth'` 与 `setSidebarWidth: 'sidebar:setWidth'`
- [x] 1.2 在 `src/shared/types.ts` 给 `WindowState` 加可选字段 `sidebarWidth?: number`，并在 `KlaritApi` 加 `getSidebarWidth: () => Promise<number>` 与 `setSidebarWidth: (width: number) => Promise<void>` 的签名与注释
- [x] 1.3 先写 `windows.ts` 的测试：`WinCtx` 携带 `sidebarWidth`，`getSidebarWidth/setSidebarWidth` 读写正确，`snapshotSession()` 输出含宽度，`openProject(state)` 与 `createEmptyWindow()` 能恢复/默认宽度（缺省回退默认值）——确认先红
- [x] 1.4 在 `src/main/windows.ts` 实现上述行为：`WinCtx` 加 `sidebarWidth`，加 `getSidebarWidth/setSidebarWidth(win)`，`register()`/`createEmptyWindow()`/`openProject()`/`snapshotSession()` 一并带上宽度（缺省回退 `DEFAULT_WIDTH`）——转绿
- [x] 1.5 在 `src/main/index.ts` 注册 `sidebar:getWidth` / `sidebar:setWidth` 两个 handler，转发到 `WindowManager`（对照现有 `sidebar:get`/`sidebar:set`）
- [x] 1.6 在 `src/preload/index.ts` 暴露 `getSidebarWidth` / `setSidebarWidth`（对照现有折叠态桥接）

## 2. 宽度常量与钳制

- [x] 2.1 先写钳制函数测试：定义 `MIN_SIDEBAR_WIDTH`(180) / `DEFAULT_SIDEBAR_WIDTH`(240) / `MAX` 上限，`clampSidebarWidth(width, windowWidth)` 钳制到 `[MIN, min(绝对上限, windowWidth*0.5)]`，并对越界、缺省值各有用例——确认先红
- [x] 2.2 实现 `clampSidebarWidth` 与常量——放在 `src/shared/sidebar.ts`（main 与 renderer 共用，因 `windows.ts` 也需 `DEFAULT_SIDEBAR_WIDTH`；较 tasks 原定的「渲染层」略上提到 shared），转绿

## 3. 渲染层：可拖动分隔条与受控宽度

- [x] 3.1 先写 `Sidebar` 组件测试：接收 `width` prop 时根元素 `<aside>` 应用对应内联宽度（不再是固定 `w-60`），且渲染出一个带 `col-resize` 光标、可触发拖动回调的分隔条——确认先红
- [x] 3.2 在 `src/renderer/src/components/Sidebar.tsx` 把 `w-60` 改为 `style={{ width }}`（保留 flex/border 等其余类），新增右边缘分隔条元素与 `onResizeStart`/拖动相关回调 props
- [x] 3.3 先写 `App` 交互测试：挂载时调用 `getSidebarWidth()` 初始化宽度；拖动分隔条经过钳制后更新宽度并体现在布局上；拖动结束调用一次 `setSidebarWidth(finalWidth)`；折叠后再展开宽度仍为用户上次值——确认先红
- [x] 3.4 在 `src/renderer/src/App.tsx` 新增 `width` 状态：挂载 `getSidebarWidth().then(setWidth)`；实现指针拖动（pointerdown 记录起点+捕获、pointermove 钳制后 `setWidth`、pointerup 释放并 `setSidebarWidth`）；拖动态下加 `select-none`；把 `width` 与拖动回调下发给 `<Sidebar>`——转绿

## 4. 品牌与收尾

- [x] 4.1 分隔条做成默认隐形（透明命中区）、hover 时显形为细线；对照 `docs/brand/klarit-brand-system.html` 取细线颜色（用交互强调色 `cobalt-300`），规范缺失则按最克制方案实现并记录需向用户申请补充
- [x] 4.2 `npm run typecheck` 两套 config 通过；`npm run test:run` 全绿（91 用例）；`npm run build` 三端产物构建通过
- [x] 4.3 用 `npm start`（不监听源码）dogfood 验证：拖动加宽/收窄、钳制边界、关闭重开恢复宽度、折叠再展开恢复用户宽度 ——用户在 GUI 内目视确认通过
