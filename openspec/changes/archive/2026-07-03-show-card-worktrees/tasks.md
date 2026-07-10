# Tasks

测试先行（先红后绿）：每组先写针对公共 API 的失败测试，再实现到绿。

## 1. 建分支统一递增避撞（engine-execution）

- [x] 1.1 先红：`resolveFreeBranch(slug, members)` 契约测试（`branch-naming.test.ts`，7 例覆盖两维/多仓/跨档）
- [x] 1.2 实现 `resolveFreeBranch`：纯模块 `branch-naming.ts`（probe 注入，全仓统一 `nextSuffixed`；顺带抽出 `sanitize`/`memberWorktreePath`）
- [x] 1.3 接入 `start`：opt-in `avoidBranchConflict` 时一次性解析并烙入 `request.branch`（在 `derive` 之前，用真实 `listBranches`+`existsSync` probe）
- [x] 1.4 恢复稳定：`resume` 沿用已烙入分支名、不再递增（集成测试；解析只在 start）
- [x] 1.5 兼容：未 opt-in 的直接运行沿用幂等认领、不改名（集成测试）；`deriveRunRequest` 对卡运行置 `avoidBranchConflict:true`

## 2. `cardBranches` IPC —— 门控改「分支已建出」（main + preload + types）

> 修订：门控从「worktree 已落地」改为「分支已建出」（用户诉求：建了分支就显示）。`CardWorktree`/`cardWorktrees` 重命名为 `CardBranch`/`cardBranches`，`exists` 字段去除，改由 `listBranches` 过滤。

- [x] 2.1 先红：纯映射 `cardBranchesView(members, nameOf, branchExists)` 契约测试（`card-branches.test.ts`：分支已建各一条 / 未建不出现 / name 回落 / 空成员）
- [x] 2.2 实现 `card-branches.ts` 纯映射（按 `branchExists` 过滤）+ 主进程 `cardsBranches` handler（`getRunState().members` + `listBranches` 逐成员判分支存在），移除旧 `card-worktrees.*`
- [x] 2.3 `ipc.ts`（`cards:branches`）+ `types.ts`（`CardBranch{memberId,name,branch}` + `KlaritApi.cardBranches`）+ `preload` 桥接
- [x] 2.4 `gitViewFocus` handler 接 `memberId`（回落 `repos[0]`），分支取该成员派生上下文（回落预取名）
- [x] 2.5 `focusCardGitView(slug, memberId?)` 签名更新（`types.ts`/`preload`，`memberId` 可选）

## 3. 卡面按成员仓展示已建分支条目（requirement-card-detail）

> 修订：门控改「分支已建出」；条目标签 `成员仓名/分支名`；点击一律聚焦 git 视图（worktree 有则看树、无则空态）。

- [x] 3.1 先红：`RequirementCardView.test.tsx` 改写（分支未建不显 / 无 activeRunId 不探测 / 多仓各条目标签 `name/branch` / 分支删后消失 / 单仓一条目）
- [x] 3.2 实现：以 `cardBranches` 门控渲染内联平铺 chip（标签 `成员仓名/分支名`），点击带 `memberId` 调 `focusCardGitView`
- [x] 3.3 点某成员仓条目 → `focusCardGitView(slug, memberId)`（测试断言点某仓传其 memberId，而非首仓）
- [x] 3.4 UI 用语义令牌（`text-cobalt-500`/`bg-stone-100`/`text-stone-600`），深浅双主题；无硬编码色

## 4. git 视图「暂未创建 worktree」空态文案

- [x] 4.1 `gitView.noWorktree` 文案调为「暂未创建 worktree」（zh）/「Worktree not created yet.」（en）；同步 `GitView.test.tsx` 断言。行为已由 `sidebar-git-view` 既有「无 worktree 空态」覆盖，仅调文案。

## 5. dogfood 工作流重塑（支持验收，数据）

- [x] 5.1 把「多仓·全建 (target=all)」工作流重塑为 4 个引擎节点各挂 manual 核对门：`create-branch(all)` → `open-worktree(all)` → `remove-worktree(all)` → `delete-branch(all)`，每步之后停在核对门（来得及暂停/观察各阶段）
- [x] 5.2 清理验收临时物：`git worktree remove` 掉手动加的 `web--wt--test-create-card` / `api--wt--test-create-card`

## 6. 修复：完成瞬间卡片闪「待办」再落「已完成」（验收中暴露）

> 根因：看板列由两条**独立更新**的口子算——卡状态（走卡库重载）与断点 `currentNodeId`（走引擎事件）。运行完成时 `advanceNode` 把 `currentNodeId` 置 null；若该断点更新先于卡状态变「已完成」到达，`cardColumn` 的 `!currentNodeId → 待办` 让卡闪一帧待办再落已完成。

- [x] 6.1 先红：`board.test.ts` —— leaf 运行已 `done`（`runDone:true`）但卡状态仍进行中/等待决策、`currentNodeId=null` → 仍归已完成列（不闪待办）
- [x] 6.2 实现：`CardColumnInput` 增 `runDone`；`cardColumn` leaf「状态已完成 **或** 运行已 done」即归已完成列；`KanbanBoard` 传 `runDone: bp?.state === 'done'`

## 7. 收尾

- [x] 7.1 i18n：`board.openWorktree`（chip title）en + zh 双语，无硬编码
- [x] 7.2 `npm run typecheck` 两套 config 通过
- [x] 7.3 `npm run test:run` 全绿（70 文件 / 730 用例）
