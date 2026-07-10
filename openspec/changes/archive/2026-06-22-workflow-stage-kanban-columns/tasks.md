## 1. 列模型纯逻辑（测试先行）

- [x] 1.1 写测试：一个纯函数 `buildBoardColumns(activeWorkflow)` 返回有序列数组——有激活工作流时为 `[待办] + stages + [已完成]`，列序与列名（阶段名）与 `stages` 一致、不去重不重排
- [x] 1.2 写测试：`activeWorkflow` 为 `null`（未激活或定义缺失）时只返回 `[待办, 已完成]` 两列书挡
- [x] 1.3 写测试：书挡用固定 sentinel key（`__todo__`/`__done__`）恒在首尾，即便某阶段名恰为「待办/已完成」也独立成中间列、key 不冲突
- [x] 1.4 实现 `buildBoardColumns` 使上述测试由红转绿（放在渲染层共享的纯逻辑文件，如 `src/renderer/src/lib/board.ts`）

## 2. 看板组件（测试先行）

- [x] 2.1 写 `BoardColumn` 测试：渲染列头（列名）；当列为「待办」书挡时列体底部渲染「+ 创建」按钮并在点击时调用 `onCreate`；非待办列不渲染该按钮；列体为空容器（不渲染需求卡）
- [x] 2.2 写 `KanbanBoard` 测试：给定一个含阶段的 `activeWorkflow`，按 `buildBoardColumns` 渲染出「待办」+各阶段+「已完成」列；给定 `null` 只渲染两列书挡
- [x] 2.3 实现 `BoardColumn`：列头 + 空列体（「待办」列底部「+ 创建」按钮，`aria-label` 复用 `newRequirement.entry`），仅用语义令牌、支持深浅双主题（对照 `docs/brand`）
- [x] 2.4 实现 `KanbanBoard`：接 `activeWorkflow` 与 `onCreate`，用 `buildBoardColumns` 渲染列、横向排布（列定宽、容器横向滚动），仅用语义令牌

## 3. 接线到主面板（测试先行）

- [x] 3.1 写 `App` 测试：挂载时拉取激活工作流（`getActiveWorkflow` → `getWorkflow`）并把定义传给看板；`<main>` 内渲染 `KanbanBoard`，与 `FileViewer`/`NewRequirementFlow` 浮层并存
- [x] 3.2 写测试：点击「待办」列「+ 创建」触发 `useNewRequirementStore.openEntry()`（未绑定项目给空态、否则进描述想法窗，复用既有行为）
- [x] 3.3 在 `App.tsx` 增 `activeWorkflow` state，项目加载/切换时经 `getActiveWorkflow + getWorkflow` 拉取并下传给 `KanbanBoard`，`onCreate` 绑 `openEntry`

## 4. 切换工作流实时重算（测试先行）

- [x] 4.1 写 `WorkflowPicker` 测试：激活某工作流后调用新增的 `onActiveChange(id)` 回调
- [x] 4.2 给 `WorkflowPicker` 增可选 `onActiveChange?(id)`，`onActivate` 成功后调用；经 `Sidebar → Settings → WorkflowPicker` 透传至 `App.tsx`
- [x] 4.3 在 `App.tsx` 的回调里重新 `getWorkflow(id)` 刷新 `activeWorkflow`，验证看板中间阶段列随之重算、书挡列不变（补一条测试覆盖切换重算）

## 5. 迁移新建需求入口

- [x] 5.1 移除 `Sidebar.tsx` 的临时新建需求入口按钮（行 145-154）及随之多余的 import（`FilePlus2`、若不再用到的 store import）
- [x] 5.2 更新/补 `Sidebar` 测试：确认侧边栏不再渲染该入口；确认新建需求入口现仅由看板「待办」列承载

## 6. 文案与收尾

- [x] 6.1 新增 i18n：`board.todo`(待办/Todo)、`board.done`(已完成/Done)、`board.create`(创建/Create) 到 `zh.ts` 与 `en.ts`
- [x] 6.2 跑 `npm run typecheck` 与 `npm run test:run` 全绿
- [x] 6.3 dogfood 自检（用户确认）：有激活工作流时主面板按阶段渲染列、未激活只两列书挡、「待办」列「+ 创建」可打开描述想法窗、列横向可滚（滚轮/滚动条）、列尾不被常驻底栏遮挡、深浅主题无硬编码颜色翻车
