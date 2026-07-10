## Context

侧边栏（`src/renderer/src/components/Sidebar.tsx`）目前是直接渲染在 `App.tsx` 里的一个 flex 列，没有内部 header 行；它根据当前项目成员数渲染单个 `FileTree` 或多个 `RepoGroup`，底部是 `ProjectSwitcher`。本次要在它顶部加一行视图切换（文件夹 / git），并新增一个 git 视图。

关键现状约束（来自代码勘察）：

- **没有 zustand store**：项目/分支/选择态全是 `App.tsx` 里的 `useState`，通过 IPC（`getCurrentProject`/`listProjects`）水合。侧边栏折叠态按窗口持久化，走 `sidebar:get`/`sidebar:set` → 主进程 `WindowState.sidebarCollapsed`。
- **git 能力极少**：`src/main/git.ts` 只有 `makeGitRunner` 与 `probeGit`（拿 toplevel/commonDir/branch/remote）。**没有**列分支、列 worktree、查 status、切分支的任何代码或 IPC。
- **成员仓模型已有**：`Project { members: RepoMember[] }`，`RepoMember { id, derivedName, rootPath, worktreePaths[], git: GitInfo|null, gitless, missing? }`，`GitInfo { branch, remote, commonDir }`（`src/shared/types.ts`）。注意现有 `worktreePaths` 是「同一身份被从不同路径导入」累积出来的路径列表，**不是** `git worktree list` 的结果。
- **文件树数据**：渲染层调 `window.klarit.listDir(path)` 懒加载；chokidar 在 `src/main/filetree.ts` 监听，`filetree:change` 推给渲染层，`App.tsx` 收到就 bump `refreshKey` 全量重取。
- **图标库**：`lucide-react`。切换按钮范式见 `Topbar.tsx`（`aria-pressed` + brand 类）。

## Goals / Non-Goals

**Goals:**

- 侧边栏顶部加「文件树 / git」两 icon 切换，默认文件树，按窗口持久化。
- git 视图：顶部「当前成员仓名 + 当前分支」，可点击分别切换成员仓 / 分支；下方展示该成员仓在当前分支下对应的 worktree 文件树，随磁盘变更更新。
- git 视图选中的成员仓与分支按窗口持久化，失效时安全回退。
- 复用既有 `FileTree`、`probeGit`、成员仓模型与 chokidar 监听管线。

**Non-Goals:**

- 不做 git status / diff / 暂存 / 提交 / 推送等任何 VCS 操作面板（仅成员仓、分支、worktree 文件树）。
- 不实现 worktree 的创建/删除管理（本期只「展示」与「在已有 worktree/分支间切换查看」）。
- 不改文件树视图既有行为（单仓直接展示、多仓分组）。
- 不引入 zustand（与现有架构保持一致，用 `App.tsx`/`Sidebar.tsx` 的 `useState`）。

## Decisions

### D1：视图模式状态放在 `App.tsx`，持久化复用 `sidebar:*` 范式

与现有架构一致，不引入 zustand。视图模式（`'files' | 'git'`）以 `useState` 持有；持久化镜像 `sidebarCollapsed` 的做法——在主进程 `WindowState` 上加 `sidebarView`（以及 git 视图的 `gitMemberId`/`gitBranch`），通过新增 IPC（或扩展现有 `sidebar:get`/`sidebar:set` 的 payload）按窗口存取。

- **备选**：引入 zustand 统一管理。**否决**：当前 `src` 无任何 zustand 使用，单为此功能引入会偏离既有范式、增加面。

### D2：新增**只读** git 查询能力 + IPC 通道（无任何写操作）

本能力是只读预览器，**绝不**改 git 状态。在 `src/main/git.ts` 增加只读纯函数（基于现有 `makeGitRunner`）：

- `listBranches(dir)` → `git branch --format=%(refname:short)`，**只列本地分支**（不含远端跟踪、不含 tag），含当前 HEAD 分支标记。
- `listWorktrees(dir)` → 解析 `git worktree list --porcelain`，得到每个 worktree 的 `path` 与所在 `branch`，供「分支 → worktree 目录」映射。

**不提供** `checkout`/`switch` 或任何写操作——切换分支只是换「文件树指向哪个 worktree 目录」，纯前端选择，主进程不执行 git 写命令。

IPC 设计（`src/shared/ipc.ts` 新增通道，preload `KlaritApi` 加方法，`src/main/index.ts` 加 handler）：

- `git:branches`（入参 memberId/rootPath）→ `{ current, branches[] }`（本地分支）
- `git:worktrees` → `{ worktrees: { path, branch }[] }`

worktree 文件树**复用现有 `FileTree` 组件**：把 `rootPath` 指向当前选中分支对应 worktree 的 path（由 `listWorktrees` 的「分支→path」映射解析；该分支无 worktree 时显示空态，不回退到其它分支内容）。

- **备选**：复用 `RepoMember.worktreePaths` 字段。**否决**：该字段语义是「同一身份从不同路径导入」的路径累积，非真实 worktree 列表，会误导。worktree 数据应实时由 `git worktree list` 取。
- **备选**：用 `git checkout` 在单一工作目录里切分支。**否决**：那会修改工作区，与「只读预览器」定位冲突，且和未提交改动纠缠。预览只换显示目录，零副作用。

### D3：git 视图作为 `Sidebar.tsx` 内的条件渲染分支，新增 `GitView` 组件

`Sidebar.tsx` 顶部加视图切换行（沿用 `Topbar` 的 `aria-pressed` 按钮范式与 brand 类）。主区按 `sidebarView` 条件渲染：`'files'` → 现有 `FileTree`/`RepoGroup`；`'git'` → 新增 `GitView`。

`GitView`（新文件 `src/renderer/src/components/GitView.tsx`）：

- 顶部「成员仓名（点击弹成员仓列表）+ 分支名（点击弹分支列表）」——弹层沿用 `ProjectSwitcher` 的菜单范式。
- 成员仓列表来自当前 `Project.members`；分支列表来自 `git:branches`。
- 下方渲染 `FileTree`，`rootPath` = 当前成员仓当前分支对应 worktree 路径（无对应 worktree 时显示空态）。切分支只改这个 `rootPath`，不触发任何 git 写命令。
- 成员仓无 git（`git === null` 或 `gitless`）时，显示「该成员仓无 git」提示，不取分支/worktree。

### D4：worktree 文件树的磁盘监听

git 视图当前 worktree 路径若不在已有 chokidar 监听范围内，按需启动监听（复用 `filetree.ts` 的 `watchProject`/`WindowManager.startWatch` 模式），变更时 bump 对应 `refreshKey`。切换成员仓/分支时换监听根。

- **备选**：不监听，仅切换时取一次。**否决**：spec 要求 worktree 文件树随磁盘变更更新。

### D5：图标选型

文件夹用 `FolderTree`（或 `Files`），git 用 `GitBranch`（或 `GitFork`）——均来自 `lucide-react`，与 `RepoGroup`/`Topbar` 已用图标同源。最终以 `docs/brand/klarit-brand-system.html` 为准。

## Risks / Trade-offs

- **[只读不改 git]** 切分支只换显示目录，不 checkout/switch，因此与未提交改动完全无关、零工作区副作用 → 主进程不暴露任何 git 写命令，从源头杜绝误改。
- **[分支无 worktree]** 用户选的本地分支可能没有对应 worktree（文件未检出到任何目录）→ 显示「该分支无 worktree」空态，不崩溃、不误展示其它分支内容（spec 已要求）。
- **[worktree 语义易混]** 现有 `RepoMember.worktreePaths` 与真实 git worktree 不是一回事 → 设计明确改用 `git worktree list`，并在实现/文档里点明区别，避免后续误用。
- **[持久化选择失效]** 持久化的成员仓/分支可能已不存在 → 加载时校验，失效则回退到首个成员仓 + 其当前分支（spec 已要求）。
- **[gitless 成员仓]** 成员仓无 git 时 git 视图无分支/worktree → 明确提示而非空白/崩溃（spec 已要求）。
- **[新增系统 git 调用]** 依赖系统 `git` 可用（与 `probeGit` 同前提）；调用全为只读查询；无 git 时按 gitless 路径处理，不崩溃。

## Open Questions

- 暂无。分支范围（仅本地分支）、切换语义（只读预览、不 checkout）已确认。
