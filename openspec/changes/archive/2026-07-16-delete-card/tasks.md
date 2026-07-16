## 1. delete CardOp（shared，测试先行）

- [x] 1.1 在 `src/shared/card-ops.test.ts` 写红：`normalizeOps` 把 `{ kind:'delete', target:'x' }` 收敛为合法 op；缺 `target` 的 delete 原始项被丢弃
- [x] 1.2 在 `src/shared/card-ops.test.ts` 写红：`validateOps` 判定——目标存在且在待办列的 delete 合法；目标不存在 / 目标已离开待办（进行中/有 activeRunId）的 delete 非法且带可读原因
- [x] 1.3 `src/shared/types.ts`：`CardOp` 加 `{ kind: 'delete'; target: string }`；`DESTRUCTIVE_OP_KINDS` 加 `'delete'`
- [x] 1.4 `src/shared/card-ops.ts`：`coerceOp` 收敛 `delete`（缺 target 返回 null）；`validateOps` 校验 delete 目标存在 + 复用「待办列」判定挡越界
- [x] 1.5 跑绿：`npx vitest run src/shared/card-ops.test.ts`

## 2. delete op 落库派发（main，测试先行）

- [x] 2.1 在 `src/main/apply-ops.test.ts` 写红：应用勾选的 delete op → 目标卡被 `cardStore.remove` 删除、悬挂边被清；未 `confirmedDestructive` 时 delete 不落库
- [x] 2.2 在 `src/main/apply-ops.test.ts` 写红：目标已离开待办的 delete op 判非法不应用、回报原因
- [x] 2.3 `src/main/apply-ops.ts`：派发 `delete` → `cardStore.remove`；delete 归入破坏性 op 门（未确认拦下）
- [x] 2.4 跑绿：`npx vitest run src/main/apply-ops.test.ts`

## 3. removeCard store action（renderer，测试先行）

- [x] 3.1 在 `src/renderer/src/stores/cards.test.ts` 写红：`removeCard(slug)` 调 `window.klarit.removeCard`、随后 `load` 刷新、若删的是当前详情卡则 `closeDetail`
- [x] 3.2 `src/renderer/src/stores/cards.ts`：加 `removeCard` action（`window.klarit.removeCard(slug)` → `load()` + 视情况 `closeDetail()`）
- [x] 3.3 跑绿：`npx vitest run src/renderer/src/stores/cards.test.ts`

## 4. 详情面板 header 图标化 + 删除按钮（renderer，测试先行）

- [x] 4.1 在 `RequirementCardDetail.test.tsx`（无则新建）写红：header 呈现运行主控图标，随 `bp.state` 在 play/pause 间切换，动作分别调 runCard/pauseRun/resumeRun；正文不再有运行/暂停/恢复按钮
- [x] 4.2 写红：header 有删除按钮；点击经 `ConfirmDialog` 二次确认后调 `removeCard`；取消不删
- [x] 4.3 写红：卡有活跃运行（activeRunId 且 bp.state 非 done/aborted）时删除按钮禁用 + 提示「先中止运行再删」；运行终局/未运行时可删
- [x] 4.4 `src/renderer/src/components/RequirementCardDetail.tsx`：header 收敛一排纯图标（▶/⏸ · 🗑 · ✕，复用 ✕ 样式、delete hover 警示色、与 ✕ 留间距 + aria-label/title）；正文移除 run/pause/resume；命令推进控件留正文不动
- [x] 4.5 接删除按钮到二次确认 + `removeCard`，禁用判定用 `activeRunId && bp.state 非终局`
- [x] 4.6 跑绿：`npx vitest run src/renderer/src/components/RequirementCardDetail.test.tsx`

## 5. i18n 文案

- [x] 5.1 `src/renderer/src/i18n/locales/zh.ts` 与 `en.ts` 补：删除、确认删除该卡（交代删哪张）、先中止运行再删、删卡按钮 aria-label；delete op 审阅预览「删 X」文案
- [x] 5.2 确认 header 图标按钮 aria-label/title 走 i18n，深浅两主题下均用语义令牌不硬编码颜色

## 7. 删除即中止运行（dogfood 后修订：暂停卡删不掉的死角）

- [x] 7.1 引擎加 `abort(runId)` 原语（杀前台+后台、清后台记录、落 `aborted`；已终局幂等、未知返回 null）+ engine.test 覆盖门上/暂停/幂等
- [x] 7.2 `cardsRemove` handler 改 async：卡有 `activeRunId` 时先 `engine.abort` 再 `store.remove`（级联中止，不留孤儿）
- [x] 7.3 详情面板删除按钮改为始终可用（去禁用）；有未完成运行时确认提示追加「删除会一并中止其运行」；更新组件测试
- [x] 7.4 i18n 去 `deleteDisabledRunning`、加 `deleteConfirmAbortRun`；spec 与 proposal 同步修订（requirement-card-detail + 新增 engine-execution delta）

## 8. 分支/worktree 回收（dogfood 后加：知情同意删分支）

- [x] 8.1 `card-cleanup.ts` + 测试：`branchCleanupInfo`（算合并状态/worktree 存在，注入 runner+exists）、`recycleCardBranches`（先删 worktree(force) 再删分支；未合并按 allowUnmerged 强删或保留）
- [x] 8.2 shared 加 `BranchCleanupItem` / `RemoveCardOptions`；IPC 加 `cardsBranchCleanupInfo`；preload 接两个；`removeCard` 带 opts
- [x] 8.3 主进程：`cleanupMembersOf` 从运行成员派生回收上下文；`cardsBranchCleanupInfo` handler；`cardsRemove` 勾选时 abort→recycle→remove
- [x] 8.4 renderer store `removeCard(slug, opts)` 透传；详情面板确认框拉 cleanup info、列合并状态 + 勾选回收 + 未合并强删警示；组件测试覆盖
- [x] 8.5 i18n：回收勾选、已合并/未合并、未合并强删警示（zh/en）

## 6. 收尾校验

- [x] 6.1 `npm run typecheck` 两套 config 通过
- [x] 6.2 `npm run test:run` 全绿
- [x] 6.3 dogfood（`npm start`，不监听源码）：手动删卡（二次确认→消失）、暂停/运行中卡删除即中止运行、分支回收勾选按合并状态删 worktree+分支、agent 提 delete 提案经审阅二次确认后删卡（用户已验收）
- [x] 6.4 `npx openspec validate delete-card --strict` 通过
