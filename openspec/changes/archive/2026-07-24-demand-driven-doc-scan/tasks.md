# Tasks

> 设计岔口已定:**A 激活即扫**。

## 1. 工作流是否含 archive-docs 的结构判定
- [x] 1.1 写测试:`workflowUsesArchiveDocs(def): boolean`——含 `engine`+`archive-docs` 节点 → true;否则(含 agent `opsx:archive`)false
- [x] 1.2 实现纯工具(shared/workflow.ts)

## 2. 翻转触发链:导入 → 先 author
- [x] 2.1 (薄接线,typecheck 覆盖)首次导入(非 reused)完成触发 `runWorkflowOnboarding`
- [x] 2.2 实现:触发从 `IPC.documentsAnalyze` 返回处移到导入路径(`importProject`/`manageImportProject` 的 `!reused`);`documentsAnalyze` 仅返回分析

## 3. 文档扫描改需求驱动(方案 A:激活即扫)
- [x] 3.1 写测试:纯 `needsDocScanOnActivate(def, hasRegistry)`——含 archive-docs+无登记表→true;含+有登记表/不含/null→false
- [x] 3.2 实现:`activateWorkflow` 收口(三处激活点换用)挂需求驱动扫描(命中则 `notifyDocumentsOnboard`)
- [x] 3.3 移除首次导入无条件 onboarding:main 侧 817 的 `notifyDocumentsOnboard` + 渲染层 `maybeDocOnboard` 及 `onImport` 无条件弹;手动重扫保留

## 4. 渲染层 onboarding 触发迁移
- [x] 4.1 写测试:`App.tsx` projectBound/导入不再弹文档 onboarding、不跑 analyze;`documents:onboard` push 仍弹(需求驱动路)
- [x] 4.2 实现:去掉 `maybeDocOnboard` + `onImport` 无条件弹;保留 push 驱动 `onDocumentsOnboard`

## 5. 收尾
- [x] 5.1 `npm run typecheck`(两套)+ `npm run test:run`(1492 用例)全绿
- [x] 5.2 手动 dogfood:导入本项目 → 确认**不再先扫文档**、直接进 author 生成工作流(提案进对话)。行为翻转生效。(注:author 冗余产出的 archive-docs 会让激活时触发扫描——那是 author 质量问题,归步骤 2;本 change 的「按工作流用不用 archive-docs 决定扫不扫」逻辑正确。)
