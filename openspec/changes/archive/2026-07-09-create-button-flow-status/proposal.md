## Why

新建需求流程现在有**两个割裂的状态锚点**:发起用「待办」列底部的「+ 创建」按钮,而处理态「建卡中」却钉在主面板右下角(`CreatingCardsIndicator`)。更糟的是审阅窗一旦「收起」,底栏无任何指示——用户只能凭记忆再点「+ 创建」撞回去。把全程状态收敛到「+ 创建」这一颗按钮上:用户想建卡时第一反应就是挪到这里,让它成为新建需求全程的唯一把手,少一个漂浮控件、补上审阅收起的盲区。

## What Changes

- 「+ 创建」按钮按新建需求流程相位改变形态,承担**全程状态**:
  - `idle` → 「+ 创建」(发起新建,现状不变)
  - `processing` → 转圈「建卡中」;点击重开处理窗;**不再发起新建**
  - `reviewing`(收起时)→ 「待审阅」状态(如「N 张候选待审阅」);点击重开审阅窗
  - `describing`(收起时)→ 反映「编辑中」;点击重开描述窗
  - 任一非 idle 相点击按钮 = 重开对应浮窗(复用既有 `openEntry` 语义),不另起分解
- **移除** `CreatingCardsIndicator`(主面板右下角全局「建卡中」指示)及其绝对定位/z-index。
- 接受取舍:全程状态随「待办」列**横向滚动**(不再全局钉住)。待办是最左书挡列,一般可见;且状态本就属于「新建」这件事。
- **BREAKING**(仅交互层):底栏「建卡中」指示落点从主面板右下角迁至「待办」列「+ 创建」按钮内。

## Capabilities

### New Capabilities
<!-- 无新增能力 -->

### Modified Capabilities
- `decompose-ui`: 「新建需求入口」与「处理态隐藏与底栏『建卡中』」两个需求的行为变更——底栏右下角「建卡中」指示移除,状态改由「+ 创建」按钮承载全程(含审阅收起时的待审阅指示)。

## Impact

- 代码:`src/renderer/src/components/BoardColumn.tsx`(按钮按相位变形)、`src/renderer/src/components/NewRequirementFlow.tsx`(删 `CreatingCardsIndicator`)、可能 `KanbanBoard.tsx`/`App.tsx`(传相位到「待办」列)、`src/renderer/src/stores/newRequirement.ts`(注释/若需暴露相位)、i18n `zh.ts`/`en.ts`(新增待审阅文案)。
- 测试:`BoardColumn.test.tsx`、`NewRequirementFlow.test.tsx`、`App.test.tsx`。
- 无主进程/IPC 改动;无数据模型改动。
