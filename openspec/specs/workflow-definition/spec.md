# workflow-definition Specification

## Purpose
定义工作流的数据模型与「包目录」持久化：阶段（看板列）+ 有序节点列表，节点的执行者（agent/engine/command/subworkflow）、agent 驱动指令的三种形态（inline / file / installed）、产出/可写范围/门，以及以 `userData/workflows/<id>/` 包目录（`workflow.yaml` + skill 文件）的读写、校验与内置默认种子。
## Requirements
### Requirement: 工作流定义数据模型

系统 SHALL 以一份结构化定义表达一个工作流，对齐 `docs/project-goals.md`「工作流与节点」。一个工作流定义 MUST 含：唯一 id、可编辑显示名、可选描述、有序的**阶段**列表（每个阶段是一个看板列，仅含 id 与名称）、以及一个**有序的节点列表**。v1 工作流为**线性（单线）**——节点列表的顺序即执行顺序，不声明节点间依赖、不构成 DAG。每个节点通过 `stageId` **归属到一个阶段**（看板列），而非内嵌在阶段下。

工作流里**面向用户的文本字段**——工作流显示名、描述、阶段名、节点名——MUST 表示为**逐字段语言表**（`Localized`，见 `rule-pack-localization`），承载可选的多语言译文，消费时按当前语言用 `resolveLocalized` 解析为单语言（回退：当前语言→英语→仅有的语言）。**标识符/结构字段**——节点 id、`stageId`、执行者 `operation`/`command`/`workflowId`、产出/引用 `ref`、各类路径、以及只喂 AI 的 agent inline/file 指令内容——MUST 保持**单值**、跨语言逐字相同，不参与按语言解析。

每个**节点** MUST 含且只含一个**执行者**，类型为 `agent` / `engine` / `command` / `subworkflow` 四选一；并含：驱动指令（agent: prompt/skill，及可选执行配置见「agent 执行配置」；engine: 从引擎内置操作集择一；command: 命令行；subworkflow: 被调工作流引用）、0~N 个**产出**声明（每个含目的地、可选模板、必选/可选；v1 目的地为相对分支目录的 markdown 文件，详见「产出的目的地与模板」）、可选的**可写范围**（缺省/空表示整条工作分支可写）、可选的**门**（有序门把序列，门把分自动校验与人工评审两类，各自结构详见「门把的结构化模型」）。

#### Scenario: 完整工作流定义可被表达
- **WHEN** 构造一个含 id、显示名、若干阶段、若干节点（各以 stageId 归属某阶段、含产出与门把）的工作流定义
- **THEN** 该定义可被完整保存与读回，节点顺序、归属阶段、执行者类型、驱动指令、产出（目的地/模板/必选）、门把（含命令、目标、动作按钮）与 agent 执行配置均保持

#### Scenario: 显示文本承载语言表、结构字段保持单值
- **WHEN** 一个工作流的名称/阶段名/节点名以语言表承载多语言，而节点 id / stageId / operation / 命令 / 路径为单值
- **THEN** 保存读回后语言表各语言条目保持，结构字段仍为单值且跨语言逐字相同

#### Scenario: 节点恰有一个执行者
- **WHEN** 校验一个节点
- **THEN** 该节点 MUST 声明且仅声明四类执行者中的一种；缺失或多于一个均判为非法

#### Scenario: 节点必须归属有效阶段
- **WHEN** 某节点的 `stageId` 为空或未引用定义中任一阶段
- **THEN** 校验失败、定义不被保存

#### Scenario: 线性顺序由节点列表表达
- **WHEN** 读取工作流的节点
- **THEN** 节点以有序列表返回，列表次序即其执行次序，无需依赖声明

### Requirement: 工作流以「包目录」持久化

系统 SHALL 把每个工作流持久化为 Klarit 管理数据目录下的一个**包目录** `userData/workflows/<id>/`，**不入 git**。包内 MUST 含定义文件 `workflow.yaml`，并可含被 `file` 形态驱动指令引用的 skill markdown 文件（相对包路径）。**工作流包是存储、克隆、删除、导入、导出与（将来）云同步的整体单位**——同步搬整包、引用永不断链。

`workflow.yaml` MUST 是对外开放的格式：读入合法 YAML 得到等价定义，导出得到可被再次读入的等价表示（往返一致）。读取损坏或非法的包 MUST 不使应用崩溃，而是跳过该包并可上报。

#### Scenario: 保存写出包目录
- **WHEN** 保存一个工作流
- **THEN** 系统在 `userData/workflows/<id>/workflow.yaml` 写出定义，其引用的 skill 文件存于同一包内

#### Scenario: 读写往返一致
- **WHEN** 把一个工作流定义导出再读回
- **THEN** 读回的定义与原定义等价（字段无丢失、节点顺序不变）

#### Scenario: 损坏包不致崩溃
- **WHEN** `userData/workflows/` 下存在无法解析或结构非法的包
- **THEN** 系统跳过该包、其余工作流仍正常载入，不抛未捕获异常

### Requirement: 工作流定义校验

系统 SHALL 在保存或导入工作流定义前校验其结构：id 非空且在库内唯一、显示名非空、每个节点恰有一个合法执行者、可写范围（若声明）为合规相对路径（禁绝对路径、禁 `..` 逃逸）。

校验 MUST 另行覆盖产出、门把与 agent 执行配置的结构化字段：

- 产出目的地为 `file` 时，其 path MUST 是相对分支目录路径（禁绝对路径、禁 `..`）且 v1 MUST 以 `.md` 结尾（产出即 markdown）。
- 产出的**模板**若为 `file` 形态，其路径 MUST 是包内合规相对路径（禁绝对路径、禁 `..`），同 agent 驱动指令的 file 路径约束。
- 每道**自动校验**门把 MUST 含非空**校验命令**；若声明**校验目标**，每个目标 MUST 指向本节点某个已声明产出的路径。
- 每个**人工评审**门把声明的每个**动作按钮** MUST 含非空名称与非空命令。
- agent 执行配置（若声明）各字段为可空字符串；本能力不校验工具/模型是否真实可用（属引擎运行期）。

校验失败 MUST 阻止写入并返回可读的失败原因。

#### Scenario: 非法产出路径被拒
- **WHEN** 某产出 file 目的地的路径为绝对路径或含 `..`
- **THEN** 校验失败，定义不被保存，并返回指明该路径非法的原因

#### Scenario: 非 markdown 产出路径被拒
- **WHEN** 某产出 file 目的地的路径不以 `.md` 结尾
- **THEN** 校验失败，定义不被保存，并返回指明 v1 产出须为 markdown 的原因

#### Scenario: 自动校验门把缺命令被拒
- **WHEN** 某自动校验门把的校验命令为空
- **THEN** 校验失败，定义不被保存，并返回指明该门把缺命令的原因

#### Scenario: 人工评审动作按钮缺命令被拒
- **WHEN** 某人工评审门把的某个动作按钮缺名称或缺绑定命令
- **THEN** 校验失败，定义不被保存，并返回指明该动作按钮非法的原因

#### Scenario: 合法定义通过校验
- **WHEN** 一个所有字段均合规的工作流定义被保存
- **THEN** 校验通过并写入 YAML 文件

### Requirement: 内置默认工作流种子

系统 SHALL 在工作流库为空且应用初始化工作流能力时,写入**三个**合法的内置默认工作流,使库非空。三者前半段共用(建分支 → 开 worktree → 关联环境 → 一个实现占位节点),交付段不同:

- **本地直合**:交付段为 合并 → 推送主干 → 删 worktree → 删本地分支。
- **PR 模式**(既有,本地评审门):交付段为 推送需求分支(其上挂一道人工评审门)→ 合并 → 推送主干 → 删云端分支 → 删 worktree → 删本地分支——评审在本地门点一下,合并仍由 Klarit 施加。
- **真 PR**(本 change 新增):交付段为 推送需求分支 → `open-pr`(在平台开 PR/MR,**其上挂一道外部门** `verify: 'pr-merged'`)→ 删 worktree → 删本地分支。此工作流**不含 `merge-branch`**——合并在平台上发生(外部门等它合了才过门收尾),不由 Klarit 施加;云端分支由平台「合并后自动删分支」清掉。

三个默认工作流 MUST 各自通过结构校验与分支配对语义校验(均含 `create-branch` 与 `delete-branch`)。

#### Scenario: 空库时种入三个默认工作流
- **WHEN** 工作流库为空且应用初始化工作流能力
- **THEN** 系统写入「本地直合」「PR 模式」「真 PR」三个合法的内置默认工作流,使库非空

#### Scenario: 三个默认工作流均通过分支配对校验
- **WHEN** 校验种入的三个默认工作流
- **THEN** 三者均含 `create-branch` 与 `delete-branch`,分支配对校验均通过

#### Scenario: 真 PR 工作流以外部门等合并、不含本地合并
- **WHEN** 检视「真 PR」默认工作流
- **THEN** 其 `open-pr` 节点挂一道 `external`(`verify: 'pr-merged'`)门、**不含** `merge-branch` 节点,合并交由平台完成

#### Scenario: 已有工作流时不重复种入
- **WHEN** 工作流库已非空时再次初始化工作流能力
- **THEN** 系统不重复种入默认工作流,既有包不被覆盖

### Requirement: 内置默认工作流按双语种子并对旧单语言定义向后兼容

内置默认工作流（本地直合、PR 模式）的**可翻字段**（工作流名/描述、阶段名、节点名）MUST 至少提供 `zh` 与 `en` 两种语言的等价文案；不同语言下节点 id、`stageId`、引擎 `operation`、命令等**结构字段 MUST 逐字相同**，只有显示文案不同。读入 `workflow.yaml` 时，遇到旧的**裸字符串**名称字段 MUST 归一为语言表（`{ zh: 值 }`），使旧单语言工作流不崩、显示为该语言。

#### Scenario: 默认工作流双语且结构一致
- **WHEN** 取内置默认工作流并分别按 `zh`、`en` 解析
- **THEN** 阶段与节点的数量/顺序、各节点 id 与引擎 operation 逐字相同，仅名称/描述随语言不同

#### Scenario: 旧单语言定义读入不崩
- **WHEN** 读入一个 `name` 为裸字符串（旧格式）的 `workflow.yaml`
- **THEN** 归一为 `{ zh: 原字符串 }`，工作流正常载入并在界面显示该名称，不抛未捕获异常

### Requirement: 产出的目的地与模板

每个声明式产出 SHALL 以「**目的地** + 可选**模板** + **必选/可选**」表达。产出的**标识与文件类型由目的地承载**，不单列名称或文件格式字段。

- **目的地** SHALL 为一个**带 kind 的判别联合**。v1 仅支持 `file` 形态：`{ kind:'file', path }`——path 为相对分支目录路径（禁绝对路径、禁 `..`）且以 `.md` 结尾；**文件名即产出标识、扩展名即文件类型**，故无需另设名称/格式字段。
- **卡片数据目的地**（无路径、写入需求卡某模块）暂不在 v1 范围：需求卡数据模型尚未建立，无从指向卡片哪个模块。待其落地后以**新增一个 kind 形态**引入，判别联合保证该扩展为非破坏增量。
- **模板** 声明该产出文件应有的**结构**（必需的标题/章节等），对齐 OpenSpec 以 markdown 模板规定产出格式的做法，供基线门把客观校验「符合格式」。模板内容**统一住在规则库**（单一来源），故模板 SHALL 以带 kind 的判别联合表达两态：
  - `none`（不声明）；
  - **`ref`（引用规则库里的一个 `output-template` 条目，按全限定 `{packId, itemId}`）**——见 `rule-pack-model`。
  工作流**不内嵌模板文本**（无 inline/file 嵌入形态）；编辑期的「手写新建」是把内容**写进规则库再引用**（见 `workflow-editor`）。
- `ref` 形态的校验只要求**引用 id 非空**；引用的条目在某机器上是否真实存在**不在工作流校验内强制**（规则包可能在另一台机器后补/后导入），由解析期按缺失处理并上报，不阻塞保存——与「agent 执行配置不校验工具真实可用」同理。

#### Scenario: 产出以文件路径标识
- **WHEN** 某产出声明 `file` 目的地 `docs/change/spec.md`
- **THEN** 该路径即同时承载产出标识（文件名）与文件类型（`.md`），定义不含独立的名称/格式字段

#### Scenario: 模板只「不声明」或「引用规则库条目」
- **WHEN** 某产出的模板为 `none`，或以 `ref` 引用规则库的一个 `output-template` 条目
- **THEN** 定义按所选形态保留（none / ref 的 `{packId,itemId}`）；`ref` 仅要求条目 id 非空、不强制条目存在；工作流定义不含内嵌模板文本

#### Scenario: 不声明模板
- **WHEN** 某产出未声明模板
- **THEN** 其模板为 `none` 形态，产出仍可被保存与读回

#### Scenario: 引用形态不因条目暂缺而阻塞保存
- **WHEN** 某产出模板为 `ref` 但其引用的规则库条目在本机尚不存在
- **THEN** 校验仍通过（id 非空即可），缺失在解析/执行期按缺失处理并上报，不阻塞工作流保存

### Requirement: 门把的结构化模型

门 SHALL 为一个**有序门把序列**，门把分**自动校验 / 人工评审 / 外部门**三类，各按类型携带可执行字段，**均不带「说明」字段**（命令/按钮/核查本身即自描述）：

- **自动校验** MUST 携带一个**校验**，其形态为带 kind 的判别联合：**`inline`**（裸命令字符串，退出码即通过/失败）或 **`ref`**（引用规则库里的一个 `objective-check` 条目，按条目 id——见 `rule-pack-model`）。并可选携带**校验目标**——一组指向本节点已声明产出路径的标识，表示该门把校验哪些产出；不声明目标则视为对本节点整体检查。（引擎自动追加的「必选产出齐全且符合格式」基线门把不在本能力的用户可编辑范围内。）
- **人工评审** MAY 声明零或多个**动作按钮**，每个绑定一个 `{ 名称, 命令 }`；声明的按钮在该门把抛出决策时被渲染并可触发其命令（如验收时「启动 app」按钮跑 `npm start`），不声明则不渲染按钮。
- **外部门（`external`）** MUST 携带一个**外部核查种类** `verify`（v1 取 `pr-merged`），表示它等待哪种 **Klarit 控制不了的外部状态**达成；**不带命令/按钮**。它进门核查该外部状态：达成则过门，未达成则挂起等待（现由用户点「开始收尾」触发再核查、将来 MAY 由平台 webhook 等外部信号触发）；其**打回**（自由输入写下不满意的点）复用人工评审门的内容驱动回退（详见 `engine-execution`「引擎执行外部门」与 `content-driven-rollback`）。

门把携带的命令为待执行的 CLI 命令字符串，不施加产出/可写范围那样的相对路径约束。`inline` 校验要求命令非空；`ref` 校验要求条目 id 非空。外部门要求 `verify` 取受支持的核查种类（v1：`pr-merged`）。

#### Scenario: 自动校验门把以裸命令或引用条目
- **WHEN** 声明一道自动校验门把，校验取 `inline`（裸命令）或 `ref`（规则库 `objective-check` 条目 id），并可选指定一个或多个校验目标
- **THEN** 校验形态与目标随门把保存与读回；`inline` 命令非空、`ref` 条目 id 非空；目标为空时表示对本节点整体检查

#### Scenario: 人工评审门把声明动作按钮
- **WHEN** 为一道人工评审门把声明零或多个动作按钮（各含名称与命令）
- **THEN** 这些按钮随门把保存；声明非空时其名称与命令被保留，供抛出决策时渲染

#### Scenario: 外部门把携带核查种类
- **WHEN** 声明一道外部门把，`verify` 取 `pr-merged`
- **THEN** 该门把以 `kind: 'external'` + `verify: 'pr-merged'` 保存与读回；`verify` 为空或取不支持的值判为非法

### Requirement: agent 执行配置

`agent` 执行者 MAY 携带一份可选**执行配置**，声明本节点用哪个**编程工具**（adapter）、哪个**模型**、以及**额外参数**：`{ 工具?, 模型?, 额外参数? }`，各字段均可空。配置 SHALL 为**声明式**——记录工具/模型标识而非裸启动命令，使工作流可移植、可分享。

执行配置的生效遵循**两层级联**：**全局设置 < 节点声明**。节点未声明某字段即跟随全局设置；**不存在「工作流默认」层**。工具/模型的可选标识来源由引擎的编程工具/agent 扫描提供，本能力只负责存储与往返，不校验其在某机器上是否真实可用（属引擎运行期）。

#### Scenario: 声明工具与模型往返保持
- **WHEN** 某 agent 节点声明执行配置的工具/模型/额外参数并保存后读回
- **THEN** 这些字段完整保留在定义中

#### Scenario: 不声明执行配置时跟随全局
- **WHEN** 某 agent 节点未声明执行配置（或其某字段为空）
- **THEN** 该节点（该字段）跟随全局设置，定义仍可被保存与读回，不因缺省判为非法

### Requirement: 工作流分支配对的语义校验

系统 SHALL 对工作流施加一条**分支配对语义校验**:若工作流的节点中存在 `engine` 执行者操作为 `create-branch`(建分支),则 MUST 至少存在一个**删本地分支**的节点——即操作为 `delete-branch`,**或**复合别名 `delete-branch-worktree`;否则该工作流判为**无效**(分支会被泄漏)。本校验只约束「建了分支必须有删分支」单一方向,不要求顺序、不要求一一计数配对、不约束反向情形。

本校验是**语义校验**,与结构校验分属两层:结构校验失败的包视为损坏、载入时跳过;分支配对失败的工作流仍可载入/列出/展示,但 MUST 被标记为「无效」并在保存与激活两处被拦截。无效原因由工作流列表项摘要承载。

#### Scenario: 建分支无删分支判为无效
- **WHEN** 一个工作流含 `create-branch` 节点但既无 `delete-branch` 也无 `delete-branch-worktree` 节点
- **THEN** 分支配对校验判为无效,并给出可读原因(建了分支却没有对应的删分支节点)

#### Scenario: 建分支且有删本地分支判为有效
- **WHEN** 一个工作流同时含 `create-branch` 与 `delete-branch`(或复合别名 `delete-branch-worktree`)节点
- **THEN** 分支配对校验通过

#### Scenario: 既不建分支也不删分支判为有效
- **WHEN** 一个工作流不含任何 `create-branch` 节点
- **THEN** 分支配对校验通过(无分支可泄漏),不因缺少删分支判为无效

### Requirement: 工作流列表项摘要携带无效原因

工作流列表项摘要（供库列表与项目选择器使用）SHALL 在其结构上携带一个**可选的无效原因**：当且仅当该工作流未通过分支配对语义校验时，摘要带有非空的无效原因文本；通过校验时不带该字段。该字段是 UI 标示「（无效）」与禁用选择的单一数据来源；其增加为**向后兼容的可选扩展**，不破坏既有摘要消费方。

#### Scenario: 有效工作流摘要不带无效原因
- **WHEN** 为一个分支配对校验通过的工作流构造列表摘要
- **THEN** 摘要含 id 与显示名，且不含无效原因字段

#### Scenario: 无效工作流摘要带出无效原因
- **WHEN** 为一个分支配对校验不通过的工作流构造列表摘要
- **THEN** 摘要含 id、显示名与一段可读的无效原因文本

### Requirement: 工作流保存拦截无效分支配对

工作流编辑器在用户点击「保存」时 SHALL 先做分支配对语义校验：若不通过，MUST **弹出模态提示**说明无效原因，并**拒绝保存**（不向存储层写盘）。该拦截在既有结构校验之外另行施加；结构校验仍先行，二者任一不过都不保存。

#### Scenario: 分支配对不过则弹窗并拒绝保存
- **WHEN** 用户在编辑器中点击保存，而当前定义有 `create-branch` 却无 `delete-branch-worktree`
- **THEN** 弹出模态提示说明「建了分支却没有删分支」，且不调用保存、定义不写盘

#### Scenario: 分支配对通过则正常保存
- **WHEN** 用户点击保存，且定义通过分支配对校验与结构校验
- **THEN** 不弹出该提示，定义按既有流程写盘

### Requirement: 项目选择器禁用无效工作流

项目「激活工作流」选择器 SHALL 对未通过分支配对语义校验的工作流：在其条目上展示「（无效）」标示，并使该选项**不可被选择/激活**（禁用）。有效工作流的选择与激活行为不变。若当前已激活的工作流变为无效，选择器 MUST 仍把它标示为「（无效）」以使状态可见。

#### Scenario: 无效工作流不可激活
- **WHEN** 选择器中某工作流摘要带有无效原因
- **THEN** 其条目显示「（无效）」且被禁用，点击不触发激活

#### Scenario: 有效工作流仍可正常激活
- **WHEN** 选择器中某工作流摘要不带无效原因
- **THEN** 其条目可被选择，点击即激活并持久化

### Requirement: 工作流库列表标示无效工作流

全局「工作流库」列表 SHALL 对未通过分支配对语义校验的工作流，在其名称旁展示「（无效）」标示并可见其原因，使用户能定位并进入编辑修复。该标示不阻止对该工作流的编辑、克隆或删除操作。

#### Scenario: 库列表标示无效工作流
- **WHEN** 库列表渲染一个带无效原因的工作流摘要
- **THEN** 该列表项在名称旁显示「（无效）」标示，并可见无效原因，且其编辑/克隆/删除入口仍可用

### Requirement: 工作流的「新建需求」分解指令

工作流定义 SHALL 可携带一份**可选的「新建需求」驱动指令**，用于把用户对该工作流提交的一大段自由描述分解成多张需求卡（见 `requirement-decomposition`）。该指令 MUST 沿用 `agent` 节点驱动指令的**带 kind 判别联合**两态：

- `inline`：分解 prompt 文本内联存于工作流定义中（自包含、可移植）。
- `file`：指向工作流包内一份 skill/prompt markdown 文件的**相对包路径**（禁绝对路径、禁 `..`，被引用文件物理位于包内，同节点 file 指令的约束）。

该字段为**可选**：未声明时该工作流不提供专属分解 prompt（分解回落到全局默认分解 skill，见 `requirement-decomposition`）。声明时其形态校验 MUST 与 agent 节点驱动指令一致：`inline` 要求文本为字符串、`file` 要求合规包内相对路径。本字段的增加为**向后兼容的可选扩展**，不破坏既有工作流的读写往返。

#### Scenario: 内联新建需求 prompt 往返保持
- **WHEN** 某工作流以 `inline` 形态声明「新建需求」prompt 文本并保存后读回
- **THEN** 该 prompt 文本完整保留在定义中

#### Scenario: 文件形态新建需求 prompt 存为包内相对路径
- **WHEN** 某工作流以 `file` 形态为「新建需求」指令引用一份包内 skill 文件
- **THEN** 定义保存相对包路径、该文件位于包内；若路径为绝对路径或含 `..`，校验失败、不被保存

#### Scenario: 未声明新建需求指令仍合法
- **WHEN** 某工作流未声明「新建需求」指令并保存
- **THEN** 定义合法、可读回，不因缺省该可选字段判为非法

#### Scenario: 非法新建需求指令被拒
- **WHEN** 某工作流的「新建需求」指令形态非法（既非合法 inline 也非合法 file）
- **THEN** 结构校验失败、定义不被保存，并返回可读原因

### Requirement: 工作流声明建议类型

工作流定义 MAY 含一个可选字段 **`suggestedTypes`**：一组**建议的需求卡类型**（每项形如 `card-type-registry` 的 `CardTypeDef`，`container` 与 `leaf` 原型皆可——工作流可带自己的容器与流通类型），表达"用这条工作流的项目通常需要哪些类型"。该字段 MUST 为可选——未声明的工作流（含旧工作流包）照常加载、行为不变（迁移幂等）。项目激活该工作流时，引擎据此把建议类型**播种**进项目类型注册表（幂等、不覆盖已有，见 `card-type-registry`「工作流激活播种建议类型」）。内置默认工作流 SHALL 自带默认类型（epic/feature/bug）作为 `suggestedTypes`。

#### Scenario: 工作流声明建议类型（含容器与子叶）
- **WHEN** 一个工作流定义声明了 `suggestedTypes`（含 container 与 leaf 类型）并被读回
- **THEN** 该字段完整保留，每项类型定义（含其 archetype）不变

#### Scenario: 未声明建议类型的工作流照常加载
- **WHEN** 加载一个不含 `suggestedTypes` 的工作流（如旧工作流包）
- **THEN** 工作流正常加载、校验通过，行为与未引入该字段时一致

#### Scenario: 默认工作流自带默认类型
- **WHEN** 读取内置默认工作流
- **THEN** 其 `suggestedTypes` 含 epic/feature/bug，激活时把它们播种进项目

### Requirement: 引擎内置操作的能力声明

引擎内置操作集 SHALL 是一个**封闭操作集**,且每个操作 MUST 携带一份**能力声明**,声明该操作是否:**产出**文档(`producesOutputs`)、可挂**门**(`supportsGate`)、需要**可写范围**(`supportsWritableScope`)。该能力声明是 UI 决定节点设置块显隐(见 `workflow-editor`)与引擎执行的**单一来源**,main 与 renderer 共享同一份。

封闭操作集由 8 项**扩为 9 项**:`create-branch`(建分支)、`open-worktree`(开 worktree)、`link-env`(关联环境)、`merge-branch`(合并)、`push-branch`(推送)、`remove-worktree`(删 worktree)、`delete-branch`(删本地分支)、`delete-remote-branch`(删云端分支)、`open-pr`(开 PR/MR)。原 `delete-branch-worktree` 作为**复合别名**仍被识别(执行期等价于 `remove-worktree` 后接 `delete-branch`),以保证既有种子包向后兼容。（「核查已合并」**不是**一个引擎操作,而是外部门的过门条件,见「门把的结构化模型」。）

「引擎操作」是**平台预制的现成节点**——对外统一是 engine 操作(下拉择一、可调参数),其**内部实现可由确定性 git/worktree/fs 动作、或委派 agent、或跑命令支撑**(见 `engine-execution`),是封装细节。除 `open-pr`(内部委派 agent 应对各家平台差异)外,其余操作均为确定性 git/worktree/fs 动作。能力声明 MUST 为:`producesOutputs` 与 `supportsWritableScope` **全部为否**(不交付文档、不写业务文件);`supportsGate` **`push-branch` 与 `open-pr` 为真**(前者推送后是天然人工评审点,后者是天然的「等平台合并」外部门 host),其余操作为否。

能力声明是 UI/校验侧的**元数据**,MUST NOT 写入工作流定义文件(`workflow.yaml`),不改变工作流定义的读写往返;引擎节点的产出/可写范围字段照旧为空。系统 SHALL 提供按操作查询其能力声明的纯函数;对未知/未选操作(含空字符串),查询 MUST 返回三项能力均为否、不抛异常。

#### Scenario: 九个引擎操作的能力声明
- **WHEN** 查询 `create-branch` / `open-worktree` / `link-env` / `merge-branch` / `remove-worktree` / `delete-branch` / `delete-remote-branch` 任一操作的能力声明
- **THEN** 其 `producesOutputs`、`supportsGate`、`supportsWritableScope` 均为否

#### Scenario: push-branch 与 open-pr 支持门把
- **WHEN** 查询 `push-branch` 或 `open-pr` 的能力声明
- **THEN** `producesOutputs`、`supportsWritableScope` 为否,而 `supportsGate` 为真(可在其上配置门——push 后人工评审、open-pr 后「等平台合并」外部门)

#### Scenario: 复合别名被识别
- **WHEN** 一个既有工作流节点的引擎操作为 `delete-branch-worktree`
- **THEN** 校验与引擎均识别之(等价于 `remove-worktree` 后接 `delete-branch`),不判为未知操作

#### Scenario: 新操作进入下拉且能力查询不抛
- **WHEN** 渲染层取引擎操作下拉列表
- **THEN** 列表含 `open-pr`(不含已废的复合别名);对 `open-pr` 查询能力声明返回 `supportsGate` 真、另两项否,不抛异常

#### Scenario: 未选/未知操作回落为无能力
- **WHEN** 查询空字符串或未知操作名的能力声明
- **THEN** 返回三项能力均为否,不抛异常(UI 显隐逻辑无须特判)

#### Scenario: 能力声明不进定义文件
- **WHEN** 保存并读回一个引擎节点
- **THEN** 其能力声明不出现在 `workflow.yaml` 里(仅 UI/校验侧元数据),定义读写往返不受影响

### Requirement: command 执行者声明一条或多条命令

`command` 执行者 SHALL 以 `commands: CommandSpec[]` 声明**一条或多条**待执行命令,每条 `CommandSpec` 为 `{ label?, command, check?, timeoutSec? }`:`command` 为待执行 CLI 命令字符串,`label` 为可选展示标签(缺省回落命令行文本,用于 UI 分格标题与转后台 label),`check`/`timeoutSec` 为该条命令各自的前置检查与超时(见对应要求)。

校验 SHALL:`commands` MUST 为**非空数组**(至少一条命令);每条 `command` 字符串 MUST **非空**;`label` 若声明可为任意非强制文本。命令是否在某机器上可成功执行**不在校验内强制**(属引擎运行期),命令串不施加产出/可写范围那样的相对路径约束。

**向后兼容**:既有工作流包的旧单命令形状(执行者直接带 `command`/`check`/`timeoutSec`)在反序列化时 SHALL 被归一为 `commands: [{ command, check?, timeoutSec? }]`;序列化写新形状。对新形状幂等。

#### Scenario: 声明多条命令往返保持
- **WHEN** 某 `command` 节点声明 `commands` 为两条(各含命令行、可选标签/前置检查/超时)并保存后读回
- **THEN** 两条命令及其字段完整保留在定义中

#### Scenario: 空命令列表被拒
- **WHEN** 某 `command` 节点的 `commands` 为空数组,或其中某条 `command` 字符串为空
- **THEN** 结构校验失败、定义不被保存,并返回指明命令为空的原因

#### Scenario: 旧单命令形状迁移归一
- **WHEN** 加载一个旧形状(执行者直接带 `command`,无 `commands`)的 `command` 节点工作流包
- **THEN** 该节点被归一为 `commands: [{ command, ... }]`,合法可读回,行为与单命令一致;再次保存写新形状

### Requirement: command 执行者的前置检查命令

`command` 执行者的**每条命令**(`commands[]` 中的 `CommandSpec`)SHALL 各支持一条可选**前置检查命令**(`check`):一个 CLI 命令字符串,表达「本条命令是否已完成」的探测(退出码 0=已完成)。该字段供引擎在执行该条主命令前做 reconcile-by-probe(见 `engine-execution`「命令节点的前置检查护栏」),让不幂等命令在中断恢复时不重复执行。每条命令 MAY 不声明该字段。

该字段为**可选**且为**向后兼容增量**:未声明 `check` 的命令(含既有工作流包迁移而来的命令)照常加载、行为不变、读写往返一致。声明时其结构校验为:`check` 命令字符串 MUST 非空(同 `inline` 客观门把命令的约束);命令是否在某机器上可成功执行**不在校验内强制**(属引擎运行期)。`check` 与主命令 `command` 一样为待执行的 CLI 串,不施加相对路径约束。

#### Scenario: 声明前置检查命令往返保持
- **WHEN** 某 `command` 节点某条命令声明 `check` 并保存后读回
- **THEN** 该条命令的 `check` 命令字符串完整保留在定义中

#### Scenario: 未声明前置检查的命令照常合法
- **WHEN** 加载/保存一条未声明 `check` 的命令(含既有工作流包)
- **THEN** 定义合法、可读回,行为与未引入该字段时一致

#### Scenario: 空前置检查命令被拒
- **WHEN** 某条命令声明了 `check` 但其命令字符串为空
- **THEN** 结构校验失败、定义不被保存,并返回指明 `check` 命令为空的原因

### Requirement: 每条命令的可选超时字段

工作流定义中**每一处被执行的命令** SHALL 支持一个可选**超时秒数**(`timeoutSec`):`command` 执行者 `commands[]` 中的**每条命令**、客观(`auto`)门把项、人工门把的动作按钮各可携带 `timeoutSec`。该字段为**可选**且为**向后兼容增量**——未声明即无超时(全局默认无超时),既有工作流包照常加载、读写往返一致。声明时其结构校验为:`timeoutSec` MUST 为**正数**(`> 0`);非正数或非数值判为非法。该超时为每条命令独立(同节点内不同命令、及客观门可设不同值),`ref` 形态客观门的超时落在**门把使用点**而非规则库条目。

#### Scenario: 声明超时往返保持
- **WHEN** 某命令节点某条命令(或客观门、动作)声明 `timeoutSec` 并保存后读回
- **THEN** 该超时值完整保留在定义中

#### Scenario: 未声明超时照常合法
- **WHEN** 加载/保存一处未声明 `timeoutSec` 的命令(含既有工作流包)
- **THEN** 定义合法、可读回,视为无超时,行为与未引入该字段时一致

#### Scenario: 非正数超时被拒
- **WHEN** 某处命令声明的 `timeoutSec` 为 0、负数或非数值
- **THEN** 结构校验失败、定义不被保存,并返回指明超时须为正数的原因

### Requirement: 工作流节点的目标仓选择字段

`WorkflowNode` SHALL 支持一个可选的 `target` 字段(目标仓选择,判别联合),取值为 `all` / `tag`(带 `tag`) / `repo`(带 `memberId`) / `fromUpstream`(带上游节点 id)四种之一。校验 SHALL:`tag` 形态的标签名非空;`repo` 形态的 `memberId` 非空;`fromUpstream` 形态引用的上游节点必须在本节点之前且为 agent 节点。`target` 缺省(未声明)合法,语义为「全体成员仓」。

#### Scenario: 合法 target 通过校验
- **WHEN** 一个引擎节点声明 `target={tag:'后端'}`
- **THEN** 工作流校验通过

#### Scenario: target 字段缺省合法
- **WHEN** 一个引擎节点未声明 `target`
- **THEN** 工作流校验通过,语义等价于全体成员仓

#### Scenario: fromUpstream 引用非 agent 或后置节点不通过
- **WHEN** 一个节点 `target=fromUpstream` 引用一个非 agent 节点,或引用一个排在其后的节点
- **THEN** 工作流校验失败并给出原因

### Requirement: agent 节点的结构化输出通道

agent 执行者 SHALL 除既有 markdown 文件产出外,支持声明一个**结构化输出**(至少含「涉及哪些成员仓」的判定),供下游 `target=fromUpstream` 节点消费。该结构化输出 MUST 可被引擎持久化进运行断点以保证恢复稳定。校验 SHALL 确保被 `fromUpstream` 引用的 agent 节点确有声明结构化输出。

#### Scenario: agent 节点声明结构化涉及仓输出
- **WHEN** 一个 agent 节点声明结构化输出含「涉及仓」字段
- **THEN** 校验通过,且其输出可被下游 `fromUpstream` 节点引用

#### Scenario: 被引用的 agent 节点未声明结构化输出
- **WHEN** 某 `fromUpstream` 节点引用的 agent 节点只产 markdown、未声明结构化输出
- **THEN** 工作流校验失败并给出原因

### Requirement: Agent 驱动指令的三种形态

`agent` 执行者的驱动指令 SHALL 以一个**带 kind 的判别联合**表达，支持三种形态：

- `inline`：prompt 文本**内联**存于工作流定义中（自包含、可移植）。
- `file`：指向一份 skill/prompt markdown 文件的**相对路径**，该路径**相对于工作流包目录**解析（禁绝对路径、禁 `..`，同产出路径的约束）。被引用的文件 MUST **物理位于工作流包内**（新建即写入包，导入即拷入包），使工作流自包含、随包整体搬运。这是「用户设进包的外部技能文件」。
- `installed`：引用用户的编程 CLI 里**已安装**的技能，以其**调用名**（`name`）标识（如 `opsx:explore`）。Klarit MUST NOT 嵌入其内容或指向本地路径——运行时由 CLI 自己按名调用该技能；`name` 非空即合规。这是「引用即用的已装技能」。

每个 agent 节点的驱动指令 MUST 恰为这三种形态之一。本能力存储 kind、（file 形态的）合规相对路径、（installed 形态的）非空调用名并参与校验，并保证 file 引用文件落在包内；**内容/技能在执行期的读取与调用不在本能力范围**，交由执行引擎定义（installed 形态：让 CLI 调该已装技能；无该机制的 CLI 回落把「请使用你已安装的 `<name>` 技能」并入 prompt）。

#### Scenario: 内联 prompt 往返保持

- **WHEN** 某 agent 节点以 `inline` 形态声明 prompt 文本并保存后读回
- **THEN** 该 prompt 文本完整保留在定义中

#### Scenario: 文件引用存为包内相对路径

- **WHEN** 某 agent 节点以 `file` 形态引用一份 skill 文件
- **THEN** 定义保存相对工作流包的路径、且该文件位于包内；若路径为绝对路径或含 `..`，校验失败、不被保存

#### Scenario: 已装技能存调用名、不嵌入内容

- **WHEN** 某 agent 节点以 `installed` 形态引用一个已装技能（给出调用名，如 `opsx:explore`）
- **THEN** 定义只保存该调用名，不嵌入技能内容、不带任何本地路径；空调用名校验失败、不被保存

#### Scenario: 旧包只含两形态不受影响

- **WHEN** 读一个只用 `inline`/`file` 的旧工作流包
- **THEN** 照常读回，判别联合扩展不破坏旧数据


### Requirement: 封闭引擎操作集含 archive-docs

封闭引擎操作集（`ENGINE_OPERATION_SPECS` / `ENGINE_OPERATIONS`，单一来源）SHALL 新增操作 `archive-docs`。它对外是引擎操作节点、内部委派 agent（同 `open-pr` 的分派范式）；它**不支持门**（门位为否）；它**产出文档写入**（与 `open-pr` 的"不产出、不提交"相反）。工作流数据模型的校验与迁移 MUST 识别 `archive-docs` 为合法引擎操作。

#### Scenario: archive-docs 是合法引擎操作
- **WHEN** 一个引擎节点的 `operation` 为 `archive-docs`
- **THEN** 校验通过，`ENGINE_OPERATIONS` 含之，下拉可选

#### Scenario: archive-docs 不支持门
- **WHEN** 查询 `archive-docs` 的引擎操作能力
- **THEN** 其门位为否（不可在其上挂门），产出位为是

#### Scenario: 旧包无 archive-docs 不受影响
- **WHEN** 加载一个不含 `archive-docs` 的既有工作流包
- **THEN** 加载与校验行为不变（纯增量）
