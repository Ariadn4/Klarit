## 1. Shared 层：分支配对校验与摘要（测试先行）

- [x] 1.1 在 `src/shared/workflow.test.ts` 加用例：`checkBranchPairing` 对「建分支无删分支→无效（带原因）」「建+删→有效」「无建分支→有效」三类；先红
- [x] 1.2 在 `src/shared/workflow.ts` 实现并导出 `checkBranchPairing(def): WorkflowValidation`（遍历 nodes 判 engine `create-branch` / `delete-branch-worktree`），让 1.1 转绿
- [x] 1.3 在 `src/shared/types.ts` 给 `WorkflowSummary` 增加可选字段 `invalidReason?: string`
- [x] 1.4 在 `workflow.test.ts` 加用例：`workflowSummary` 对无效定义带 `invalidReason`、对有效定义不带；先红
- [x] 1.5 改 `workflowSummary(def)` 内联调用 `checkBranchPairing`，不过则带 `invalidReason`，让 1.4 转绿
- [x] 1.6 确认默认种子（`createDefaultWorkflow`）通过分支配对校验，既有 `workflow.test.ts` 不破

## 2. 编辑器：保存拦截 + 模态提示（测试先行）

- [x] 2.1 在 `WorkflowEditor.test.tsx` 加用例：编辑出「有 create-branch 无 delete-branch-worktree」的定义点保存→出现模态提示且不调用 `saveWorkflow`；先红
- [x] 2.2 在 `WorkflowEditor.test.tsx` 加用例：分支配对通过时点保存→不弹该模态、正常调用 `saveWorkflow`
- [x] 2.3 在 `WorkflowEditor.tsx` 的 `save()` 中，于 `validateWorkflow` 通过后、`saveWorkflow` 前插入 `checkBranchPairing`，不过则设模态状态并 return
- [x] 2.4 新增分支配对提示模态（复用 `AgentOnboardingDialog` 范式：`createPortal`、`role="dialog"`、`aria-modal`、`bg-black/50` scrim、`bg-paper` 卡片、语义令牌；标题+原因+「知道了」关闭按钮），由 `string|null` 原因状态控制，让 2.1/2.2 转绿

## 3. 项目选择器：标示与禁用（测试先行）

- [x] 3.1 在 `WorkflowPicker.test.tsx` 加用例：带 `invalidReason` 的工作流条目显示「（无效）」、单选项 `disabled`、点击不调用 `setActiveWorkflow`；先红
- [x] 3.2 在 `WorkflowPicker.test.tsx` 加用例：有效工作流仍可点击激活并持久化（既有行为不回归）
- [x] 3.3 在 `WorkflowPicker.tsx` 给单选项加 `disabled={!!w.invalidReason}` 与 `onClick` 守卫、名称后缀「（无效）」与原因提示（`title`/`aria-disabled`），禁用态用既有令牌（不新增配色），让 3.1/3.2 转绿

## 4. 工作流库：列表标示（测试先行）

- [x] 4.1 在 `WorkflowLibrary.test.tsx` 加用例：带 `invalidReason` 的列表项名称旁显示「（无效）」、且编辑/克隆/删除入口仍可用；先红
- [x] 4.2 在 `WorkflowLibrary.tsx` 列表项渲染「（无效）」小标 + 原因 `title`（仅当 `invalidReason` 存在），不影响编辑/克隆/删除，让 4.1 转绿

## 5. 收尾校验

- [x] 5.1 `npm run typecheck` 通过（两套 config）
- [x] 5.2 `npm run test:run` 全绿
- [x] 5.3 自查改动遵守品牌令牌（无硬编码颜色，深浅主题不翻车）
