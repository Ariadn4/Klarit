## Why

节点详情里「可写范围 / 产出 / 检查」三块对**每种执行者无条件常显**，但现有 4 个引擎内置操作（`create-branch` / `open-worktree` / `merge-branch` / `delete-branch-worktree`）全是确定性 git/worktree 动作——既不交付文档、也无需客观门、更不写业务文件，这三块挂在引擎节点下纯属噪音、误导用户去填永远不会被引擎消费的设置。这三块本质是给「会写代码/写文档的执行者」（主要是 agent）用的：可写范围圈定可改文件、产出是交付的 markdown、检查是对产出跑门。

## What Changes

- 引擎内置操作集从「纯字符串封闭词表」升级为「带**能力声明**的操作描述」：每个引擎操作声明它是否会**产出**、是否需要**检查**、是否需要**可写范围**。当前 4 个操作一律声明为「三者皆不需要」。
- 节点详情的「可写范围 / 产出 / 检查」三块改为**按所选执行者的能力按需呈现**，而非无条件常显：
  - `agent`：三块照常全显（行为不变）。
  - `engine`：按**所选具体操作**的能力声明逐块决定显隐；未选操作时三块全隐；当前 4 个操作下三块均隐藏。
  - 未来若新增「会产出 / 要检查 / 要可写范围」的引擎操作，只需在其能力声明里置位，UI 即据此自动显示对应块——无需再改界面逻辑。
- 保存前清洗与校验保持不变：被隐藏的块对应字段不写入（引擎节点本就 `outputs: []`、无 gate、无 writableScope）。

## Capabilities

### New Capabilities
<!-- 无新增能力，沿用既有两个能力的修订 -->

### Modified Capabilities
- `workflow-definition`: 引擎内置操作集从「封闭字符串词表」改为「带能力声明（producesOutputs / supportsGate / supportsWritableScope）的封闭操作集」，作为 UI 显隐与将来引擎执行的单一来源；当前所有操作能力均为否。
- `workflow-editor`: 节点详情对「可写范围 / 产出 / 检查」三块的呈现改为由执行者能力驱动——`agent` 三块全显；`engine` 按所选操作的能力声明逐块显隐、未选操作时全隐。

## Impact

- `src/shared/workflow.ts`：`ENGINE_OPERATIONS` 词表升级为带能力的操作表，新增按操作查能力的纯函数（main/renderer 共享，无新依赖）。
- `src/renderer/src/components/WorkflowEditor.tsx`：`NodeDetail` 据能力条件渲染可写范围/产出/检查三块。
- 既有数据兼容：能力声明是 UI/校验侧的元数据，不进 `workflow.yaml`，不影响读写往返与既有工作流包。
