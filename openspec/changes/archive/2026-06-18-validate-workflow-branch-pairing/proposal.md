## Why

工作流里「建分支」（engine 操作 `create-branch`）若没有配对的「删分支」（`delete-branch-worktree`），跑完会把分支/worktree 泄漏在磁盘上，越攒越多还可能造成半合并死循环。这类工作流不该被保存、更不该被项目激活去跑——必须在编辑保存时就拦住，并在选择处明确标成「无效」、不让用。

## What Changes

- 新增**分支配对校验**：工作流中只要有节点是 `create-branch`，就必须至少有一个节点是 `delete-branch-worktree`；否则判为「无效」。这是**语义校验**，与现有的结构校验（`validateWorkflow`）分开——无效工作流仍能被列出和展示，只是被标记、被拦截，而不是像损坏包那样被静默跳过。
- 工作流编辑器**保存时拦截**：点保存若分支配对校验不过，弹出模态提示说明原因，并拒绝写盘（不调用 `saveWorkflow`）。
- 全局「工作流库」(`WorkflowLibrary`) 列表项：无效工作流名称旁显示**（无效）**标记，并可见原因。
- 项目「激活工作流」选择器 (`WorkflowPicker`)：无效工作流显示**（无效）**、其单选项**禁用不可选**；若当前已激活的工作流变为无效，明确标示。
- `WorkflowSummary` 增加可选字段承载「无效原因」，作为列表/选择器判断的单一来源。

## Capabilities

### New Capabilities
<!-- 无新增能力；本变更扩展既有 workflow-definition 能力。 -->

### Modified Capabilities
- `workflow-definition`: 在「工作流定义校验」中新增分支配对的语义校验维度（建分支须有删分支），并明确它与结构校验「是否阻止包载入」的区别；扩展「工作流列表项摘要」携带无效原因，供库列表与项目选择器标示与禁用。

## Impact

- `src/shared/workflow.ts`：新增分支配对校验函数；`workflowSummary` 计算并携带无效原因。
- `src/shared/types.ts`：`WorkflowSummary` 增加可选无效原因字段。
- `src/renderer/src/components/WorkflowEditor.tsx`：保存前增加分支配对校验 + 弹出模态拒绝保存。
- `src/renderer/src/components/WorkflowLibrary.tsx`：列表项展示（无效）标记与原因。
- `src/renderer/src/components/WorkflowPicker.tsx`：（无效）标记 + 禁用不可选。
- 对应测试：`src/shared/workflow.test.ts`、`WorkflowEditor.test.tsx`、`WorkflowLibrary.test.tsx`、`WorkflowPicker.test.tsx`。
- 无新依赖；不改 IPC 形状（仅 `WorkflowSummary` 增一个可选字段，向后兼容）。
