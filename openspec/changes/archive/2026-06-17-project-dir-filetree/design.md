## Context

现状（探查自代码）：

- **导入**：`project-service.ts.importProject` 对「自身非 git、含 ≥2 子仓」的目录返回 `{ kind: 'nested-candidates', containerPath, candidates }`；App 用 `pendingNested` 状态渲染一条确认横条，用户点「组成多仓项目」后调 `confirmNestedProject`（IPC `project:confirmNested`）→ `createProject` 用 `newGroupId()` 建多仓项目。`ImportOutcome` 是 `{kind:'project'|...} | {kind:'nested-candidates'|...}` 的可辨联合。
- **数据模型**：`Project` 有 `id/displayName/derivedName/members[]/createdAt/updatedAt`，**没有**项目目录字段。成员 `RepoMember.rootPath` 是各子仓主工作树路径。
- **侧边栏文件树**：`Sidebar.tsx` 文件树视图：单仓 → `<FileTree rootPath={single.rootPath}/>`；多仓 → 每个成员一个 `<RepoGroup>`（仓名+分支+其文件树），缺失成员显示 `MissingNotice`（重新定位/移除，走 `relocateMember`/`unlinkMember`）。`FileTree` 已能以任意 `rootPath` 为根、懒加载列子项。
- **监听**：`WindowManager.startWatch` 为每个 `member.rootPath` 各起一个 chokidar 监听；变更 → 渲染层 `refreshKey++` 重新拉取。
- **git 视图**：`GitView` 按 `members` 选成员仓与分支，独立于文件树视图。
- **管理面板**：`ManageProjectsScreen` 的「打开本地项目」调 `importProjectFromManage`；遇 `nested-candidates` 显示「请从主窗口侧边栏导入」提示。

## Goals / Non-Goals

**Goals:**
- 导入含子仓目录直接组建多仓项目，去掉确认横条。
- 文件树视图统一为「以项目目录为根的资源管理器」，单仓/多仓一致；子仓表现为普通文件夹。
- 管理面板「打开本地项目」支持多仓直接组建并打开。

**Non-Goals:**
- 不改 git 视图（仍按成员仓选分支）。
- 不改成员身份/`.klarit/project-id`/git 检测与补绑逻辑。
- 不做项目目录的「重新定位」复杂流程（多仓重定位留待后续）；本期缺失只保证不崩溃 + 可移除（单仓可复用既有 `relocateMember`）。

## Decisions

### 决策 1：项目目录**派生**自成员仓路径，不持久化绝对路径
绝对路径在云同步/换机器/换盘符后必然失效，所以**不**给 `Project` 加持久 `rootPath` 字段。改为新增共享纯函数 `projectRootPath(project): string`（放 `src/shared/project.ts`，main 与 renderer 共用）：单仓 → `members[0].rootPath`；多仓 → 各成员 `rootPath` 的公共父目录（成员是容器直接子目录，父目录即容器；只有一个在场成员时退化为其 `dirname`）。
- 成员路径本就靠 `.klarit/project-id` 在重新导入时刷新（既有机制），项目目录是它的函数 → 同步/换机器后自动归位，无需迁移、无需用户设路径。
- 文件树视图一律 `<FileTree rootPath={projectRootPath(current)}/>`；主进程监听同一派生路径。
- **替代**：存绝对 `rootPath` + 载入回填——否，绝对路径非持久身份，存了反而要处理失效；派生零迁移且天然同步正确。
- 退化：gitless 纯目录项目（无任何 git 成员，成员 `idKind:'path'`）无持久身份，其路径即身份，换机器需重新导入——既有限制，不在本提案改变。

### 决策 2：`importProject` 直接组建多仓、凭**成员身份**去重，简化 `ImportOutcome`
把「非 git + ≥2 子仓」分支从「返回候选」改为「内联组建」：用 `memberFromDir` 探测各子仓（其中已含 `resolveIdentity` 按 `.klarit/project-id` 解析/采纳既有 uuid），返回 `{ project, reused }`。
- **去重按成员身份，不按容器绝对路径**（后者换机器即失效）：探测出成员后，用 `findProjectByMemberId` 查这些成员是否已属某既有项目；命中则复用其 `id`、刷新成员路径（`reused=true`），未命中才 `createProject` + `newGroupId()` 新建。这同时就是「换机器/同步后凭 project-id 复原分组」。
- `ImportOutcome` 简化为 `{ project: Project; reused: boolean }`（去掉可辨联合与 `nested-candidates`）。`confirmNestedProject`（core + IPC `project:confirmNested` + preload）随之移除；App 的 `pendingNested` 状态与确认横条 JSX 移除。`createProject` core 保留（建组复用）。
- **替代**：保留 `confirmNestedProject` 仅供管理面板——否，两处导入行为应一致，统一走 `importProject` 更简单。

### 决策 3：文件树视图去掉 `RepoGroup`，缺失改项目级
`Sidebar.tsx` 文件树视图改为：`project.rootPath` 存在 → `<FileTree rootPath={project.rootPath}/>`；缺失 → 一条项目级「项目目录找不到」提示（复用 `MissingNotice` 样式），提供「从项目列表中移除」（走 `removeProject`）；单仓额外给「重新定位」（走既有 `relocateMember` 作用于唯一成员）。多仓文件树不再渲染 `RepoGroup`。
- `RepoGroup` 组件不再被文件树视图使用（可保留文件或删除；`MissingNotice` 保留复用）。
- 缺失判定：主进程对 `project.rootPath` 做 `existsSync`，经 `project:current`/`list` 带出（或渲染层按现有 reconcile 字段判断）。本期最简：渲染层 `listDir(rootPath)` 失败即视为缺失并显示提示。

### 决策 4：监听派生出的项目目录
`WindowManager.startWatch` 改为监听 `projectRootPath(project)`（容器），替代逐成员监听。容器递归监听（忽略 `node_modules/.git/...`，depth 99）已覆盖子仓内容变更；变更照旧触发 `refreshKey++`。git 视图自己的 worktree 预览监听不变。

### 决策 5：管理面板去掉多仓提示分支
`ManageProjectsScreen.onOpenLocal`：`importProjectFromManage` 现在恒返回 `{project}`，主进程已打开+关窗；移除 `nestedNote` 状态与「请从主窗口导入」分支。

## Risks / Trade-offs

- [去掉 `nested-candidates` 触及类型与多处调用] → 集中改 `ImportOutcome` 定义，编译器（typecheck）逐处报错引导；现有 importProject 测试需同步更新断言（多仓用例由「返回候选」改为「直接建项目」）。
- [重复导入同一组成员致项目 id churn] → 凭**成员身份**（`findProjectByMemberId`）去重复用既有项目 id，保住窗口/会话绑定，且换机器/同步后同样复原。
- [监听整个容器目录的开销] → 与原先逐成员监听总量相当（仍忽略重目录、同样 depth），且单一根更简单。
- [移除 per-member 解绑/重定位 UI 可能影响个别用户习惯] → 与新「项目即目录」模型一致：增减成员=增减子目录；项目级移除仍可在管理面板完成。多仓项目目录重定位作为已知后续项。
- [多仓成员散落不同父目录时公共父目录不唯一] → 模型约定成员是容器直接子目录（导入即如此）；异常情形 `projectRootPath` 退化为某在场成员的 `dirname`，必要时重新导入即修正。
- [gitless 纯目录项目换机器失效] → 既有限制（无持久身份），本提案不改变；用户重新导入即可。

## Migration Plan

**无数据迁移**——项目目录是派生量，不落盘，注册表 schema 不变。纯增量代码改动。回滚：恢复 `confirmNestedProject` 流程与 `Sidebar` 的 `RepoGroup` 分支、移除 `projectRootPath` 使用即可。旧注册表（无任何新字段）直接兼容。
