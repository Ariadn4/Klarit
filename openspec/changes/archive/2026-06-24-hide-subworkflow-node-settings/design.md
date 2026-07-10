## Context

`gate-node-settings-by-capability` 引入了 `nodeSectionVisibility(executor)`（`WorkflowEditor.tsx`），按执行者能力决定「可写范围/产出/检查」三块显隐。为收敛范围，当时把非 engine 的执行者一律返回三项全 true（含 `subworkflow`）。本 change 只调整 `subworkflow` 一类。

## Goals / Non-Goals

**Goals:**
- `subworkflow` 节点三块全隐——委派语义，三件事由被调工作流内部节点承担。

**Non-Goals:**
- 不改 `command`（任意命令仍可能写盘/产出/受门，维持全显）。
- 不改数据模型/校验/往返。

## Decisions

### 在 `nodeSectionVisibility` 增 `subworkflow` 分支
现有函数：engine 走能力表，其余全 true。改为：engine 走能力表、subworkflow 全 false、其余（agent/command）全 true。

```ts
function nodeSectionVisibility(executor: NodeExecutor) {
  if (executor.kind === 'engine') { /* 能力表 */ }
  if (executor.kind === 'subworkflow') return { writableScope: false, outputs: false, gate: false }
  return { writableScope: true, outputs: true, gate: true } // agent / command
}
```

**备选**：把能力也抽象成「执行者种类的能力表」统一所有 kind——否决，过度设计；当前只有 subworkflow 需要从全显改为全隐，一个分支足够清晰。

## Risks / Trade-offs

- [既有 subworkflow 节点曾填过这些字段] → 隐藏后字段仍留定义、不展示不消费（与 engine 同处理，不主动清除）。低风险，正常使用下 subworkflow 节点这些字段为空。
