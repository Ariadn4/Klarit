## Context

这是 Klarit 的第一个落地 change：仓库目前只有文档（`docs/`、`CLAUDE.md`、`openspec/`），尚无 `src/`、`package.json` 与 Electron 脚手架。因此本 change 既要实现「侧边栏 + 项目导入/切换 + 多窗口」这一用户可见功能，也要顺带建立可运行的 electron-vite 三端骨架（main / preload / renderer）。

核心约束来自 `docs/project-goals.md`：

- **项目身份与路径解耦**：卡片/状态按入 git 的项目 ID（`.klarit/project-id`）关联，不靠路径——移动目录 / 换机器 / 多 worktree 都不断链（见「产物存储」一节）。本 change 第一次落地这套身份机制。
- **两类存储**：项目身份 `.klarit/project-id` 入 git（随目录走）；Klarit 自己的管理状态（这里是「已导入项目注册表 + 窗口会话」）存 `app.getPath('userData')`，不入 git。
- **UI 遵循品牌规范**：`docs/brand/klarit-brand-system.html` + `src/renderer/src/index.css` 的 `@theme` 令牌；图标用 lucide 的 `panel-left-close` / `panel-left-open`。

主进程负责一切特权操作（文件系统、git 探测、目录监听、窗口管理、持久化），渲染进程只通过 preload 暴露的受限 IPC 拿数据，符合 goals 文档「UI ↔ IPC ↔ 引擎 ↔ 文件」的链路。

## Goals / Non-Goals

**Goals:**
- 可运行的 electron-vite 骨架，含一个带可折叠侧边栏与顶栏开关的主窗口。
- 侧边栏文件树展示当前项目目录，随磁盘变更更新。
- 项目导入：名称派生、git 检测、`.klarit/project-id` 绑定、无 git / 无远程 / 多 worktree 的正确处理、git 出现后自动补绑。
- 已导入项目注册表（userData）+ 底部切换器 UI（列表 / 勾选 / 管理仓库 / 导入新项目）。
- 多窗口：打开新项目开新窗口；关闭时记录窗口会话，下次启动恢复。

**Non-Goals:**
- 任务卡、Agent 编排、文档维护、规则包、工作流——后续 change 在此骨架上叠加。
- 「管理仓库…」界面的完整功能（重命名、移除、重定位）——本 change 仅落地入口与基本列表，深度管理留后续。
- 远程同步 / 云同步——仅按字段可合并地存本地，为将来留路。
- 文件树内的文件打开/编辑/预览——本 change 只做展示与展开。

## Decisions

### D1：项目身份 = `.klarit/project-id`（随机 UUID），路径只是查找线索
导入有 git 的项目时，若 `.klarit/project-id` 不存在则生成一个随机 UUID 写入并提交建议给用户（文件随 git 走）。注册表条目以此 ID 为主键，另记「最近已知路径」「git 主分支」「远程」等可变字段。
- **为什么**：goals 文档明确要求按 ID 而非路径关联，才能扛住移动目录 / 换机器 / 多 worktree。UUID 比「remote URL + 路径哈希」更稳——无远程、未推、fork、多 worktree 都不影响其唯一性。
- **替代**：用远程 URL 作 ID——被无远程/未推/多远程场景直接否决；用首个 commit SHA——空仓库与多仓库 cherry-pick 边界情况复杂。

### D2：无 git 的项目用「路径标识」临时登记，查到 git 立即升级补绑
导入时无 git 的目录仍登记进注册表，主键退化为规范化绝对路径，并打 `gitless` 标记。每次打开/聚焦该项目以及目录监听到 `.git` 出现时，重新探测；一旦有 git，就写 `.klarit/project-id` 并把注册条目的主键从路径迁移为 UUID，记录主分支/远程。
- **为什么**：满足「只要一查到 git 就立刻绑定」「导入时无 git 也要能用」两条要求；路径标识是 gitless 期唯一稳定可用的锚点。
- **风险见 R2**。

### D3：git 探测直接调用系统 `git`（经 main 进程子进程），不引入重客户端
用 `git rev-parse --show-toplevel`（定位仓库根/主工作树）、`--git-common-dir`（识别多 worktree 共享同一仓库）、`git branch --show-current`、`git remote get-url origin` 等命令。
- **为什么**：`--git-common-dir` 能让多个 worktree 解析到同一共享仓库目录，天然支撑「多 worktree 同一身份」；直接调 git 行为最贴近真实、无封装偏差。可选 `simple-git` 做封装但非必需。
- **替代**：`isomorphic-git`——纯 JS 但对 worktree/常见配置兼容性不如系统 git。

### D4：每窗口一项目，多窗口；窗口会话与注册表都存 userData JSON
主进程维护 `WindowManager`：打开项目即 `new BrowserWindow` 并绑定 projectId。`registry.json`（已导入项目）与 `session.json`（上次打开的窗口集合：每窗口的 projectId + 侧边栏折叠态 + 几何）存在 `app.getPath('userData')`。启动时读 `session.json` 恢复；空则进入「导入新项目」初始态。
- **为什么**：goals 文档要求新项目开新窗口、不覆盖，并且关闭软件自动暂停、重开恢复；每窗口一项目让后续「单需求 Agent / 看板」自然挂在窗口范围内。侧边栏折叠态按 goals「跨会话保持」需求随窗口持久化。
- **替代**：单窗口多标签——与「默认新窗口打开」明确冲突。

### D5：文件树由 main 读取 + `chokidar` 监听，渲染进程只收快照与增量
main 暴露 `project:listDir` / `project:watch`，用 chokidar 监听项目根（忽略 `node_modules`、`.git` 等重目录），变更经 IPC 推给对应窗口的渲染层增量更新。
- **为什么**：文件系统访问属特权且需防大目录性能问题，集中在 main 便于统一忽略规则与节流；契合 goals 的 chokidar 数据通道设计。

### D6：UI 用 React 19 + Tailwind v4 `@theme` 令牌，侧边栏折叠靠状态而非卸载组件
顶栏按钮切换 zustand 中的 `sidebarCollapsed`；折叠时隐藏栏体但保留文件树监听，避免反复重建。图标用 lucide `PanelLeftClose` / `PanelLeftOpen`。
- **为什么**：符合 CLAUDE.md 技术栈与品牌单一令牌来源；保留监听让展开瞬时呈现最新树。

## Risks / Trade-offs

- **[R1] 写入 `.klarit/project-id` 会修改用户仓库** → 不自动提交，仅创建文件（被 git 视为未跟踪/可入库），由用户决定提交；首次绑定时在 UI 告知「已在项目内创建身份文件，建议提交以便跨机器不断链」。
- **[R2] gitless → git 升级期间路径标识不稳**（gitless 期移动目录会被当成新项目）→ 接受此局限并在 UI 说明；一旦补绑为 UUID 即恢复抗移动能力。鼓励尽早 `git init`。
- **[R3] 同一 UUID 出现在多个 worktree，导入时可能误判为「重复项目」** → 用 `--git-common-dir` 区分：同 commonDir 的不同 worktree 视为「同项目的不同工作树」，登记为同一身份下的多个工作树路径，而非冲突。
- **[R4] 大项目目录监听/列举性能** → 默认忽略 `node_modules`、`.git`、`out`、`coverage` 等；按需懒加载子目录而非一次性递归全树。
- **[R5] 首次落地脚手架范围偏大** → 把骨架搭建拆成独立任务并保持最小（仅本 change 所需的 main/preload/renderer + 构建配置），不提前引入未用依赖（dockview 等可待真正需要面板时再加）。
- **[R6] 测试先行约束（CLAUDE.md 不可妥协）** → 身份/补绑/worktree 判定等纯逻辑放在 main 的可测模块，针对公共 API 写 Vitest；UI 关键交互（折叠、切换器、导入空态）用 @testing-library/react；多窗口/恢复用 Playwright e2e。

## Migration Plan

全新功能，无既有数据迁移。落地顺序：
1. electron-vite 骨架 + 构建/测试配置 + 品牌令牌接入。
2. main 端：项目身份与注册表模块（纯逻辑，先测后写）。
3. main 端：git 探测、文件树 + chokidar、窗口/会话管理与 IPC。
4. preload 暴露受限 API；renderer 实现侧边栏、文件树、切换器、导入空态。
5. e2e 串起多窗口与启动恢复。

回滚：本 change 为新增，回滚即移除相应文件与依赖；用户侧 `.klarit/project-id` 为无害未跟踪文件，删除不影响其代码。

## Open Questions

- 「管理仓库…」界面本 change 落地到什么深度？（倾向：仅入口 + 只读列表，移除/重命名/重定位留后续 change。）
- 项目名与文件夹名后续若被用户改名，是否允许覆盖派生名？（倾向：注册表存可编辑 displayName，派生名仅作默认。）
- 多 worktree 在切换器里如何呈现——同一项目折叠展示其工作树，还是各列一项？（倾向：同一身份归并，后续看板再细化。）
