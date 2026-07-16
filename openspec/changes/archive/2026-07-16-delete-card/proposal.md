## Why

需求卡的删除在底层已通铺（`cardStore.remove` 删卡文件 + 清悬挂边、IPC `cards:remove`、主进程 handler、preload `removeCard` 都在），但**没有任何入口能触发它**：渲染层无一处调用、`CardOp` 无 `delete` 类别、UI 无删除按钮。用户建错卡、需求作废、试跑卡想清掉时只能干瞪眼。补上「删除卡」这最后一段，让用户（手动）与 agent（编排提案）都能删卡。

## What Changes

- **详情面板直接删卡**：详情面板 header 顶部收敛出一排纯图标操作按钮——`▶/⏸`（运行主控，随状态在 play/pause 间切换）· `🗑`（删除）· `✕`（关闭）。原本埋在正文里的「运行 / 暂停 / 恢复」上提到 header；命令节点执行中的「转后台 / 中止并完成」推进控件**留在正文不动**。
- **删卡走二次确认**：点 `🗑` 经既有 `ConfirmDialog` + `confirmedDestructive` 二次确认后才调 `removeCard`，随后关面板 + 刷看板。
- **删除即中止运行**：删除按钮**始终可用**（不因运行/暂停禁用，否则暂停卡会陷入「无路终止→删不掉」死角）。删一张仍有未完成运行（`activeRunId` 且未到 `done`/`aborted`）的卡时，主进程**先把该运行级联中止到 `aborted` 终局**（杀前台 + 后台、清后台记录）再删卡，不留孤儿；确认提示追加「删除会一并中止其运行」。为此引擎新增 `abort(runId)` 原语。
- **分支/worktree 回收（知情同意）**：删卡确认框展示每条成员分支的合并状态（已合并/未合并），并给一个勾选「同时回收 worktree 并删除分支」（默认不勾、只删卡不碰 git）。勾选后一并删 worktree（force）+ 删分支，且视为允许强删未合并分支（显式警示未合并提交将丢失）。新增 `cardBranchCleanupInfo` 查询 + `removeCard` 带 `RemoveCardOptions`。
- **新增 `delete` CardOp**：`CardOp` 从五类扩为六类，新增 `{ kind: 'delete'; target }`，让全局/单需求 agent 能把「删掉这张卡」的意图表达为提案 op，经既有审阅 → `applyOps` → `cardStore.remove` 落地。`delete` 计入破坏性 op（应用前二次确认），且**只作用于待办列的卡**（对已跑卡改建议新建，与 split/merge/adjust/relate 同规）。
- **删除 op 的审阅预览**：审阅界面把 `delete` op 呈现为「删 X」效果预览，与 create/merge/split 等并列。

## Capabilities

### New Capabilities

（无新增能力——删除卡是在既有能力上补齐入口与 op 类别。）

### Modified Capabilities

- `requirement-card-detail`：详情面板运行控制从正文上提到 header 并图标化（play/pause 状态切换）；header 新增删除按钮，删卡经二次确认后调 `removeCard`、关面板刷看板；删除始终可用，删有未完成运行的卡时级联中止该运行。
- `engine-execution`：新增 `abort(runId)` 原语——把未完成运行杀到 `aborted` 终局（供删卡级联中止），对已终局/未知运行幂等。
- `git-write-operations`：无新原语（复用既有 `removeWorktree`/`deleteBranch`/`forceDeleteBranch`）；新增 `card-cleanup` 模块编排删卡时的分支/worktree 回收。
- `requirement-orchestration`：`CardOp` schema 扩为六类，新增 `delete`（按 id 删一张既有卡）；`delete` 纳入「破坏性结构操作只作用于待办列的卡」约束（对已跑卡不产 `delete`）。
- `card-ops-review-apply`：审阅呈现新增 `delete` op 的效果预览（「删 X」）；破坏性二次确认明确覆盖 `delete`（既有条文已列「删卡」，此处落到具体 op）。

## Impact

- **shared**：`src/shared/types.ts`（`CardOp` 加 `delete`、`DESTRUCTIVE_OP_KINDS` 加 `'delete'`）、`src/shared/card-ops.ts`（`coerceOp` 收敛 `delete`、`validateOps` 校验 target 存在且在待办列）。
- **main**：`src/main/apply-ops.ts`（派发 `delete` → `cardStore.remove`，越界/运行中判非法不应用）。既有 `cardStore.remove`、IPC `cards:remove`、handler、preload `removeCard` 复用不改。
- **renderer**：`src/renderer/src/stores/cards.ts`（新增 `removeCard` action：调 `window.klarit.removeCard` → `load` + `closeDetail`）、`src/renderer/src/components/RequirementCardDetail.tsx`（header 图标化 + 正文去运行主控 + 删除禁用/确认）。
- **i18n**：`src/renderer/src/i18n/locales/en.ts`、`zh.ts`（删除、确认删除该卡、先中止运行再删等文案）。
- **测试**：`card-ops` / `apply-ops` / `cards` store / `RequirementCardDetail` 组件测试（测试先行）。
- 无新依赖、无数据迁移；`cardStore.remove` 语义不变，删除仅作纯管理态操作、不触碰 git/分支/worktree。
