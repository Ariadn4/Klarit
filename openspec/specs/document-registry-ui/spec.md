# document-registry-ui Specification

## Purpose
TBD - created by archiving change add-document-registry. Update Purpose after archive.
## Requirements
### Requirement: 两栏改判编辑器

系统 SHALL 提供文档登记表编辑器：**两栏**分别呈现 `dynamic` 与 `snapshot` 两桶（「不纳管」不设可见栏），条目区**各栏独立滚动**。每行行头含图标（文件/文件夹）、相对路径、**改判控件**（`⇄`，在两栏间切换该条 kind）、**移出控件**（`✕`，从表移除）。行**可展开**，展开区含：文件夹条目的**覆盖计数**（「覆盖 N 个文件」，**不列文件明细**——文件夹条目的重心是这一类怎么写，不是内部清单）、**可编辑的路径**（agent 分组不合意时用户手动改 location，如把 `openspec/changes/add-x` 收到 `openspec/changes`；改路径打回该条未审批）、`habitPrompt` 的可编辑文本框。**不设逐条审批开关**——审批由「确认并保存」承担（见下）。编辑器底部含**「添加文件/文件夹」**入口与**「文档公约」区**（编辑 `conventionPreamble`，同样无单独审批控件）。

UI MUST 遵 `docs/brand`：仅用语义令牌（`bg-canvas`/`bg-paper`/`text-ink`/`border-stone-*`/`*-cobalt-*` 等），深浅双主题均正确，不硬编码颜色。

#### Scenario: 两栏各呈一桶
- **WHEN** 登记表含 2 条 dynamic、3 条 snapshot
- **THEN** 左栏列出 2 条 dynamic、右栏列出 3 条 snapshot，无第三栏

#### Scenario: 改判把条目移到另一栏
- **WHEN** 用户点某 dynamic 行的 `⇄`
- **THEN** 该行 kind 变 snapshot 并移到右栏

#### Scenario: 移出后从两栏消失
- **WHEN** 用户点某行的 `✕`
- **THEN** 该行从当前栏消失（隐式不纳管），两栏均不再显示它

#### Scenario: 展开文件夹条目露覆盖计数与 prompt（不列明细）
- **WHEN** 用户展开一条文件夹级条目（覆盖 8 个文件）
- **THEN** 展开区显示「覆盖 8 个文件」计数、可编辑路径与该条 `habitPrompt` 编辑框；**不**逐个列出文件路径、不设审批开关

#### Scenario: 手动改路径收级
- **WHEN** 用户把一条 `openspec/changes/add-x` 条目的路径改为 `openspec/changes` 并应用
- **THEN** 该条 location 更新为 `openspec/changes`（该条回未审批草稿态）；与既有条目撞路径时不应用

#### Scenario: 添加逆操作
- **WHEN** 用户经「添加文件/文件夹」选一路径并指定桶
- **THEN** 它以对应 kind 进入该栏

### Requirement: onboarding 导入后接入文档扫描步骤

系统 SHALL 在导入项目流程之后接入一步文档分析与确认：导入完成后触发 agent 语义分析（分组+分类+起草一体）。**分析完成后统一推出**——分析期间确认步 MUST 只显示加载指示（扫描中提示 + 可跳过说明），MUST NOT 先展示启发式中间态再被 agent 结果整体替换；分析完成才把分类与 prompt 一并呈现（此时不再显示引导文案），用户可增删改判、改路径、编辑 prompt 与公约。

**审批 = 确认并保存**：点「确认并保存」MUST 把当前表**整表置为已审批**（各条 `approved:true` + `conventionApproved:true`）并落盘——不设逐条审批开关；点「跳过」则按当前**未审批**状态保存（留待设置里继续）。保存后再编辑某条 prompt/路径/公约仍会把对应审批打回草稿，直到下一次确认保存。

**加载与降级状态 MUST 可见**：从触发导入到确认步出现期间显示加载指示（导入/识别中）；分析失败（已配 agent 但调用失败/超时/输出不可解析）MUST 回落启发式结果并显示**如实的可读错误**（不得误报为「未配置 agent」），可重新分析；确无 agent 时立即呈现启发式结果并提示未配置。

#### Scenario: 导入后进入文档确认步
- **WHEN** 用户导入一个含 `docs/` 的项目
- **THEN** 扫描运行、结果以两栏编辑器呈现供审阅

#### Scenario: 管理窗导入（含移除后立刻重导入）即时进入确认步
- **WHEN** 用户在管理项目窗口导入一个新建项目（包括刚移除又立刻重导入、目标窗口已开且绑定同 id 的情形）
- **THEN** 主进程把「进文档确认步」推送给该项目的窗口，确认步**立即**出现——不依赖窗口重新绑定、不需要重启应用

#### Scenario: 导入过程显示加载指示
- **WHEN** 用户选完目录、导入/识别仍在进行
- **THEN** 界面显示加载指示，直到文档确认步（或错误）出现

#### Scenario: 分析完成前只显示加载指示（统一推出）
- **WHEN** agent 分析进行中
- **THEN** 确认步只显示加载指示，不出现任何中间分类；分析完成后分类与 prompt 一并出现

#### Scenario: 分析失败回落启发式并如实报错
- **WHEN** 已配置默认 agent，但分析调用失败（如超时）
- **THEN** 确认步呈现启发式兜底结果，并显示失败与原因摘要（不显示「未配置 agent」）；用户可触发重新分析

#### Scenario: 可跳过留待设置
- **WHEN** 用户在文档确认步选择跳过
- **THEN** 流程继续，登记表按当前（未审批）状态保存，之后可在设置里继续

#### Scenario: 确认并保存即整表审批
- **WHEN** 用户点「确认并保存」
- **THEN** 全部条目 `approved:true`、公约 `conventionApproved:true` 落盘——无需逐条点审批

### Requirement: 设置常驻文档登记表面板

系统 SHALL 在 `SettingsPanel` 提供常驻的文档登记表面板（`project-documents` section），复用同一两栏改判编辑器，允许随时手动调整登记表与公约、并触发重新扫描。

#### Scenario: 设置里编辑并落盘
- **WHEN** 用户在设置的文档面板改判某条并审批其 prompt
- **THEN** 变更持久化，onboarding 编辑器再打开时反映该变更

#### Scenario: 设置里触发重扫
- **WHEN** 用户在设置的文档面板触发重新扫描
- **THEN** 扫描运行并把新发现的文档并入（不覆盖用户已审批的既有条目）

