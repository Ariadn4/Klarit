## Context

`multi-repo-card-branching`（已归档）已让引擎 `deriveMembers(d)` 为每个成员仓各产出一套 `MemberDerived {memberId, repoPath, branch, worktreePath, baseBranch}`，并持久化于 `bp.members`。其中 **`branch` 对每个成员是同一个字符串**（= 卡 slug `d.branch!`），worktree 路径逐仓从该分支派生（`basename(repo)--wt--sanitize(branch)`），base 逐仓解析各自主线。

表层没跟上：卡面（`RequirementCardView`）只读单数 `request.branch`、探测只查单一 `request.worktreePath`、点击固定跳 `card.repos[0]`；而 `sidebar-git-view` 的「程序化聚焦」需求**已经**接受任意 (成员仓, 分支)、`GitView` 也已按 `gitMemberId`+`gitBranch` 定位预览目录。撞名方面：`ensureBranch`/`createBranch` 遇同名分支返回 `noop`/`reached()`（幂等认领），无"另起新名"路径；仅 `open-worktree` 有一个响应式 `suffix` 决策（`decisions.ts:78`），在决策时改 `bp.request.worktreePath`（非 branch、非逐仓）。

## Goals / Non-Goals

**Goals：**
- 卡面为**每个已落地 worktree 的成员仓**各展示一个可点条目，内联平铺；点击聚焦到**该成员仓**的 worktree。
- 建分支遇冲突（分支存在 ∪ worktree 路径占用）时**全仓统一递增**尾号避撞，一次性在 start 解析并烙入 `request.branch`。
- 恢复稳定：递增只发生一次，`deriveMembers` 保持纯函数。

**Non-Goals：**
- 逐仓分别递增分支名（见 D1 否决）。
- 改动 `sidebar-git-view` / `GitView`（聚焦机制已支持任意成员仓）。
- 改任何 GC / 安全删 / worktree 移除语义。
- 撞名的 agent 介入 / 交互式改名（本轮纯自动递增）。

## Decisions

### D1：统一递增——撞名则全仓一起 bump，卡永远只有一个分支名
`multi-repo-card-branching` 的核心不变量（D3 目标 + `erp_svn` dogfood 印证）是**卡 slug = 分支名，在每个成员仓同名**——"在任何仓看到这个分支名 = 这张卡"的可读性契约。逐仓分别递增（只 bump 撞的那个）会让 client=`x`、server=`x-2`，卡失去单一分支名、可读性契约破裂，且逼 `deriveMembers` 产出逐成员 branch。**故坐实统一递增**：任一涉及仓在分支或 worktree 路径两维撞名，则所有涉及仓一起取下一档，`request.branch` 仍是单个字符串，`deriveMembers` 里 `branch = d.branch!` 一行不改，worktree 路径因从 branch 派生而自动带上 `-2`。代价——连累未真撞的仓改名——是纯表面、且仅当某仓已有同名 slug 遗留/人工分支时才发生，以此换"卡即一个分支名"的核心性质，划算。
*备选*：逐仓递增——否决（破不变量、复杂化派生与卡面）。

### D2：冲突 = 分支存在 ∪ worktree 路径占用（两维都要空闲）
既然全仓共用一个名，该名要在**所有涉及仓、分支与 worktree 路径两个维度**上都空闲才算可用。`resolveFreeBranch(slug, members)` 自 slug 起逐档 `nextSuffixed`，每档检查：对每个成员仓，其本地分支列表（`listBranches`）不含该名 **且** 其派生 worktree 路径（`existsSync`）不存在；任一成员任一维度不满足即整档作废、进下一档。两维一起判，使响应式 `open-worktree` 的 `suffix` 决策退化为罕见竞态兜底而非主路径。
*备选*：只判分支存在——否决（worktree 路径占用会在 `open-worktree` 阶段才炸，晚且需人工介入，违背"自动避开"诉求）。

### D3：递增只在 start 一次性解析，`deriveMembers` 保持纯函数（恢复稳定红线）
`deriveMembers` 在**每次恢复**都会重跑（`engine.ts:767-768, 786-787`），而 `multi-repo-card-branching` 把"same-input→same-derive"列为恢复稳定红线。若撞名检测进 `deriveMembers`：恢复时重探真实仓状态 → 卡自己"现已存在"的分支看起来像撞名 → 从**自己的 worktree** 上递增走开 → 孤儿。**故撞名解析必须是 `start()`（`deriveRunRequest`/`engine.start` 路径）的一次性动作**，把解析出的空闲名一次性烙入 `request.branch`，之后 derive 纯、确定，恢复沿用冻结名。这与既有 `suffix` 决策同构（它在决策时改 `bp.request.worktreePath`、非在 derive 里改，`engine.ts:831`）。既有幂等认领（`ensureBranch`→`reached`）保留为恢复/竞态兜底：start 后若人手插进一个同名分支，认领之而非死结。

**避撞是 opt-in（`RunRequest.avoidBranchConflict`），卡派生的运行默认开启。** 实现时发现引擎既有大量测试与直接触发路径**故意在已存在分支上 start 并期望被认领**（测 delete/merge/push 等 ensure 语义）；若 start 无条件递增会翻转这批语义。故加一个请求级开关——`deriveRunRequest`（卡运行）置 `true`，直接触发缺省 `false` 沿用幂等认领。开关只在 start 读一次（不入 `derive` 产物、不需持久化，因 resume/decide 本就不重解析）。既守住「新卡撞名自动避开」，又不动直接运行的既有行为。

### D4：卡面按「已建分支」门控、逐成员仓条目（成员仓名/分支名），聚焦传具体 memberId
**门控是「分支已建出」而非「worktree 已建出」。** 用户要的是「只要建了分支，卡面就显示对应分支名」——分支一建出即可见，不等 worktree（vibe coder 想在建分支后立刻能看到、点进去，即便 worktree 还没开）。故为每个**本地分支已建出**的成员仓各渲一个条目，以「成员仓名/分支名」标识（如 `web/test-create-card`），内联平铺。

数据经 IPC `cardBranches(slug) → [{memberId, name, branch}]`：取 `getRunState().members`（全体目标成员派生上下文），**逐成员用 `listBranches` 过滤出分支已真正建出的**（`existsSync(worktreePath)` 不再作为门控——worktree 有无交给 git 视图处理）。点击某条目 → `focusCardGitView(slug, memberId)` → 主进程发 `{repoId: memberId, branch: 该成员派生分支}` → 复用既有 `onGitViewFocus`。git 视图据 (成员仓, 分支) 定位：**有 worktree 展示文件树，无 worktree 展示「暂未创建 worktree」空态**（复用 `sidebar-git-view` 既有空态，仅调文案）。故卡面无需知 worktree 有无、点击一律聚焦 git 视图，由 git 视图统一处理两态。`focusCardGitView` 不带 `memberId` 回落 `repos[0]`（旧调用兼容）。成员仓分支被 `delete-branch` 删除后其条目自然消失。

*为什么放弃 worktree 门控（原 D4）*：worktree 门控下，只建分支不开 worktree 的工作流（dogfood 实测正是如此）卡面永远空，用户看不到多仓进展。branch 门控让「建分支」这一步立刻有可见产物，符合诉求，且点击落到 git 视图空态也把「worktree 还没开」这件事显式告诉用户。

## Risks / Trade-offs

- **start 与执行之间的竞态**：start 解析时某档空闲，执行前被人手创建同名分支 → 既有幂等认领吸收（分支）或 `open-worktree` suffix 决策兜底（路径）。接受为竞态上限。
- **未真撞的仓被连累改名**（D1 代价）：纯表面、罕见，换核心不变量，接受。
- **卡面条目数随成员仓增长**：dogfood 2 个（client/server），内联平铺无压力；若未来一卡跨很多成员再议折叠，本轮不做（用户已确认内联平铺）。
- **`cardBranches` 探测成本**：每次探测逐成员 `listBranches`（同步 git 读）；仅在 `activeRunId`/断点变化时触发，非每帧，且活跃运行数少，忽略。
- **完成瞬间列抖动**（验收暴露）：看板列由「卡状态」与「断点 currentNodeId」两条独立口子算，完成瞬间断点先到（currentNodeId=null）会闪一帧「待办」→ 修为「卡状态已完成 ∪ 运行断点 done」并集判已完成列（见 `requirement-kanban-board` delta）。

## Migration Plan

1. 类型先行（先红）：`focusCardGitView(slug, memberId?)`、`cardBranches` IPC 契约、`RunRequest.avoidBranchConflict` 开关。
2. `resolveFreeBranch`（先红）：单仓无撞→原名；单仓撞分支→`-2`；单仓撞 worktree 路径→`-2`；多仓任一撞→全仓同档递增；跨档连撞→继续递增；恢复重跑 `deriveMembers` 不再变名。
3. `cardBranches` 主进程实现（`listBranches` 逐成员过滤已建分支）+ 卡面逐成员 chip 渲染「成员仓名/分支名」（先红：分支未建不显、多仓各显、分支删后消失）。
4. `gitViewFocus` 处理器接 `memberId`（先红：点某成员条目聚焦该成员而非 repos[0]）；git 视图无 worktree 空态文案「暂未创建 worktree」。
5. 回退：`focusCardGitView` 的 `memberId` 可选、缺省回落首仓；单仓退化只一个条目。

## Open Questions

- 无（三处决策——统一递增、两维冲突、内联平铺——已与用户敲定）。
