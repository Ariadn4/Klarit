## Context

切换器子菜单里的「管理仓库…」目前只是 `ProjectSwitcher.tsx` 中一个 `disabled` 的占位项（`onManage` 这个 hook 从未被 `Sidebar` 传入），点不动。代码里**不存在**任何管理窗口、品牌/版本面板、「在资源管理器中显示」「移除项目」「打开本地项目」的实现——OpenSpec 现有 spec 明确把它留给「后续 change」。本 change 就是那个后续 change。

现有可复用的基础设施（探查自代码）：

- **项目注册表**在主进程：`RegistryData { projects: Project[] }`（`src/shared/types.ts`），`Project.displayName` 是显示名，`Project.members[].rootPath` 是路径；持久化到 `userData/registry.json`。渲染层只读访问走 IPC `project:list`。
- **窗口路由**已实现「聚焦已开窗口 / 否则新窗口」：`WindowManager.openProject`（`src/main/windows.ts:118-149`，已遍历 ctxs 聚焦同项目窗口）。空状态窗口用 `UNBOUND=''` 占位，`bindWindow` 把空窗口就地绑定。主进程 `project:open`（`index.ts:158-163`）当前用 **sender 窗口**判断空/已绑定。
- **每个窗口加载同一个渲染层**（`createBrowserWindow`，`index.ts:62-95`），靠 `project:current` 返回 null 与否区分空状态/已绑定。
- 成员级解绑 `unlinkMember`、目录选择 `pickDirectory`、导入 `importProject` 均已就绪。
- `shell` 已引入但只用于 `openExternal`；`shell.showItemInFolder` 未用。应用版本在 `package.json`（`0.1.0`），**未**暴露给渲染层。品牌 logo 用 `KlaritLogo.tsx`。

## Goals / Non-Goals

**Goals:**
- 把占位入口文案改为「管理项目…」并使其可点击，打开一个独立的管理项目窗口。
- 管理窗口：左侧列出全部已导入项目（名 + 路径）+ 每项三点菜单（在资源管理器中显示文件夹 / 从项目列表中移除）；右侧品牌 + 版本号 + 「打开本地项目」。
- 点击项目条目走与主窗口切换器一致的打开路由（已开则聚焦 / 空窗口就地 / 否则新窗口），随后关闭管理窗口。

**Non-Goals:**
- 不实现截图里的「新建仓库」「同步远程仓库/登录」「语言选择」等条目——本期右侧只做「打开本地项目」。
- 不改动注册表数据模型与导入/补绑逻辑本身。
- 不做磁盘上的项目删除——「从项目列表中移除」只动注册表登记。

## Decisions

### 决策 1：管理窗口用独立 BrowserWindow + 路由标记，而非主窗口内模态
「然后关闭管理窗口」的语义要求它是独立窗口。复用现有 `createBrowserWindow`，但加载 URL/文件时附带一个视图标记（如 `?view=manage` 或 hash `#manage`）。渲染层入口读取该标记：是 `manage` 就渲染 `ManageProjectsScreen`，否则走现有 App 壳。
- **单例**：管理窗口任意时刻只一个，重复打开聚焦已有实例。用一个独立引用（不进 `WindowManager.ctxs`，因为它不绑定项目、不参与会话恢复/文件监听/快照）。
- **替代方案**：主窗口内全屏模态——被否，因为「关闭管理窗口」且右侧要显示窗口级品牌区，独立窗口更贴合，也避免污染某个项目窗口的状态。

### 决策 2：管理窗口的「打开项目」不复用 sender 绑定路径，新增 `WindowManager.openOrFocus`
现有 `project:open` 用 **sender 窗口**判断空/绑定；但管理窗口的 sender 是管理窗口本身（不在 ctxs、非项目壳），若复用会把管理窗口错绑成项目窗口。因此新增 `WindowManager.openOrFocus(projectId)`：
1. 有窗口已绑定该项目 → `focus()` 返回；
2. 否则存在 `UNBOUND` 的空状态项目窗口 → `bindWindow` 就地打开；
3. 否则 `openProject` 新窗口。

这正对应「已打开就弹出 / 当前窗口空就就地 / 否则新窗口」，且把「空窗口」从「当前 sender」推广为「任一空项目窗口」。主窗口的 `project:open` 也可改为调用同一方法以行为统一（当前 sender 空也属于情形 2）。

### 决策 3：新增项目级移除 `removeProject`，区别于成员级 `unlinkMember`
现有 `unlinkMember` 是成员仓粒度；管理窗口的「从项目列表中移除」是整个项目条目。新增 `registry-core.removeProject(registry, projectId)` 删除该 project group 并 `saveRegistry`，经新 IPC `project:remove` 暴露。若有窗口正绑定被移除项目，本期只更新管理列表，不强行处理该窗口（见风险）。

### 决策 4：新增三个轻量 IPC
- `app:getVersion` → `app.getVersion()`，preload 暴露，供右侧版本号；
- `shell:showItemInFolder`（参数路径）→ `shell.showItemInFolder(path)`；
- 管理窗口的「打开本地项目」：复用 `importProject` 流程，但落点用 `openOrFocus` 并随后关闭管理窗口（新增 `manage:importProject` 或让管理窗口先 `importProject` 再 `manage:close`）。
- 触发打开管理窗口本身：新增 `manage:open`（`ProjectSwitcher` 的「管理项目…」调用）；关闭：`manage:close`（打开项目/导入完成后）。

### 决策 5：渲染层组件
新增 `ManageProjectsScreen.tsx`（左清单 + 右品牌区）与项目条目三点菜单（复用现有 popover/menu 样式与品牌规范 `docs/brand/klarit-brand-system.html`）。`ProjectSwitcher.tsx`：文案 `管理仓库…`→`管理项目…`，去掉 `disabled` 占位，接线到 `manage:open`（经 `Sidebar` 传入 `onManage`）。

## Risks / Trade-offs

- [被移除的项目仍有打开窗口] → 本期不联动关闭/置空该窗口；该窗口下次会话快照时若项目已不在注册表会被 `restoreOrStart` 的 `findProjectById` 过滤掉。可在后续 change 处理实时联动。
- [管理窗口与项目窗口共用同一 HTML 入口] → 用视图标记区分，需保证管理窗口不触发项目壳的 IPC（`project:current` 等）以免误判。入口层早分流即可。
- [版本号来源] → 用 `app.getVersion()`（读 `package.json`），与打包版本一致，避免在渲染层硬编码。
- [openOrFocus 改动影响主窗口打开行为] → 行为对当前 sender 为空的场景与原逻辑等价；新增的「任一空窗口」分支是超集，需测试覆盖「已绑定窗口点别的项目仍开新窗口」不被破坏。

## Migration Plan

纯增量、无数据迁移：新增 IPC/方法/组件，改一处文案与 `disabled`。回滚即移除新增项并恢复 `ProjectSwitcher` 占位。注册表 schema 不变。
