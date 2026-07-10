## 1. 项目目录派生（无持久字段、无迁移）

- [x] 1.1 `shared/types.ts`：`ImportOutcome` 简化为 `{ project: Project; reused: boolean }`（去掉可辨联合与 `nested-candidates`）；**不**给 `Project` 加持久字段
- [x] 1.2 新增 `shared/project.ts` 纯函数 `projectRootPath(project): string`——单仓取 `members[0].rootPath`，多仓取各成员 `rootPath` 的公共父目录（仅一个在场成员时退化为其 `dirname`）；含单测（单仓 / 多仓公共父 / 退化）

## 2. 导入：直接组建多仓（去确认、凭成员身份去重）

- [x] 2.1 `project-service.ts`：`importProject` 的「非 git + ≥2 子仓」分支改为**直接组建**——`memberFromDir` 探测各子仓为成员（含按 `.klarit/project-id` 解析身份），用 `findProjectByMemberId` 查既有项目：命中则复用其 id 并刷新成员路径（`reused=true`），否则 `createProject`+`newGroupId()` 新建；返回 `{ project, reused }`
- [x] 2.2 `project-service.ts`：移除 `confirmNestedProject`（函数 + export）；保留 `createProject` 供建组复用
- [x] 2.3 更新 `project-service.test.ts`：多仓用例由「返回 `nested-candidates`」改为「直接建多仓项目」；新增「同组成员换路径再导入凭身份复用同一项目 id」用例

## 3. 主进程 IPC 与文件监听

- [x] 3.1 `shared/ipc.ts`：移除 `confirmNestedProject` 通道
- [x] 3.2 `main/index.ts`：`project:import` 处理器返回简化后的 outcome（直接 `bindOrOpen`）；移除 `project:confirmNested` 处理器；`manage:import` 同步简化
- [x] 3.3 `main/windows.ts`：`startWatch` 改为监听 `projectRootPath(project)`（容器），替代逐成员监听；更新 `windows.test.ts` 相关断言
- [x] 3.4 确认 `current()`/`openOrFocus`/会话快照不受成员→rootPath 改动影响（跑现有 windows 测试）

## 4. 预加载与类型

- [x] 4.1 `preload/index.ts` + `shared/types.ts` `KlaritApi`：移除 `confirmNestedProject`；`importProject`/`importProjectFromManage` 返回类型改为 `Promise<{ project; reused } | null>`

## 5. 渲染层：文件树视图 = 项目目录

- [x] 5.1 `Sidebar.tsx`：文件树视图改为以 `projectRootPath(current)` 为根的 `<FileTree>`；移除多仓 `RepoGroup` 分支与单仓特判
- [x] 5.2 `Sidebar.tsx`：项目目录缺失时显示项目级「项目目录找不到」提示——「从项目列表中移除」（走 `removeProject`），单仓额外「重新定位」（走 `relocateMember` 作用于唯一成员）
- [x] 5.3 `App.tsx`：移除 `pendingNested` 状态、确认横条 JSX、`confirmNested` 回调；`onImport` 简化为导入后 `refresh`
- [x] 5.4 更新相关组件测试（`Sidebar`/`App`/`RepoGroup` 如有）：去掉确认横条与成员分组断言，新增「以项目目录为根列出全部子项」断言

## 6. 管理面板

- [x] 6.1 `ManageProjectsScreen.tsx`：移除 `nestedNote` 状态与「请从主窗口侧边栏导入」分支；`onOpenLocal` 简化（导入恒返回 `{project}`，主进程已打开+关窗）
- [x] 6.2 更新 `ManageProjectsScreen.test.tsx`：删除 nested-candidates 用例，「打开本地项目」断言直接导入

## 7. 收尾验证

- [x] 7.1 `npm run typecheck` 与 `npm run test:run` 全绿
- [x] 7.2 `npm start`（dogfood，不监听源码）手动走查：导入含多子仓目录**直接组建**（无横条）、文件树以项目目录为根列出全部文件夹与文件、git 子仓表现为普通文件夹、管理面板「打开本地项目」可直接组建多仓
