## MODIFIED Requirements

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
