## Why

上一个 change（gate-node-settings-by-capability）让节点详情的「可写范围 / 产出 / 检查」三块按执行者能力显隐，但为收敛范围把 `command` 与 `subworkflow` 暂留为「全显」。`subworkflow` 节点只是**委派**给另一条工作流执行——它自身不写代码、不交付文档、不跑门；这三件事由**被调工作流内部各节点**各自声明与承担。因此在 subworkflow 节点上挂这三块是噪音、且语义错位（在「调用点」声明可写范围/产出/门没有归属对象）。

## What Changes

- 节点详情对 `subworkflow` 执行者**不再呈现**「可写范围 / 产出 / 检查」三块——这些由被调工作流的内部节点承担。
- `agent`（三块全显）、`engine`（按所选操作能力）、`command`（维持现状全显，命令可能写盘/产出/受门约束）行为不变。

## Capabilities

### New Capabilities
<!-- 无新增能力 -->

### Modified Capabilities
- `workflow-editor`: 「节点设置块按执行者能力呈现」要求扩充——明确 `subworkflow` 执行者三块均不呈现（委派语义：可写范围/产出/门由被调工作流内部节点承担）。

## Impact

- `src/renderer/src/components/WorkflowEditor.tsx`：`nodeSectionVisibility` 增加 `subworkflow → 三块皆否` 分支。
- 纯 UI 显隐，无数据模型/校验/往返变化；既有 subworkflow 节点若曾填过这些字段，隐藏后字段仍留在定义里、不被展示也不被消费（与 engine 同处理）。
