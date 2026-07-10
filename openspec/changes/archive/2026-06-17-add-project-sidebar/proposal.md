## Why

Klarit 目前还没有可运行的主界面，用户无法把任何项目交给它管理。需求驱动管理的一切（任务卡、文档、Agent 编排）都依附于一个明确绑定的项目，因此第一件事必须是：打开软件能看到项目、能导入项目、能在项目间切换，且这份「软件 ↔ 项目」的绑定在移动目录 / 换机器 / 多 worktree 时绝不断链。这是后续所有功能的地基。

## What Changes

- 新建应用主窗口骨架：左侧**可折叠侧边栏** + 顶栏 `panel-left-close` / `panel-left-open` 开关按钮；折叠状态随会话持久化。
- 侧边栏展示**当前项目的目录文件树**（项目主目录下所有文件/文件夹）。
- 侧边栏底部是**项目切换器**：显示当前项目名；点击弹出子菜单，列出所有已导入项目、勾选当前项、底部带「管理仓库…」入口。
- **从未打开过任何项目**时，底部按钮显示「导入新项目」，点击进入导入流程。
- **导入项目**：以其主分支所在目录的文件夹名作为项目名；若检测到 git，记录主分支与远程；一旦查到 git 立即绑定，导入时无 git / git 未推远程 / 多 worktree 等情况都要正确处理。
- **持久化的项目身份**：为入 git 的项目写入 `.klarit/project-id`，卡片/状态按此 ID（而非路径）关联，保证移动目录、换机器、多 worktree 都不断链；项目最初无 git、之后出现 git 时自动补绑。
- **多窗口**：从切换器子菜单打开另一个项目时，默认开**新窗口**，不覆盖当前项目窗口。
- **启动恢复**：每次开启软件默认打开上次关闭时的项目（恢复上次会话的窗口集合）。

## Capabilities

### New Capabilities
- `app-shell-sidebar`: 应用主窗口骨架——可折叠左侧栏、顶栏开关按钮、当前项目目录文件树、底部项目切换器（含项目列表 / 当前项勾选 / 管理仓库 / 导入新项目入口）及其折叠状态持久化。
- `project-registry`: 项目的导入与持久身份——名称派生、git 检测、`.klarit/project-id` 绑定、远程/主分支记录、无 git / 无远程 / 多 worktree 的处理与 git 出现后的自动补绑，确保移动目录 / 换机器 / 多 worktree 不断链。
- `workspace-windows`: 多窗口工作区——打开新项目用新窗口而非覆盖，关闭软件时记录打开的窗口/项目集合，下次启动恢复上次会话。

### Modified Capabilities
<!-- 无现有 spec，全部为新建。 -->

## Impact

- **首次落地的应用骨架**：建立 Electron 主进程 / 预加载 / 渲染三端的初始结构（窗口管理、IPC、文件系统与 git 探测在 main，UI 在 renderer）。
- **新增依赖**：dockview（面板）、文件树渲染与 `chokidar`（目录监听）、git 探测（`simple-git` 或直接调用 `git`）；lucide 图标（`panel-left-close` / `panel-left-open`）。
- **持久化存储**：窗口/项目注册表与会话状态存 `app.getPath('userData')`（不入 git）；项目身份 `.klarit/project-id` 入 git（随项目目录走）。
- **品牌约束**：所有界面遵循 `docs/brand/klarit-brand-system.html` 与 `src/renderer/src/index.css` 的 `@theme` 设计令牌。
- 暂不涉及任务卡、Agent 编排、文档维护——这些后续 change 在本骨架之上叠加。
