> 前置：`add-document-registry`（已落）+ `exclude-planning-docs`（登记表已剔除计划稿）。

## 1. archive-docs 引擎操作与委派合成（shared，测试先行）

- [x] 1.1 在 `src/shared/workflow.test.ts` 写红：`ENGINE_OPERATIONS` 含 `archive-docs`；其能力声明门位=否、产出位=是；校验接受 `operation: 'archive-docs'` 的引擎节点；旧包不含它加载不变
- [x] 1.2 写红：`buildArchiveDelegation(registry, ctx)` 按 kind 合成指令——dynamic 就地更新语、snapshot 按习惯追加语；仅 `approved` 的 habitPrompt/公约被注入；未审批仅 kind 兜底
- [x] 1.3 `src/shared/workflow.ts`：`ENGINE_OPERATION_SPECS` 加 `archive-docs`（门否、产出是）；实现 `buildArchiveDelegation`
- [x] 1.4 跑绿：`npx vitest run src/shared/workflow.test.ts`

## 2. 引擎执行 archive-docs（main，测试先行）

- [x] 2.1 在 `src/main/engine/engine.test.ts` 写红：引擎处理 `archive-docs`——有表有 agent → 委派归档、提交改动、过节点（经 `runArchiveDocsNode` 分派而非 `runEngineOpForMember`，比照 open-pr）
- [x] 2.2 写红：子 agent 能力探测——支持则委派带并行提示、不支持则串行提示、不确定走串行；两路产出等价
- [x] 2.3 写红：兜底——无 agent → `no-agent` 挂起；无登记表 → 建表提示挂起；空 `docs[]` → noop 过；多仓各归各仓各自提交
- [x] 2.4 `src/main/engine/engine.ts`：加 `archive-docs` 分派（读 `getDocRegistry` → 探测能力 → 合成委派 → 委派 agent 按 kind 归档 → **提交**，不同于 open-pr 的丢弃改动；writableScope 收窄到登记表文档位置）
- [x] 2.5 `src/main/engine/decisions.ts`：`archive-docs` 的 `no-agent` / 无表（`no-registry`）挂起决策
- [x] 2.6 跑绿：`npx vitest run src/main/engine/engine.test.ts`

## 3. 子 agent 能力探测（main，测试先行）

- [x] 3.1 写红：能力探测——支持子 agent 的运行时返回真、不支持返回假、不确定返回假（保守）
- [x] 3.2 实现能力探测（`src/shared/agents.ts` 的 `agentSupportsSubagents` + `SupportedAgent.supportsSubagents`；引擎经 `supportsSubagents` dep 门控，main 按默认 agent 解析）
- [x] 3.3 跑绿：`npx vitest run src/shared/agents.test.ts`

## 4. 写工作流 skill（shared，测试先行）

- [x] 4.1 在 `src/shared/workflow.test.ts` 写红：`buildAuthorWorkflowSkill` 输出含 `archive-docs` 及其语义（读登记表/按习惯归档/并行退化/提交）
- [x] 4.2 `src/shared/workflow.ts`：`buildAuthorWorkflowSkill` 自动带上 `archive-docs`（经 `ENGINE_OP_NOTES` 从操作集单一来源派生）
- [x] 4.3 跑绿：`npx vitest run src/shared/workflow.test.ts`

## 5. i18n 文案

- [x] 5.1 `src/renderer/src/i18n/locales/zh.ts` 与 `en.ts` 补：`archiveNoAgent`（无 agent）、`archiveNoRegistry`（先建立文档登记表）决策文案。（节点名/说明由工作流定义与操作集下拉直接派生，无需另加 i18n）

## 6.（可选）内置含归档的工作流种子

- [~] 6.1 定夺：**不落种子**。归档节点为作者可选（proposal 明确非强制），既有内置工作流（默认/PR/真 PR）不含它；留待作者按需在交付段自行加 `archive-docs`，避免扰动既有种子测试。

## 7. 全量校验

- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm run test:run`（全绿：116 文件 / 1308 用例）
