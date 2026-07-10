## Context

新建需求流程状态在 `useNewRequirementStore`(`phase: 'idle' | 'describing' | 'processing' | 'reviewing'`,`windowOpen`)。当前:
- 「+ 创建」按钮在 `BoardColumn.tsx`,`onCreate` 一路从 `App.tsx → KanbanBoard.tsx → BoardColumn.tsx` prop-drill 下来,回调即 `openEntry()`。
- 「建卡中」由 `NewRequirementFlow.tsx` 的 `CreatingCardsIndicator` 渲染,绝对定位钉在 `<main>` 右下角,仅 `phase === 'processing'` 出现。

关键已有语义:`openEntry()` 对**任何非 idle 相位**只重开浮窗、不重启分解(`newRequirement.ts:56`)。所以「点击按钮 = 重开对应浮窗」这一行为**已经成立**,本次只是让按钮的**外观**跟着相位走,并删掉那颗独立浮标。

## Goals / Non-Goals

**Goals:**
- 「+ 创建」按钮按 `phase` 变形,承载全程状态(idle / describing / processing / reviewing)。
- 删除 `CreatingCardsIndicator`,右下角不再有独立「建卡中」浮标。
- 审阅窗收起后按钮显示待审阅张数,补上「收起审阅无指示」的盲区。
- 仅用语义令牌、深浅双主题,遵守品牌规范。

**Non-Goals:**
- 不改分解逻辑、IPC、数据模型、store 的状态机(相位与 `openEntry` 语义不变)。
- 不改描述窗/处理窗/审阅窗三个浮窗本体的构成。
- 不解决「待办」列横滚出视野后状态不可见——已明确接受该取舍。

## Decisions

### 决策 1:按钮改由 store 连接的组件承载,不再 prop-drill phase

把「+ 创建」按钮从 `BoardColumn` 里抽成一个独立的 store 连接组件(如 `CreateRequirementEntry`),直接 `useNewRequirementStore` 订阅 `phase`、`reviewCards.length` 与 `openEntry`,渲染在原按钮位置(「待办」列体底部)。

- **为什么**:若走 prop-drill,需把 `phase`/`reviewCardCount` 从 `App → KanbanBoard → BoardColumn` 层层传,`BoardColumn` 是纯展示列骨架,不该被流程状态污染。按钮本就只在 `todo` 列出现,单独连 store 更内聚。
- **BoardColumn 的接口**:保留 `onCreate?` 的位置语义,但把「渲染什么」交给注入内容——`KanbanBoard` 在 `todo` 列传入 `<CreateRequirementEntry />` 作为该位置节点(或 `BoardColumn` 直接在 `isTodo` 时渲染它)。倾向前者:`BoardColumn` 只管布局槽位,不 import 流程组件。
- **备选**:prop-drill phase——否决,污染中间层且 `KanbanBoard` 无需知道流程相位。

### 决策 2:onClick 全相位统一为 openEntry(),按钮只变外观

无论何相位,点击都调 `openEntry()`——idle 开描述窗,非 idle 重开对应浮窗。processing 相「不发起新分解」由 `openEntry` 现有守卫保证,无需在按钮层加分支。按钮不 `disabled`(disabled 会挡掉「点击重开处理窗」),只是**外观**从「+ 创建」切到状态态。

### 决策 3:各相位外观(语义令牌)

| phase | 图标 | 文案 | 说明 |
|---|---|---|---|
| idle | `Plus` | `board.create`(+ 创建) | 现状,虚线边框 |
| describing(收起) | `Pencil` 类 | `newRequirement.editing`(编辑中) | 收起时才显示;窗开着时按钮态无所谓(窗盖住焦点) |
| processing | `Loader2` 转圈 | `newRequirement.creatingCards`(建卡中) | 复用既有 `creatingCards` 文案 |
| reviewing(收起) | 实心点/徽章 | `newRequirement.reviewPending`(N 张候选待审阅) | 新增文案,插值 count |

- 颜色沿用现按钮的 `text-cobalt-500` 系;活动态可用实线边框区别于 idle 虚线,但**不新增投影、不硬编码颜色**。
- 图标从 `lucide-react` 取(项目已用 `Plus`/`Loader2`/`Minus` 等)。

### 决策 4:i18n 新增键

`newRequirement.editing`、`newRequirement.reviewPending`(带 `{{count}}`)。`zh.ts` 与 `en.ts` 同步。`creatingCards` 复用。

## Risks / Trade-offs

- [状态随「待办」列横滚出视野,不再全局可见] → 已与用户确认接受:待办是最左书挡列一般可见,且状态语义属于「新建」。
- [describing 相「编辑中」态仅在收起时有意义;窗开着时按钮被浮窗盖住] → 只在 `!windowOpen && phase==='describing'` 显示「编辑中」,窗开时按钮回落 idle 外观即可(不影响功能,点击仍重开)。
- [`CreatingCardsIndicator` 删除后,其 z-index/定位若被别处依赖] → 全仓 grep 确认仅 `NewRequirementFlow.tsx` 内部使用,`UnboundNotice` 独立保留。
- [测试断言旧「底栏建卡中」DOM] → `NewRequirementFlow.test.tsx`/`App.test.tsx` 需改为断言按钮态;先红后绿。

## Migration Plan

纯渲染层重构,无数据迁移。改动后 `npm run test:run` + `npm run typecheck`;`test:e2e` 若覆盖建卡流程需 `card-board.spec.ts` 同步(先 build 再跑)。回滚即还原三处组件与 i18n。
