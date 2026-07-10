## 1. 主进程只读 git 查询能力（先红后绿，无任何写操作）

- [x] 1.1 在 `src/main/git.ts` 为 `listBranches(dir, run)` 写测试：返回 `{ current, branches[] }`，**只含本地分支**（不含远端跟踪/tag），覆盖当前分支标记、非 git 目录的安全返回
- [x] 1.2 实现 `listBranches`（基于 `makeGitRunner`，`git branch --format=%(refname:short)` + `branch --show-current`）使测试转绿
- [x] 1.3 为 `listWorktrees(dir, run)` 写测试：解析 `git worktree list --porcelain` 得到 `{ path, branch }[]`，覆盖单 worktree、多 worktree、detached
- [x] 1.4 实现 `listWorktrees` 使测试转绿

## 2. IPC 通道与预加载（只读查询）

- [x] 2.1 在 `src/shared/ipc.ts` 新增通道常量 `git:branches`、`git:worktrees`（不新增任何 git 写通道）
- [x] 2.2 在 `src/main/index.ts` 注册两个 handler，按 memberId/rootPath 调用第 1 节函数；非 git / gitless 成员仓返回明确空态而非报错
- [x] 2.3 在 `src/shared/types.ts` 的 `KlaritApi` 加 `listBranches`/`listWorktrees` 方法签名，并在 `src/preload/index.ts` 实现转发
- [x] 2.4 为新 IPC 往返写契约测试（参照既有 IPC 测试范式）

## 3. 视图模式状态与按窗口持久化

- [x] 3.1 在主进程 `WindowState` 加 `sidebarView: 'files'|'git'`、`gitMemberId`、`gitBranch` 字段（参照现有 `sidebarCollapsed`）
- [x] 3.2 扩展 `sidebar:get`/`sidebar:set`（或新增等价通道）以读写上述字段，并写测试覆盖读默认值（默认 `'files'`）与回写
- [x] 3.3 在 `App.tsx` 引入 `sidebarView` 等状态，启动时水合、变更时回写持久化

## 4. 侧边栏顶部视图切换 UI（测试先行）

- [x] 4.1 为 `Sidebar` 顶部切换条写测试：默认文件夹 icon 选中（`aria-pressed`）、点击 git icon 切到 git 视图、点击文件夹 icon 切回，状态回调被调用
- [x] 4.2 在 `Sidebar.tsx` 顶部新增视图切换行：`FolderTree` 与 `GitBranch` 两个 `lucide-react` icon 按钮，沿用 `Topbar` 的 `aria-pressed` + brand 类，先看 `docs/brand/klarit-brand-system.html`
- [x] 4.3 `Sidebar` 主区按 `sidebarView` 条件渲染：`'files'` → 现有 `FileTree`/`RepoGroup`；`'git'` → `GitView`

## 5. GitView 组件（测试先行）

- [x] 5.1 为 `GitView` 写测试：顶部展示当前成员仓名 + 当前分支；成员仓无 git 时显示「该成员仓无 git」提示且不取分支/worktree
- [x] 5.2 为成员仓切换写测试：点击成员仓名弹出成员仓列表（当前带勾选），选择后切换并刷新分支与 worktree 文件树
- [x] 5.3 为分支切换写测试（**只读**）：点击分支名弹出本地分支列表（当前带勾选），选择后**仅把文件树 `rootPath` 切到该分支对应 worktree**、不调用任何 git 写命令；所选分支无 worktree 时显示「该分支无 worktree」空态
- [x] 5.4 创建 `src/renderer/src/components/GitView.tsx` 实现上述：顶部成员仓/分支选择器（沿用 `ProjectSwitcher` 菜单范式），下方复用 `FileTree`，`rootPath` 由 `listWorktrees` 的「分支→path」映射解析；无对应 worktree 显示空态（不回退到其它分支内容）
- [x] 5.5 接入持久化：当前成员仓/分支变更回写，加载时校验失效则回退到首个成员仓 + 其当前分支

## 6. worktree 文件树磁盘监听

- [x] 6.1 为「git 视图当前 worktree 路径变更触发刷新」写测试（监听 → `filetree:change` → bump refreshKey）
- [x] 6.2 复用 `filetree.ts`/`WindowManager.startWatch` 范式，按当前 worktree 路径启动/切换 chokidar 监听，切换成员仓或分支时换监听根

## 7. 验收与收尾

- [x] 7.1 `npm run typecheck` 两套 config 通过
- [x] 7.2 `npm run test:run` 全绿
- [x] 7.3 `npm run dev` 手动走查：默认文件树视图 → 切 git 视图 → 切成员仓 → 切分支 → 改磁盘文件看 worktree 树更新 → 重开窗口确认视图与选择项恢复
