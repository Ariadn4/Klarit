## 1. 主进程：注册表与窗口路由

- [x] 1.1 在 `registry-core.ts` 新增 `removeProject(registry, projectId)`：从 `projects` 删除该 group；写测试覆盖删除存在/不存在的项目
- [x] 1.2 在 `WindowManager`（`windows.ts`）新增 `openOrFocus(projectId)`：①已绑定该项目的窗口→`focus()`；②存在 `UNBOUND` 空窗口→`bindWindow`；③否则 `openProject` 新窗口；返回落点窗口
- [x] 1.3 为 `openOrFocus` 写单测：三种分支各一例（已开聚焦 / 空窗就地 / 新窗口），并验证「已绑定窗口选别的项目仍开新窗口」不被破坏
- [x] 1.4 让主窗口 `project:open` 改调 `manager.openOrFocus(projectId)`，确认现有 workspace-windows 用例仍通过

## 2. 主进程：管理窗口与新 IPC

- [x] 2.1 在 `shared/ipc.ts` 增加常量：`manageOpen`、`manageClose`、`manageImportProject`、`removeProject`、`showItemInFolder`、`getAppVersion`
- [x] 2.2 `createBrowserWindow` 支持「管理窗口」变体：加载时附带视图标记（`?view=manage`/hash），不进 `WindowManager.ctxs`
- [x] 2.3 实现管理窗口单例引用 + `manage:open`（无则建、有则 `focus()`）与 `manage:close`（关闭并清引用）
- [x] 2.4 实现 `app:getVersion` → `app.getVersion()`
- [x] 2.5 实现 `shell:showItemInFolder`（参数路径）→ `shell.showItemInFolder(path)`
- [x] 2.6 实现 `project:remove` → `removeProject` + `saveRegistry`，返回更新后的项目列表
- [x] 2.7 实现管理窗口的「打开项目」：新 IPC 调 `openOrFocus(projectId)` 后关闭管理窗口（不走 sender 绑定路径）
- [x] 2.8 实现 `manage:importProject`：复用 `importProject` 选目录导入，成功后 `openOrFocus(project.id)` 并关闭管理窗口

## 3. 预加载层

- [x] 3.1 在 preload + `shared/types.ts` 的 `KlaritApi` 暴露：`openManageWindow`、`closeManageWindow`、`getAppVersion`、`showItemInFolder(path)`、`removeProject(projectId)`、`openProjectFromManage(projectId)`、`importProjectFromManage`

## 4. 渲染层：管理项目窗口

- [x] 4.1 渲染入口按视图标记分流：`manage` → `ManageProjectsScreen`，否则现有 App 壳
- [x] 4.2 新增 `ManageProjectsScreen.tsx` 布局：左侧项目清单区 + 右侧品牌/版本/打开本地项目区（遵循 `docs/brand/klarit-brand-system.html`）
- [x] 4.3 左侧条目：显示 `displayName` 与路径（单仓取成员 `rootPath`），整条可点击触发 `openProjectFromManage` 并关窗
- [x] 4.4 条目三点按钮 + 子菜单：「在资源管理器中显示文件夹」(`showItemInFolder`)、「从项目列表中移除」(`removeProject` 后刷新清单)；点三点/菜单项不冒泡触发打开
- [x] 4.5 空清单态：无项目时不渲染条目，右侧入口仍可用
- [x] 4.6 右侧：`KlaritLogo` + 版本号（`getAppVersion`），下方「打开本地项目」按钮调 `importProjectFromManage`
- [x] 4.7 为 `ManageProjectsScreen` 写组件测试：列出项目、点击条目调打开、三点两项行为、三点不触发打开、空态

## 5. 渲染层：切换器接线

- [x] 5.1 `ProjectSwitcher.tsx`：文案 `管理仓库…`→`管理项目…`，去掉 `disabled` 占位
- [x] 5.2 `Sidebar.tsx` 给 `ProjectSwitcher` 传入 `onManage`，调用 `openManageWindow`
- [x] 5.3 更新/新增 `ProjectSwitcher.test.tsx`：菜单项文案为「管理项目…」且可点击、点击触发 `onManage`

## 6. 收尾验证

- [x] 6.1 `npm run typecheck` 与 `npm run test:run` 全绿
- [x] 6.2 `npm start`（dogfood，不监听源码）手动走查：切换器→管理项目→列项、三点两项、点项目按三种落点打开并关窗、右侧打开本地项目
