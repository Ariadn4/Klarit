## 1. 引擎操作能力声明（shared）

- [x] 1.1 在 `src/shared/workflow.test.ts` 先写测试：`engineOpCapabilities` 对 4 个现有操作返回三项能力皆否；对空串/未知操作回落三项皆否；`ENGINE_OPERATIONS` 仍含且仅含原 4 个操作名（先红）
- [x] 1.2 在 `src/shared/workflow.ts` 把 `ENGINE_OPERATIONS` 升级为带能力声明的操作集（`EngineOpCapabilities` 类型 + 操作→能力表），导出 `engineOpCapabilities(op)` 纯函数；保留 `ENGINE_OPERATIONS` 名数组以兼容下拉与既有引用（转绿）
- [x] 1.3 确认 `migrateWorkflowShape` / `validateWorkflow` / `checkBranchPairing` 等既有引用不受词表形态变化影响（类型与往返测试全绿）

## 2. 节点设置块按能力显隐（renderer）

- [x] 2.1 在 `WorkflowEditor.test.tsx` 先写测试：agent 节点详情呈现可写范围/产出/检查三块；engine 节点选中 `create-branch` 时三块均不呈现；engine 未选操作时三块均不呈现（先红）
- [x] 2.2 在 `WorkflowEditor.tsx` 实现执行者→能力解析（agent 全 true；engine 取 `engineOpCapabilities(operation)`），在 `NodeDetail` 据此条件渲染三块（command/subworkflow 维持现状）（转绿）
- [x] 2.3 既有用例无对引擎节点「三块常显」的断言，无须调整；agent 用例与切换执行者用例仍绿（26/26）

## 3. 校验与收尾

- [x] 3.1 `npm run test:run` 全绿（517/517）、`npm run typecheck` 通过
- [x] 3.2 `npm start` 手动确认：引擎节点（create-branch）下不再出现可写范围/产出/检查；agent 节点三块照常（经受控 Playwright 实例驱动确认，engineHas 三项皆 0 / agentHas 三项皆 1）
