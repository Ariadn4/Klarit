## Context

工作流以 engine 操作为骨架：建分支(`create-branch`) → 开 worktree(`open-worktree`) → …agent 干活… → 合并(`merge-branch`) → 删分支+worktree(`delete-branch-worktree`)。engine 操作集是封闭词表，定义在 `src/shared/workflow.ts` 的 `ENGINE_OPERATIONS`。

当前校验只有一个入口 `validateWorkflow(def)`（结构校验），它在三处被复用：编辑器保存前（`WorkflowEditor.save`）、存储层 `WorkflowStore.save`、以及存储层 `readDef`/`list`/`get` 载入时。其中 `readDef` 对**结构校验不过的包直接返回 null**——即结构非法 = 损坏包 = 静默跳过、不出现在列表里。

本变更要新增的是一类**不同性质**的校验：建分支却无删分支的「分支泄漏」。它不该让工作流从库里消失（那样用户既看不到也修不了），而要让工作流**仍然可见**、被标成「无效」、并在保存与激活两个出口被拦住。因此它必须与 `validateWorkflow` 分离，否则会被 `readDef` 的「不过即 null」逻辑吞掉。

## Goals / Non-Goals

**Goals:**
- 单一来源地定义「分支配对」规则，三端（shared 校验、编辑器、选择器/库）一致复用。
- 编辑器保存时弹模态拦截无效定义。
- 库列表与项目选择器标示「（无效）」，选择器禁用不可选。
- 不让无效工作流从库里消失。

**Non-Goals:**
- 不改 engine 操作词表，不引入新的 engine 操作。
- 不做「删分支无建分支」反向校验，不做顺序/计数配对校验。
- 不改 worktree 的实际回收逻辑（属引擎运行期）。
- 不改 IPC 通道形状（仅给 `WorkflowSummary` 加一个可选字段）。

## Decisions

### 决策 1：分支配对作为独立语义校验，不并入 `validateWorkflow`

新增 `src/shared/workflow.ts` 导出函数：

```ts
/** 分支配对：有 create-branch 必须有 delete-branch-worktree，否则无效（分支泄漏）。 */
export function checkBranchPairing(def: WorkflowDefinition): WorkflowValidation
```

判定：遍历 `def.nodes`，`hasCreate = 某节点 executor.kind==='engine' && operation==='create-branch'`；`hasDelete` 同理判 `delete-branch-worktree`。`hasCreate && !hasDelete` → `{ ok:false, reason: '工作流建了分支（create-branch）却没有对应的删分支节点（delete-branch-worktree），分支会被泄漏' }`，否则 `{ ok:true }`。

**为什么不并入 `validateWorkflow`**：`readDef` 对 `validateWorkflow` 不过的包返回 null，会让无效工作流彻底从库消失——与「展示为（无效）并可修复」的需求直接冲突。分离后：结构校验仍是「能否载入」的硬门槛；分支配对是「可载入但不可用」的软标记。

**备选**：给 `validateWorkflow` 加 `{ level: 'structural' | 'semantic' }` 参数。否决——调用点多、易错传，不如显式独立函数清晰。

### 决策 2：`WorkflowSummary` 携带无效原因，`workflowSummary()` 计算

`src/shared/types.ts`：

```ts
export interface WorkflowSummary {
  id: string
  name: string
  /** 分支配对等语义校验未过时的原因；缺省＝有效。UI 据此标（无效）并禁用选择。 */
  invalidReason?: string
}
```

`workflowSummary(def)` 内联调用 `checkBranchPairing`，不过则带 `invalidReason`。这样 `WorkflowStore.list()`（已用 `workflowSummary`）自动带出标记，无需改 main 进程其它逻辑。可选字段 → 向后兼容，既有消费方不受影响。

**为什么放在摘要里算**：库列表与选择器只拿到摘要（不取完整定义），把判定收敛到摘要构造处，渲染层只读 `invalidReason`、不重复跑校验，单一来源。

### 决策 3：编辑器保存——结构校验后加分支配对校验 + 模态提示

`WorkflowEditor.save()` 现有顺序：`cleanForSave` → `validateWorkflow`（不过 setError 返回）→ `saveWorkflow`。在 `validateWorkflow` 通过后、`saveWorkflow` 之前插入 `checkBranchPairing`；不过则**弹模态**并 return（不写盘）。

「弹出提示」用项目既有模态范式（`AgentOnboardingDialog`：`createPortal` 挂 body、`role="dialog"`、`aria-modal`、`bg-black/50` scrim、`bg-paper` 卡片、品牌语义令牌）。新增一个轻量确认/提示模态（标题 + 原因 + 「知道了」关闭按钮），用 `invalidDialog` 状态（`string | null`，存原因）控制显隐。不复用顶部红色 inline banner，因为需求明确要「弹出」。

### 决策 4：选择器禁用、库列表标记——纯渲染层读 `invalidReason`

`WorkflowPicker`：单选项按钮加 `disabled={!!w.invalidReason}`，`onClick` 守卫（无效不调 `onActivate`），名称后追加「（无效）」与 `title`/提示原因，禁用态用既有 stone 灰 + `opacity`/`cursor-not-allowed`，不新增配色。`aria-disabled` 同步。当前激活项若无效仍渲染「（无效）」。

`WorkflowLibrary`：列表项名称旁加「（无效）」小标（`text-danger` 或 stone 弱化 + `title` 原因），编辑/克隆/删除按钮不受影响。

## Risks / Trade-offs

- [既有磁盘上已有「建分支无删分支」的工作流（早于本校验保存的）] → 设计即覆盖此场景：它们结构合法仍会被列出，自动带 `invalidReason`、标（无效）、不可激活，用户进编辑器修复后才可保存。无需迁移脚本。
- [默认种子工作流恰好同时含建/删分支] → 通过校验，不受影响；已有 `workflow.test.ts` 对默认种子的断言不会破。
- [双重校验：结构校验与分支配对在保存路径各跑一次] → 工作流节点量级小（个位数～几十），开销可忽略；换来「损坏 vs 无效」语义清晰。
- [仅前端（shared/renderer）拦截，main 的 `saveWorkflow` 不拦分支配对] → 可接受：分支配对是 UI 引导性约束，不是数据完整性约束；main 仍由 `validateWorkflow` 守结构完整。若日后要硬保证，可在 `WorkflowStore.save` 追加 `checkBranchPairing`，本设计不强制以免无效工作流连保存草稿都不行。

## Migration Plan

无数据迁移。逐文件 TDD：先 shared 校验/摘要（红→绿），再编辑器保存拦截，再选择器/库标示。`WorkflowSummary` 加可选字段不破坏既有序列化与 IPC。回滚＝还原相关文件，无持久化结构变更。

## Open Questions

- 模态文案与「知道了」按钮用词，按品牌规范敲定，必要时向用户确认（不阻塞实现）。
