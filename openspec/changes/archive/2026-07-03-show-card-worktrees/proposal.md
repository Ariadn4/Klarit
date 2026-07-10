## Why

`multi-repo-card-branching`（已归档）打通了引擎侧：一卡一运行、在 `card.repos` 涉及仓内扇出，为每个成员仓各建一套分支/worktree/base。但**表层界面没跟上**：

- **卡面只显示一个 worktree**。`RequirementCardView` 读断点的单数 `request.branch`、探测只查 `request.worktreePath`（主仓那一个路径），点击一律 `focusCardGitView` 到 `card.repos[0]`。多仓下 client / server 各建了 worktree，卡上却只看得见一个、也只能跳到首仓。
- **建分支撞名是"静默认领"而非"避开"**。今天 `ensureBranch`/`createBranch` 遇到同名分支返回 `noop`/`reached()`（幂等认领），适合恢复但不适合"这是一张新卡、名字被占了该另起一个"。用户想要的是：撞名时**自动递增尾号**避开。

本 change 把这两段补齐：卡面按成员仓展示**每一个**已落地 worktree、点击跳到**对应**成员仓的 git 视图；建分支遇冲突时**全仓统一递增**尾号避撞。

## What Changes

- **卡面按成员仓展示已建分支（内联平铺）**：卡为**每个已建出分支的成员仓**各展示一个可点条目，以「成员仓名/分支名」标识（如 `web/test-create-card`），内联平铺、不折叠。**门控是「分支已建出」而非「worktree 已建出」**——分支一建出即可见，不等 worktree。成员仓分支被删除后其条目消失。
- **点条目聚焦到对应成员仓（worktree 有则看树、无则空态）**：点击某成员仓条目 → 侧边栏切 git 视图并程序化聚焦到 **(该成员仓, 该分支)**，而非一律首仓；该分支有 worktree 则展示其文件树，**无 worktree 则展示「暂未创建 worktree」空态**（复用 `sidebar-git-view` 既有空态，仅调文案）。`sidebar-git-view` 的「程序化聚焦」与「无 worktree 空态」本就具备，无需改机制——只需卡侧把对的成员 id 发出去 + 文案微调。
- **建分支冲突时全仓统一递增避撞**：运行触发（`start`）时一次性解析出一个在**所有涉及仓**都空闲的分支名——自 slug 起，若该名在**任一**涉及仓已存在同名本地分支、**或**其派生 worktree 路径已被占用，则**所有涉及仓一起**递增尾号（`x`→`x-2`→`x-3`…）另取下一档，直到每个涉及仓的**分支与 worktree 路径两维**都空闲。解析结果一次性烙入 `request.branch`；涉及仓始终共用**同一个**分支名（不做逐仓分别递增）。
- **递增只在 start 发生一次**：`deriveMembers` 等派生保持纯函数，恢复时沿用已烙入的分支名，**绝不**在恢复时重跑撞名检测（否则会从运行自己已建的 worktree 上递增走开、造成孤儿）。既有幂等认领保留为恢复/竞态兜底。

## Capabilities

### Modified Capabilities
- `engine-execution`: 运行触发时把卡 slug 解析为一个在**所有涉及仓**分支与 worktree 路径两维都空闲的分支名（撞名则全仓统一递增尾号），一次性烙入 `request.branch`；递增只在 start 发生一次，恢复沿用不重算。
- `requirement-card-detail`: 卡面由「只展示首仓单一分支名」改为「为每个**已建出分支**的成员仓各展示一个内联平铺可点条目（成员仓名/分支名）」，点击聚焦到**该成员仓**（而非一律首仓）的 (分支, worktree 或空态)；分支被删后条目消失。门控从 worktree 存在改为**分支存在**。
- `requirement-kanban-board`: leaf 卡「已完成」判定取「卡状态已完成 **或** 运行断点已 `done`」的并集，修复运行完成瞬间因 `currentNodeId` 归 null、卡状态未跟上而闪入「待办」列的一帧抖动（验收中暴露）。

## Impact

- **前置依赖**：`multi-repo-card-branching`（已归档）——多仓扇出、每成员派生上下文（`bp.members`）、`sidebar-git-view` 程序化聚焦 (成员仓, 分支) 均已就位，本 change 建在其上。
- **代码**：
  - `src/main/engine/branch-naming.ts`（新纯模块）：`resolveFreeBranch`（probe 注入，检查每涉及仓分支存在 ∪ worktree 路径占用，全仓统一 `nextSuffixed` 递增）+ 抽出的 `sanitize`/`memberWorktreePath`/`nextSuffixed`。
  - `src/main/engine/engine.ts`：`start` opt-in（`avoidBranchConflict`）时用真实 probe 调 `resolveFreeBranch` 一次性烙入 `request.branch`（在 `derive` 之前）；`deriveMembers` 保持纯函数不变，改用 `memberWorktreePath` 消除派生漂移。
  - `src/shared/types.ts` / `src/main/card-run.ts`：`RunRequest` 增 opt-in 开关 `avoidBranchConflict`（`deriveRunRequest` 对卡运行置真，直接运行缺省假、沿用幂等认领）。
  - `src/main/card-worktrees.ts` + `src/main/index.ts`：`cardBranches(slug): [{memberId, name, branch}]`——取 `engine.getRunState().members`，**逐成员用 `listBranches` 过滤出分支已建出的**（worktree 有无不再作门控）；`gitViewFocus` 处理器接收 `memberId`（回落 `repos[0]`），分支取自该成员派生上下文。
  - `src/shared/types.ts` / `src/preload/index.ts`：`CardWorktree`→`CardBranch {memberId,name,branch}`；`focusCardGitView(slug)` → `focusCardGitView(slug, memberId)`；`cardWorktrees`→`cardBranches` IPC。
  - `src/renderer/src/components/RequirementCardView.tsx`：按成员仓渲染内联平铺 chip（`成员仓名/分支名`），门控 = 分支已建出，点击带 `memberId` 聚焦。
  - `src/renderer/src/i18n/locales/{zh,en}.ts`：`gitView.noWorktree` 文案调为「暂未创建 worktree」。
  - `src/renderer/src/lib/board.ts` + `src/renderer/src/components/KanbanBoard.tsx`：`CardColumnInput` 增 `runDone`，`cardColumn` leaf「状态已完成 ∪ 运行已 done」即归已完成列（修完成瞬间闪待办）。
  - **dogfood 数据**：把「多仓·全建 (target=all)」工作流重塑为 `create-branch → open-worktree → remove-worktree → delete-branch`，**每个引擎节点各挂一个 manual 核对门**（每步之后停下，来得及暂停/观察）。此为用户工作流实例（`userData/workflows/*/workflow.yaml`），非代码 spec。
- **兼容**：单仓卡是成员数为 1 的退化情形——只展示一个条目、聚焦其唯一成员。`focusCardGitView` 不带 `memberId` 时回落首仓，旧调用不破。
- **安全红线**：撞名解析不改任何 GC / 删除语义；`resolveFreeBranch`、`cardBranches` 均只读探测（`listBranches` / 路径判断），不写 git。恢复稳定红线：撞名检测 MUST NOT 进 `deriveMembers`。
