## Context

删除卡的底层已经通铺、且被 split/merge 内部长期依赖：

```
cardStore.remove(projectId, slug)   src/main/card-store.ts:173   删卡文件 + 清悬挂边  ✅
IPC  cards:remove                    src/shared/ipc.ts:198                             ✅
main handler ipcMain.handle          src/main/index.ts:904                             ✅
preload window.klarit.removeCard     src/preload/index.ts:55                           ✅
```

缺口全在「入口」层：渲染层无一处调用 `removeCard`、`stores/cards.ts` 无 `removeCard` action、UI 无删除按钮、`CardOp` 无 `delete` 类别。`card-ops-review-apply` 的破坏性确认条文与 `applyOps` 派发目标（`create/update/remove/...`）其实**已预留了删卡**，只是 op 类别一直没落。

约束：UI 遵 `docs/brand` 与设计令牌（仅语义令牌、深浅双主题）；测试先行；`cardStore.remove` 语义不变，删除是纯管理态操作、不碰 git/分支/worktree。

## Goals / Non-Goals

**Goals:**
- 详情面板给出手动删卡入口，二次确认后删卡、关面板、刷看板。
- 运行控制（run/pause/resume）上提到 header 并图标化，与删除、关闭并排为一排纯图标按钮。
- 新增 `delete` CardOp，让 agent 能把删卡意图表达为提案 op，经既有审阅 → apply 落地。
- 运行中的卡（活跃 `activeRunId`）在两条路径上都挡住删除。

**Non-Goals:**
- 不做 worktree/分支回收——级联只中止运行（杀进程 + 落 `aborted`），worktree/分支交既有清理机制。
- （修订）原「运行中一律拦截删除、不级联」的取舍已在 dogfood 后推翻：拦截会让暂停卡陷入「无路终止→删不掉」死角，故改为「删除即中止运行」（见决策 3）。
- 不改 `cardStore.remove` 的删卡语义（仍只删文件 + 清悬挂边）。
- 不做批量删除、不做回收站/撤销。
- 不动命令节点执行中的推进控件（转后台/中止并完成），它们留在正文。

## Decisions

### 决策 1：手动删卡直接调 `removeCard`，不绕 `applyOps`

详情面板的删除按钮走**直连**路径：`store.removeCard(slug)` → `window.klarit.removeCard` → `cardStore.remove`。不把手动删卡包成一个 `delete` op 再过 `applyOps`。

- **理由**：手动删卡是用户对**明确选中的一张卡**的直接意图，`ConfirmDialog` 已提供二次确认；`applyOps` 的价值在于「校验一批 agent 生成的 op、逐条勾选」，对单卡手删是多余中间层。两条路径职责清晰：**直连**服务用户手动、**op**服务 agent 提案。
- **备选**：手删也合成 `delete` op 走 applyOps——统一但绕、且要凭空造一个单元素 ops 数组过审阅 UI，弃。

### 决策 2：运行主控图标化 + play/pause 同位切换

header 右侧一排纯图标（复用现有 `✕` 的无背景图标按钮样式，hover 变色）：`▶/⏸`（主控）· `🗑`（删除）· `✕`（关闭）。主控一个位置随状态换脸：

```
canRun (无 activeRunId / done / aborted)  →  ▶ play    → runCard
running / waiting-decision                →  ⏸ pause   → pauseRun
paused                                    →  ▶ play    → resumeRun
```

- **理由**：run 与 resume 都是「让它跑起来」，共用 play 图标符合直觉；正文腾出运行按钮后更聚焦任务内容。
- **备选**：header 收全部运行按钮（含推进/detach/abort）——那些是「当前命令」上下文控件，跟输出在一起才讲得通，图标化会语义混乱，故留正文（explore 已定）。

### 决策 3：删除即中止运行（dogfood 后从「拦截」改过来）+ 分支回收知情同意

**手动删卡（详情面板）**：删除按钮**始终可用**。原设计是「有活跃运行则禁用删除」，但 dogfood 发现暂停的卡没有任何走到终局的入口 → 永远删不掉的死角。改为「删除即中止运行」：主进程 `cardsRemove` 在删卡前，若卡有未完成运行（`activeRunId` 且 `bp.state ∉ {done,aborted}`）先 `engine.abort(runId)` 把运行杀到 `aborted` 终局（杀前台+后台、清后台记录），再删卡——不留孤儿。渲染层用实时 `bp.state` 判是否「有未完成运行」以决定确认提示是否追加「会一并中止其运行」。

**分支/worktree 回收**：删卡默认只删卡+停运行、不碰 git。确认框拉 `cardBranchCleanupInfo`（按 `merge-base --is-ancestor` 算每条成员分支是否已合并）逐条展示合并状态，给一个勾选「同时回收」。勾选后 `removeCard(slug, {recycleBranches:true, allowUnmerged:true})` → 主进程 abort→`recycleCardBranches`（先 `removeWorktree(force)` 再 `deleteBranch`，未合并按 `allowUnmerged` 走 `forceDeleteBranch`）→删卡。勾选即视为允许强删未合并分支，故有未合并分支时确认框显式警示提交将丢失。

- **op 层（`validateOps` 校验 agent 提的 `delete`）**：仍复用**既有「破坏性结构操作只作用于待办列」判定**——agent 只能删待办卡（不能删已跑卡）。这是与手动删卡刻意的分工：手动=用户直接意图、可中止运行并回收；agent=保守、不碰在途工作。

- **理由**：手动路径给用户完整掌控（含中止+回收），消除死角；op 路径保守挡住 agent 误删在途卡。两者判据不同但各自合理。

### 决策 4：`delete` op 的形状与破坏性归类

`CardOp` 加一支：`{ kind: 'delete'; target: string }`（`target` = 被删卡 `proposedName`）。`coerceOp` 逐条容错收敛（缺 `target` 返回 null 丢弃）；`DESTRUCTIVE_OP_KINDS` 加 `'delete'`（应用前二次确认，确认提示交代删哪张卡）；`applyOps` 派发 `delete` → `cardStore.remove`。审阅界面把 `delete` 呈现为「删 X」预览，可勾选。

## Risks / Trade-offs

- **[删父卡孤儿化子卡]** → `cardStore.remove` 只清「别人指向它的边」，删一张 container 父卡后，其子卡失去 parent 边但仍存活（不级联删）。这是刻意的保守行为（避免误删一串）；二次确认提示只交代删这一张。可接受，文档标注。
- **[运行终局后 `activeRunId` 是否清空的不确定性]** → 决策 3 已规避：渲染层用 `bp.state`、op 层用「待办列」定义，都不裸依赖 `activeRunId` 是否被清。
- **[两条删除路径的确认力度不一致]** → 手删走 `ConfirmDialog`、op 删走审阅内的破坏性二次确认；两者都满足「删前明确确认且交代删哪张」，措辞对齐即可，不强求同一组件。
- **[header 图标语义不自明]** → 纯图标靠 `aria-label` + `title` 兜底可读性；play/pause/trash 是通用图标，风险低。

## Migration Plan

无数据迁移、无新依赖。纯增量：加 op 类别 + 加 UI 入口 + 加 store action。回滚即还原这几处改动，`cardStore.remove` 等底层不受影响（本就被 split/merge 使用）。
