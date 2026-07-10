## Context

`ENGINE_OPERATIONS`（`src/shared/workflow.ts`）现为一个纯字符串封闭词表，4 个值全是确定性 git/worktree 动作。`WorkflowEditor.tsx` 的 `NodeDetail` 在 `ExecutorFields` 之后**无条件**渲染「可写范围 / 产出 / 检查」三块（行 1135–1180），不分执行者类型。结果：引擎节点（如 `create-branch`）下方挂着三块永远不会被引擎消费的设置，误导用户。

这三块的语义本属「会写代码/写文档的执行者」：可写范围圈定 agent 可改文件、产出是交付的 markdown、检查是对产出跑门。代码里已有同类先例——`agent 执行配置`「SHALL 只在 agent 时呈现」、「查看完整 prompt」按钮仅 agent 显示——按执行者能力裁剪界面是既定模式。

## Goals / Non-Goals

**Goals:**
- 引擎操作从「字符串」升级为「带能力声明的封闭操作」，能力（产出/门/可写范围）作为显隐与将来执行的单一来源。
- `NodeDetail` 按当前执行者能力条件渲染三块；当前所有引擎操作下三块隐藏。
- 未来加「会产出/要检查/要可写范围」的引擎操作，只置位其能力即自动显示，零界面改动。

**Non-Goals:**
- 不改 `workflow.yaml` 数据模型、不改读写往返、不动既有工作流包（能力是 UI/校验侧元数据）。
- 不改 `command` / `subworkflow` 既有呈现行为（本次只解决用户提出的 engine 噪音；见 Decisions 的范围裁剪）。
- 不实现引擎执行本身——能力声明此刻只服务 UI 显隐。

## Decisions

### 决策 1：能力住在「操作描述」上，而非散落 UI 条件里
把 `ENGINE_OPERATIONS` 从 `string[]` 升级为一张操作→能力表，例如：

```ts
export interface EngineOpCapabilities {
  producesOutputs: boolean
  supportsGate: boolean
  supportsWritableScope: boolean
}
const NO_CAP: EngineOpCapabilities = { producesOutputs: false, supportsGate: false, supportsWritableScope: false }
export const ENGINE_OPERATION_SPECS = {
  'create-branch': NO_CAP,
  'open-worktree': NO_CAP,
  'merge-branch': NO_CAP,
  'delete-branch-worktree': NO_CAP
} as const
// 兼容既有用法：下拉列表仍需操作名数组
export const ENGINE_OPERATIONS = Object.keys(ENGINE_OPERATION_SPECS) as ...
export function engineOpCapabilities(op: string): EngineOpCapabilities { return ENGINE_OPERATION_SPECS[op] ?? NO_CAP }
```

未知/空操作回落 `NO_CAP`，保证显隐逻辑无须特判。**备选**：在 UI 里写 `if (op === 'create-branch' || ...)` 硬编码——否决，每加操作都要改 UI、违反单一来源。

### 决策 2：以「执行者→能力」解析函数统一显隐
新增 renderer 侧纯函数 `nodeSectionVisibility(executor)`（或直接在 `NodeDetail` 内联）返回 `{ writableScope, outputs, gate }` 三个 boolean：
- `agent` → 三者皆 true（保持现状）。
- `engine` → 取 `engineOpCapabilities(executor.operation)` 三项。未选操作 operation 为 `''` → 全 false。
- `command` / `subworkflow` → 维持现状（见决策 3）。

`NodeDetail` 据此条件渲染：`visibility.writableScope && <FieldGroup ...>`、`visibility.outputs && <OutputsEditor ...>`、`visibility.gate && <GateEditor ...>`。

### 决策 3：范围裁剪——本次只动 agent/engine 两类
用户的诉求是「引擎操作的三块噪音」。`command`/`subworkflow` 当前也常显这三块，但改它们的显隐属于另一个判断（command 是否会写文件、subworkflow 是否该带自己的门），超出本次问题。本次让这两类**维持现状**（继续显示），只把 `engine` 接入能力驱动、`agent` 显式声明为全显。spec 的「节点设置块按执行者能力呈现」只规定 agent 与 engine 两类的行为，不约束另两类，给后续单独演进留口。

### 决策 4：保存清洗不变
`cleanForSave` 已丢弃空 writableScope / 空动作按钮；引擎节点本就 `outputs: []`、无门、无 writableScope。隐藏块不渲染即不产生新字段，无需额外清洗。校验逻辑（`validateNode`）也无须改——它对空数组天然通过。

## Risks / Trade-offs

- [既有引擎节点曾被手填过产出/门/可写范围（理论上可能）] → 这些字段在隐藏后仍留在定义里、不被 UI 展示也不被清除。但默认种子与正常使用下引擎节点这些字段恒为空；如担心，可在 `cleanForSave` 对「无对应能力的执行者」顺手清空三字段（可选增强，spec 未强制）。
- [测试断言依赖三块常显] → `WorkflowEditor.test.tsx` 现有用例若在引擎节点上断言这三块存在，需改为断言其隐藏；agent 节点用例不受影响。
- [能力表与未来真实引擎执行语义脱节] → 当前能力纯服务 UI；引擎落地时这张表正好复用为执行期「该操作会不会产出/写盘」的声明，方向一致、无返工。

## Migration Plan

纯增量、无数据迁移：能力不进 `workflow.yaml`。部署即生效；回滚即恢复无条件常显，不影响任何已存工作流包。
