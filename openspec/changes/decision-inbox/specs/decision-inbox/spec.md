## ADDED Requirements

### Requirement: 收件箱是待决策的投影，不是独立真相源

系统 SHALL 为**当前项目**维护一个**决策收件箱**：一个条目对应一个**正等待用户拍板**的运行。收件箱 MUST 是 `RunBreakpoint.pendingDecision` 的**派生投影**——它 MUST NOT 自行持久化条目、MUST NOT 独立于断点增删条目。收件箱的内容恒等于「所有 `pendingDecision !== null` 的运行」。

投影按两条路径维护：

- **增量**：订阅既有 `onEngineProgress`。`kind='decision'` 事件 → upsert 该 `runId` 的条目；运行的 `pendingDecision` 被清空（决策已回应 / 运行转 `done`/`aborted`）→ 移除该条目。
- **重建**：进程启动与切换项目时，由 `run-store.list()` 全量重算，只取 `pendingDecision !== null` 者。

#### Scenario: 决策产生 → 条目出现

- **WHEN** 某运行抛出待决策（`onEngineProgress` 发出 `kind='decision'`）
- **THEN** 收件箱出现该 `runId` 的条目

#### Scenario: 决策被回应 → 条目消失

- **WHEN** 用户经 `decideRun` 回应了某运行的待决策，该运行的 `pendingDecision` 变为 null
- **THEN** 收件箱移除该 `runId` 的条目

#### Scenario: 运行被中止 → 条目消失

- **WHEN** 某运行停在待决策上时被用户中止（转 `aborted`）
- **THEN** 收件箱移除该 `runId` 的条目（不遗留幽灵条目）

#### Scenario: 重启后由断点重建

- **WHEN** 进程启动，run-store 中有 3 个运行、其中 2 个 `pendingDecision !== null`
- **THEN** 收件箱重建出且仅出这 2 个条目

### Requirement: 决策产生时刻随断点持久化

引擎置 `pendingDecision` 时 SHALL 一并记录该决策的产生时刻 `pendingSince`；清空 `pendingDecision` 时 MUST 一并清空 `pendingSince`。二者 MUST 同生共死，不得出现一有一无。

收件箱据 `pendingSince` 排序并计算「已等待时长」。断点缺 `pendingSince`（老数据）时，系统 MUST 回落到一个不阻断的次优来源（run-store 该运行的文件修改时刻）而非丢弃条目。

#### Scenario: 置决策时记录时刻

- **WHEN** 引擎为某运行置 `pendingDecision`
- **THEN** 同一断点上写入 `pendingSince`

#### Scenario: 清决策时一并清时刻

- **WHEN** 该待决策被回应、`pendingDecision` 置 null
- **THEN** `pendingSince` 一并被清空

#### Scenario: 老断点缺字段不阻断

- **WHEN** 重建时遇到 `pendingDecision !== null` 但无 `pendingSince` 的断点
- **THEN** 条目仍进收件箱，其等待时刻回落为该运行 run-store 文件的修改时刻

### Requirement: 收件箱条目的结构与排序

一条收件箱条目 SHALL 至少含：`runId`、所属需求卡 `cardId` 与卡名、决策来源 `source`、决策标题的 `titleKey` 与 `titleParams`、`pendingSince`、以及派生的 `gateKind`。

`gateKind` MUST 由 `EngineDecision.source` 派生，且**只有两类**：

- `review` —— `source` 以 `:manual-gate` 结尾（流程正常走到用户面前，等验收）
- `failure` —— 其余（异常升级，等用户选怎么办）

条目文案 MUST 复用既有决策 i18n key 机制（渲染层按当前语言翻译 `titleKey` + `titleParams`），收件箱 MUST NOT 另立一套决策文案。

收件箱列表 SHALL 按 `pendingSince` **升序**排列——等最久的在最上。

#### Scenario: 人工门决策派生 review

- **WHEN** 决策的 `source` 为 `<nodeId>:manual-gate`
- **THEN** 条目的 `gateKind` 为 `review`

#### Scenario: 失败升级决策派生 failure

- **WHEN** 决策的 `source` 为 `<nodeId>:<outcome>`（非 manual-gate）
- **THEN** 条目的 `gateKind` 为 `failure`

#### Scenario: 等最久的排最前

- **WHEN** 收件箱有三条条目，`pendingSince` 分别为 t3 > t2 > t1
- **THEN** 列表顺序为 t1、t2、t3

### Requirement: 外壳收件箱入口与未读计数

应用外壳 SHALL 提供一个**收件箱入口**，其上 MUST 显示当前待处理条目数的徽标；条目数为 0 时 MUST NOT 显示徽标（不显示「0」）。点击入口展开收件箱列表。

列表每条 SHALL 展示：卡名、按 `gateKind` 区分的类型标识、翻译后的决策标题、已等待时长。列表为空时 MUST 给出空态提示，而非空白面板。

#### Scenario: 有待办时显示计数

- **WHEN** 收件箱有 2 个条目
- **THEN** 入口徽标显示 2

#### Scenario: 无待办时不显示徽标

- **WHEN** 收件箱无条目
- **THEN** 入口不显示徽标，展开后显示空态提示

### Requirement: 收件箱只导航、不回应决策

点击一条收件箱条目 SHALL 打开其 `cardId` 对应的需求卡详情并**聚焦到该卡的决策面板**。

收件箱 MUST NOT 提供回应决策的操作（不放选项按钮、不放填空、不放人工门动作按钮）。回应决策的唯一入口仍是卡详情内的决策面板（见 `requirement-card-detail`「单卡决策在详情面板内呈现」），以免出现两套能力不等价的决策 UI。

#### Scenario: 点条目跳到卡并聚焦决策

- **WHEN** 用户点击一条收件箱条目
- **THEN** 系统打开该条目 `cardId` 的卡详情，并聚焦其决策面板

#### Scenario: 收件箱内不含回应控件

- **WHEN** 收件箱列表渲染任一条目
- **THEN** 该条目上不存在回应决策的选项/填空/动作按钮

### Requirement: 应用未聚焦时的桌面通知

当一条**新**条目进入收件箱**且**应用窗口未聚焦时，系统 SHALL 发一条桌面通知，含卡名与翻译后的决策标题。点击该通知 MUST 聚焦应用窗口并跳到对应卡（与点击收件箱条目同一行为）。

通知 MUST 只为**新增**条目触发：条目移除 MUST NOT 发通知；投影**重建**产生的存量条目 MUST NOT 发通知（否则每次开机糊一脸）。应用窗口处于聚焦态时 MUST NOT 发通知。

该通知 SHALL 可在设置中关闭，默认开启。

#### Scenario: 未聚焦时新决策发通知

- **WHEN** 应用窗口未聚焦，某运行抛出新的待决策
- **THEN** 发出一条含卡名与决策标题的桌面通知

#### Scenario: 聚焦时不打扰

- **WHEN** 应用窗口处于聚焦态，某运行抛出新的待决策
- **THEN** 不发桌面通知（条目照常进收件箱）

#### Scenario: 重建的存量条目不发通知

- **WHEN** 进程启动，重建出 2 条存量待决策条目
- **THEN** 不发任何桌面通知

#### Scenario: 通知开关关闭后不发

- **WHEN** 用户在设置中关闭了决策通知，随后应用未聚焦时产生新待决策
- **THEN** 不发桌面通知（条目照常进收件箱、徽标照常计数）
