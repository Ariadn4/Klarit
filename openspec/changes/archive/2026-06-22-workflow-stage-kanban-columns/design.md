## Context

项目窗口主面板（`App.tsx` 的 `<main>`，`src/renderer/src/App.tsx:226-232`）目前只挂着两个全局 store 驱动的浮层：`FileViewer` 与 `NewRequirementFlow`，没有任何看板。工作流模型早把**阶段**定义成「看板列」（`WorkflowStage { id; name }`，`src/shared/types.ts:320`），`WorkflowDefinition.stages` 是有序列表；项目经 `getActiveWorkflow()`（返回 workflowId）+ `getWorkflow(id)`（返回完整定义）取激活工作流。新建需求入口现为侧边栏底部一个临时按钮（`Sidebar.tsx:145-154`，注释明写「随需求看板 change 再定正式位置」），点击调 `useNewRequirementStore.getState().openEntry()`。

关键现状约束（探查确认）：
- **需求卡尚未落库**，且 `RequirementCard` 只有 `status`、**无 `stageId`**（卡在哪一列属「运行断点」，尚未建模）。故本 change 无从把卡放进列——只能渲染列骨架。
- 渲染层**没有 project/workflow 的 zustand store**；这类状态由 `App.tsx` 用 `useState` 持有、经 `window.klarit` IPC 取。
- `WorkflowPicker`（`src/renderer/src/components/WorkflowPicker.tsx`）激活工作流时只调 `setActiveWorkflow(id)` 并更新自身局部 state，**不向上通知任何人**——这是「切换工作流要实时重算列」必须补的接缝。

## Goals / Non-Goals

**Goals:**
- 主面板渲染有序看板列：`「待办」+ 激活工作流各阶段（按序）+「已完成」`。
- 「待办」「已完成」为恒定书挡列，未激活/定义缺失时也渲染（仅这两列）。
- 切换激活工作流时中间阶段列实时重算。
- 把新建需求入口从侧边栏移到「待办」列底部的「+ 创建」按钮，触发逻辑不变。
- 遵循品牌规范、仅用语义令牌、深浅双主题。

**Non-Goals:**
- 不渲染需求卡、不做卡入列（无 `stageId`、未落库）。
- 不引入拖拽、不改工作流数据模型、不新增主进程/IPC 能力。
- 不引入 dockview（主面板看板是普通横向列布局，不是可停靠面板）。
- 不为渲染层新建 project/workflow 全局 store（本 change 用既有 `App.tsx` state 提升即可）。

## Decisions

### 决策 1：列模型 = 书挡常量 + 工作流阶段，在渲染层拼装
看板列在渲染层由 `[待办书挡] ++ stages ++ [已完成书挡]` 拼成。书挡列是**前端常量**（不来自工作流），用固定的 sentinel key（如 `'__todo__'`/`'__done__'`）与本地化列名；中间列 key 用 `stage.id`、列名用 `stage.name`。
- **为何**：书挡列语义上独立于工作流（「未进入流程」与「已完结」），把它们做成常量避免污染工作流模型；用 sentinel key 即便阶段名恰为「待办/已完成」也不冲突（spec 要求书挡恒在首尾、阶段仍独立成列）。
- **备选**：把书挡也塞进工作流 stages —— 否决，会污染工作流定义且每个工作流都要带这两阶段。

### 决策 2：数据源用 `getActiveWorkflow + getWorkflow`，状态提升到 `App.tsx`
看板需要**完整 `WorkflowDefinition`**（要 `stages`），而 `getActiveWorkflow()` 只给 id，故链式 `getWorkflow(id)` 取定义。在 `App.tsx` 新增 state `activeWorkflow: WorkflowDefinition | null`，在项目加载/切换时拉取，作为 prop 传给看板组件。
- **为何**：与现有架构一致（App 持有、IPC 取、props 下传），不为此引入新 store。用 `getActiveWorkflow` 而非 `current.activeWorkflowId`，与 `WorkflowPicker` 同源，避免 `current` Project 对象里该字段过期。
- **备选**：看板组件自取自管 —— 可行但要把「切换后刷新」的事件单独发到组件，不如状态提升直接。

### 决策 3：切换工作流→实时重算，靠「回调上提」
给 `WorkflowPicker` 增一个可选回调 `onActiveChange?(id)`；激活成功后调它。该回调由 `App.tsx` 提供（经 `Sidebar → Settings → WorkflowPicker` 透传），在其中重新 `getWorkflow(id)` 刷新 `activeWorkflow` state，看板随之重渲染。
- **为何**：现成路径最小改动即满足 spec 的「实时重算」；无需事件总线。
- **备选 A**：引入轻量 zustand store 存 activeWorkflow，picker 写、board 读 —— 更解耦但超出本 change 必要范围，留作后续若 prop 透传变深时再做。
- **备选 B**：主进程在 `setActiveWorkflow` 后推 IPC 事件，App 订阅 —— 最稳但要新增主进程事件，非必要。
- **权衡**：备选 A/B 更干净；选回调上提是因为它改动面最小、与现有 `onChange*` 回调风格一致。若透传层级让人难受，落地时可升级为备选 A。

### 决策 4：组件拆分 `KanbanBoard` + `BoardColumn`
- `KanbanBoard`：接 `activeWorkflow` 与 `onCreate`（=`openEntry`），算出列数组并横向排布（列定宽、容器横向滚动），用语义令牌（`bg-canvas`/`bg-paper`/`border-stone-*`/`text-ink` 等）。
- `BoardColumn`：列头（列名）+ 列体（本期空容器）；「待办」列在列体底部渲染「+ 创建」按钮（`onCreate`）。
- 挂载点：`App.tsx` 的 `<main>` 内，与 `FileViewer`/`NewRequirementFlow` 浮层并存（看板是底层内容，两浮层在其上）。

### 决策 5：入口迁移与文案
- 删除 `Sidebar.tsx:145-154` 的临时入口按钮（及其多余 import）。
- 「+ 创建」按钮 `aria-label` 复用 `newRequirement.entry`；新增列名/按钮文案：`board.todo`(待办)、`board.done`(已完成)、`board.create`(创建) 到 `zh.ts`/`en.ts`。

## Risks / Trade-offs

- **[Prop 透传变深]** `onActiveChange` 要穿 `Sidebar → Settings → WorkflowPicker` → 落地时若觉繁，升级为决策 3 备选 A（轻量 store）。
- **[空看板观感单薄]** 本期列内无卡，界面偏空 → 可接受（骨架先行）；后续卡入列 change 补上。列体给「空态」留视觉占位即可，不过度设计。
- **[激活态双源]** `getActiveWorkflow`（window 级）与 `Project.activeWorkflowId` 并存 → 统一以 `getActiveWorkflow` 为看板单一来源，避免取到过期字段。
- **[工作流定义损坏/缺失]** `getWorkflow` 返回 null → 看板按「未激活」处理（只渲染两列书挡），不崩溃（spec 已含该场景）。
- **[阶段名与书挡同名]** 用 sentinel key + 位置固定保证书挡恒在首尾、阶段独立成列，无 key 冲突。

## Open Questions

- 列内「空态」是否要文案占位（如「暂无需求卡」），还是纯空白？倾向纯空白或极轻提示，避免与后续卡入列设计冲突——可在实现时按品牌规范定，必要时反馈用户。
