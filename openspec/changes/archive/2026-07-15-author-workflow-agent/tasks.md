# Tasks

> 遵项目宪法：**测试先行**（每块先写测试、确认先红后绿）；只测公共 API；仅用语义令牌、深浅双主题。

## 1. shared：写工作流 skill 生成器

- [x] 1.1 为 `buildAuthorWorkflowSkill()` 写测试（`shared/workflow.test.ts`）：断言 skill 文本覆盖全部 `ENGINE_OPERATIONS` 与执行者类型、含分支配对约束、含「只输出结构化工作流对象」收尾；引擎操作集变化时文本随之变（同 `buildDecomposeSkill` 的自动生成先例）
- [x] 1.2 实现 `buildAuthorWorkflowSkill()`（`shared/workflow.ts`，纯函数），从 `ENGINE_OPERATIONS`/`engineOpCapabilities`/执行者联合/校验约束合成，先红后绿

## 2. shared：产出与消息类型

- [x] 2.1 在 `shared/types.ts` 加 `WorkflowProposal` 型（完整 `WorkflowDefinition` + 可选 `baseId` + 校验 `issues`）；`OrchestrationProposal` 加可选 `workflow` 字段（工作流提案挂在 `proposal.workflow`，消息不另加字段——单一来源）
- [x] 2.2 typecheck 两套 config 通过（`npm run typecheck`）

## 3. main：编排产出解析加 workflow 分支

- [x] 3.1 扩 `parseOpsReply` 测试（`orchestrate-producer.test.ts`）：回复含 `workflow` 对象时收敛为合法 `WorkflowDefinition`（经 `migrateWorkflowShape` 归一）、带出 `baseId`；无 `workflow` 字段时行为与旧路径完全一致（卡编排不回归）；纯聊天轮不产 `workflow`
- [x] 3.2 实现 `parseOpsReply` 的 `workflow` 分支：抠对象取 `workflow`/`baseId`、`migrateWorkflowShape` 收敛，先红后绿

## 4. main：编排核上下文、自动修复与校验闸

- [x] 4.1 写测试：编排上下文装配恒带**工作流摘要**（`workflowSummary`，限当前项目可见库）；改写意图时按活动工作流（`getActiveWorkflowId()`）注入**完整基准定义**；未绑定项目/无工作流时不崩
- [x] 4.2 写测试 `repairWorkflow`（`shared/workflow.test.ts`）：补删分支节点、纠 stageId、填名、补默认阶段、丢执行者非法节点、过滤非法产出/门/可写范围——修复后必过 `validateWorkflow` + `checkBranchPairing`（**直接给合法工作流**）
- [x] 4.3 实现 `repairWorkflow`（`shared/workflow.ts`）；编排核 `buildWorkflowProposal` 先 repair 再校验，issues 作兜底（正常为空），先红后绿
- [x] 4.4 实现上下文装配带工作流摘要 + 注入基准定义（`orchestrate-service.ts`）；prompt 拼入 `buildAuthorWorkflowSkill()`；真实 deps 提供 `getWorkflowSummaries`/`getActiveWorkflow`（`main/index.ts`）

## 5. main/IPC：工作流提案落库

- [x] 5.1 确认既有 `saveWorkflow` IPC 即可落库：`workflow-store.save(def)` 按 `def.id` 建/覆盖包、校验为最终闸（已有测试覆盖 store.save）
- [x] 5.2 **复用既有 `saveWorkflow` 通道**（无需新通道）：改写在渲染层把 `def.id` 强制为 `baseId` 再调，即覆盖对应包

## 6. renderer：聊天呈现工作流提案 + 完整编辑器预览

> 注：dogfood 中把 6.3 的「紧凑只读预览」推翻为**完整 `WorkflowEditor` 浮层草稿态**（可编辑、底部横栏保存）——见 design D10 与 §8。

- [x] 6.1 写测试（`GlobalChatPanel.test.tsx`）：带 `proposal.workflow` 的 agent 消息在气泡内呈现提案板；改写强制 `def.id=baseId`
- [x] 6.2 `globalChat` store：`openWorkflowPreview`/`closeWorkflowPreview`/`markWorkflowSaved` + `previewSeq`（每次打开重挂编辑器）
- [x] 6.3 `GlobalChatPanel`：板子只留「工作流提案 + 预览草稿」按钮；点开 `WorkflowPreviewModal` 浮层承载 `WorkflowEditor`（草稿态）；仅用语义令牌、深浅双主题，先红后绿
- [x] 6.4 i18n：中英文案（提案标题、预览草稿、关闭/保存为正式工作流/更新工作流、设置为本项目工作流及其确认）入 `zh.ts`/`en.ts`

## 7. 收尾验证

- [x] 7.1 `npm run typecheck` + `npm run test:run` 全绿（1074 tests）
- [x] 7.2 e2e（`e2e/workflow-authoring.spec.ts`）：发意图 → 预览草稿 → 完整编辑器浮层（含 repair 自动补的删分支节点）→ 底部「保存为正式工作流」→ `listWorkflows` 确认入库；断言「设置为本项目工作流」保存前无、保存后现。假 producer 经 `KLARIT_E2E_WORKFLOW=1` 注入。注：既有 card-* / 多仓 e2e 在本机超时属**环境预存问题**（pristine 同样失败），非本次回归
- [x] 7.3 dogfood（`npm start`）：走 create / edit / 设为本项目工作流 各路径——**用户验收通过**

## 8. dogfood 迭代（用户反馈驱动）

- [x] 8.1 `AgentInstruction` 加 `installed` 形态（引用 CLI 已装技能按名调用，如 `opsx:explore`）：数据模型（`shared/types.ts`）+ 校验（`validateInstruction`/`isExecutorValid`）+ `repairWorkflow` + 编辑器执行者详情第三选项 + 运行期解析（`instructionPromptText` 回落）+ 写工作流 skill 教它别臆造路径/产物。测试先行
- [x] 8.2 多仓上下文：`AuthoringContext.repos` + 真实 `getProjectRepos`（取自 registry 成员仓 `derivedName`/`tag`/`id`）；skill 教 `target`。测试先行
- [x] 8.3 预览重构（推翻紧凑只读，见 D10）：`WorkflowEditor` 加 `initialDef` 草稿态 + `libraryFirst`（已存则读库、读不到回落草稿，修「已删再预览卡加载中」）；浮层复用完整编辑器、底部固定横栏（关闭 / 保存为正式工作流→更新工作流）
- [x] 8.4 「设置为本项目工作流」：底部按钮**仅在保存为正式后**出现、**已是激活工作流则隐藏**；二次确认 → 先保存再 `setActiveWorkflow` 激活到当前项目。测试先行
- [x] 8.5 写工作流 skill 可靠性收紧：讲清 command/门命令**只在主仓跑、不逐仓**、别硬编跨仓路径；劝阻脆弱的「必须失败」红门（改绿门 + 指令里做测试先行）；`reply`/`description` 面向需求、不复述引擎既定机制。测试先行（断言锁住这几条指引）
