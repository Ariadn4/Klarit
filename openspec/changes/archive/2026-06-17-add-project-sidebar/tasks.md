## 1. 项目脚手架与构建/测试基线

- [x] 1.1 初始化 `package.json`，按 CLAUDE.md 装 Electron + electron-vite、React 19、Tailwind v4、zustand、lucide、chokidar 等本 change 实际需要的依赖（用 `npm view` 取 latest，不提前引入未用的 dockview 等）
- [x] 1.2 建立 electron-vite 三端目录结构（`src/main`、`src/preload`、`src/renderer`）与 `electron.vite.config.ts`
- [x] 1.3 配置 `tsconfig.node.json` / `tsconfig.web.json`、`vitest.config.ts`（happy-dom + @testing-library/react）、`playwright.config.ts`、commitlint（husky 待本仓库纳入 git 后由 `prepare` 自动装钩子）
- [x] 1.4 接入品牌设计令牌：`src/renderer/src/index.css` 的 `@theme`（依 `docs/brand/klarit-brand-system.html`）、引入 `KlaritLogo` 占位
- [x] 1.5 应用可启动（e2e 已用构建产物启动并渲染空主窗口），`npm run typecheck` 与 `npm run test:run` 通过

## 2. 主进程：项目身份与注册表（纯逻辑，先测后写）

- [x] 2.1 写测试：`.klarit/project-id` 的生成/读取、UUID 唯一性、缺失时生成
- [x] 2.2 实现身份模块（读取/写入 `.klarit/project-id`）
- [x] 2.3 写测试：注册表按 ID 为主键的增/查/去重；同身份重复导入复用条目并更新最近路径
- [x] 2.4 写测试：gitless 项目以规范化路径为临时主键登记并打 `gitless` 标记
- [x] 2.5 实现已导入项目注册表（`registry.json` @ userData，按字段可合并的结构）
- [x] 2.6 实现项目名派生（取主分支所在目录的文件夹名）+ 可编辑 displayName 字段

## 3. 主进程：git 探测、worktree 与补绑

- [x] 3.1 写测试：有 git+远程 / 有 git 无远程 / 无 git 三种探测结果的分支与远程记录
- [x] 3.2 实现 git 探测（调用系统 git：`rev-parse --show-toplevel` / `--git-common-dir` / `branch --show-current` / `remote get-url`）
- [x] 3.3 写测试：同一 `--git-common-dir` 的多个 worktree 归并为同一身份而非冲突
- [x] 3.4 实现 worktree 归并判定
- [x] 3.5 写测试：gitless 条目在检测到 git 出现后补绑（写 `.klarit/project-id`、记录分支/远程、主键由路径升级为 UUID）
- [x] 3.6 实现「查到 git 即立即绑定/补绑」逻辑，并在打开/聚焦及监听到 `.git` 出现时触发

## 4. 主进程：文件树、目录监听与窗口/会话

- [x] 4.1 实现 `project:listDir`（懒加载子目录，忽略 `node_modules`/`.git`/`out`/`coverage` 等）
- [x] 4.2 实现 `chokidar` 监听项目根并把增量变更推给对应窗口
- [x] 4.3 实现 `WindowManager`：每窗口绑定一个 projectId，打开非当前项目时开新窗口、选当前项目则聚焦不重开
- [x] 4.4 实现会话持久化：关闭时写 `session.json`（各窗口 projectId + 侧边栏折叠态 + 几何），启动时恢复；空则进入「导入新项目」初始态
- [x] 4.5 实现导入流程入口（目录选择 → 派生名 → git 探测 → 绑定 → 登记）的 main 端编排

## 5. 预加载层

- [x] 5.1 通过 `contextBridge` 暴露受限 API：导入项目、列出注册表、打开项目（开窗）、列目录、订阅文件树变更、读写侧边栏折叠态
- [x] 5.2 定义渲染层与 main 共享的 IPC 类型

## 6. 渲染层 UI（先测后写关键交互）

- [x] 6.1 写测试：顶栏 `panel-left-close` / `panel-left-open` 切换侧边栏折叠并按窗口持久化
- [x] 6.2 实现主窗口布局（顶栏 + 可折叠侧边栏 + 主内容区）与折叠开关（lucide 图标 + zustand 状态）
- [x] 6.3 写测试：文件树展示顶层项、展开文件夹列子项、收到磁盘变更后更新
- [x] 6.4 实现侧边栏文件树组件
- [x] 6.5 写测试：切换器在有项目时显示当前项目名、弹出子菜单列全部项目+勾选当前+「管理仓库…」；无项目时显示「导入新项目」
- [x] 6.6 实现底部项目切换器（含子菜单、当前项勾选、「管理仓库…」入口、空态「导入新项目」按钮）
- [x] 6.7 「管理仓库…」按用户要求本期不做——菜单中保留为禁用的预留入口（spec 已如实标注为占位）

## 7. 端到端与收尾

- [x] 7.1 Playwright e2e：导入一个有 git 的项目 → 文件树出现 → 名称为文件夹名
- [x] 7.2 Playwright e2e：从切换器打开第二个项目 → 新窗口、原窗口不变
- [x] 7.3 Playwright e2e：关闭后重开恢复上次项目；首次无项目时进入「导入新项目」态
- [x] 7.4 e2e：导入无 git 目录正常登记；补绑由单测 `rebindIfGitAppeared` 覆盖（UI 触发路径留后续）
- [x] 7.5 全量 `npm run typecheck` / `npm run test:run` / `npm run test:e2e` 通过，自检后请用户验收
