## 1. 共享边合法性谓词（单一来源）

- [x] 1.1 在 `requirement-card.test.ts` 写红测试覆盖 `isRelationEdgeLegal` 各分支：目标存在/不存在、自环、`parent` 父须容器、`blocks` 目标在跑（进行中/有 activeRunId/已离开待办）判非法、`blocked_by` 目标在跑放行、目标为现有落库卡通过、既有边不追溯
- [x] 1.2 在 `src/shared/requirement-card.ts` 实现 `isRelationEdgeLegal(edge, from, universe, registry)`（纯逻辑、无 fs/IPC），承载上述判据；转绿
- [x] 1.3 写红测试覆盖「成环检测跨『现有卡 ∪ 本批新卡』合并图」，把 `wouldCycle` 的图输入从 `Map<string,StoredCard>` 泛化为可同时喂现有卡+新批的视图，移入/供谓词复用；转绿

## 2. 分解路改调谓词 + 扩引用宇宙

- [x] 2.1 在 `decomposition.test.ts` 写红测试：候选卡关系 target 可引用现有落库卡（不再仅限本批）、候选卡 `blocked_by` 现有在跑卡通过、`blocks` 现有在跑卡进 issues、本批父子成环被检出
- [x] 2.2 改 `validateCandidateBatch` 接受「现有卡集合」参数、引用宇宙为「现有 ∪ 本批」、关系边合法性改调 `isRelationEdgeLegal`（删除本批内联的关系判断）；转绿
- [x] 2.3 更新 `buildDecomposeSkill` 的固定模板：说明 `target` 可引用现有卡 id、引导用 `blocked_by` 挂到相关现有卡；补 `decomposition.test.ts` 对 skill 文本的断言

## 3. 编排路改调谓词（补 relate 的 blocks 洞）

- [x] 3.1 在 `card-ops.test.ts` 写红测试：`relate add` 的 `blocks → 在跑卡` 判非法、`blocked_by → 在跑卡` 放行、`create` 内嵌 `blocks → 在跑卡` 判非法、`parent/child` 成环跨「现有 ∪ 新批」检出
- [x] 3.2 改 `validateOps` 的 `relate` 与 `create` 边校验改调 `isRelationEdgeLegal`（保留「发起卡须待办」既有约束）；补上 blocks 目标状态门；转绿

## 4. 分解流注入全盘上下文（主进程 + 类型）

- [x] 4.1 `DecomposeInput` 增可选全盘快照字段（现有卡活现状 + 关系图），保持向后兼容；更新 `src/shared/types.ts` 注释
- [x] 4.2 `decompose-service.runDecompose` 接受并透传「现有卡集合」到批校验；`decompose-service.test.ts` 覆盖注入现有卡后跨卡校验生效
- [x] 4.3 分解 IPC（`decomposeRequirement`）在主进程装配当前项目卡快照（复用 `buildBoardContext`/board-context 装配）注入分解输入与校验集

## 5. 复核窗呈现与编辑跨卡门（渲染层）

- [x] 5.1 在 `NewRequirementFlow.test.tsx` 写红测试：详情呈现 `blocked_by`/`blocks` 门及目标卡当前状态、可删一条门、加 `blocks → 在跑卡` 被拒并给原因、`typeId`/预取名/层级关系仍只读
- [x] 5.2 `TaskDetail`/`ReviewWindow` 实现跨卡门列表（标目标状态）、删除、加 `blocked_by` 指向现有卡的选择器；加/留的边过 `isRelationEdgeLegal`；仅用语义令牌、深浅双主题；转绿
- [x] 5.3 `newRequirement` store 携带现有卡上下文供详情呈现目标状态与校验；补 store 测试

## 6. 调度一致性与收尾

- [x] 6.1 在 `auto-schedule.test.ts` 补断言：不会出现「进行中却新增未满足 blocked_by」的态（依赖引入期门拦截）；硬门判定口径不变
- [x] 6.2 跑 `npm run typecheck` + `npm run test:run` 全绿；核对 `docs/brand` 令牌合规（复核窗新 UI）
- [x] 6.3 手动 dogfood（`npm start`）：描述一条依赖在跑任务的新需求 → 审阅窗见门与目标状态 → 创建后新卡 `blocked_by` 生效、被硬门挂起
