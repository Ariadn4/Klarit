## MODIFIED Requirements

### Requirement: 引擎内置操作的能力声明

引擎内置操作集 SHALL 是一个**封闭操作集**,且每个操作 MUST 携带一份**能力声明**,声明该操作是否:**产出**文档(`producesOutputs`)、需要**检查/门**(`supportsGate`)、需要**可写范围**(`supportsWritableScope`)。该能力声明是 UI 决定节点设置块显隐(见 `workflow-editor`)与引擎执行的**单一来源**,main 与 renderer 共享同一份。

封闭操作集由 4 项**扩为 8 项**:`create-branch`(建分支)、`open-worktree`(开 worktree)、`link-env`(关联环境)、`merge-branch`(合并)、`push-branch`(推送)、`remove-worktree`(删 worktree)、`delete-branch`(删本地分支)、`delete-remote-branch`(删云端分支)。原 `delete-branch-worktree` 作为**复合别名**仍被识别(执行期等价于 `remove-worktree` 后接 `delete-branch`),以保证既有种子包向后兼容。

这些操作均为确定性 git/worktree/fs 动作,其能力声明 MUST 为:`producesOutputs` 与 `supportsWritableScope` **全部为否**(不交付文档、不写业务文件);`supportsGate` **仅 `push-branch` 为真**(推送后是天然的人工评审点),其余操作为否。

能力声明是 UI/校验侧的**元数据**,MUST NOT 写入工作流定义文件(`workflow.yaml`),不改变工作流定义的读写往返;引擎节点的产出/可写范围字段照旧为空。系统 SHALL 提供按操作查询其能力声明的纯函数;对未知/未选操作(含空字符串),查询 MUST 返回三项能力均为否、不抛异常。

#### Scenario: 八个引擎操作的能力声明
- **WHEN** 查询 `create-branch` / `open-worktree` / `link-env` / `merge-branch` / `remove-worktree` / `delete-branch` / `delete-remote-branch` 任一操作的能力声明
- **THEN** 其 `producesOutputs`、`supportsGate`、`supportsWritableScope` 均为否

#### Scenario: push-branch 支持门把
- **WHEN** 查询 `push-branch` 的能力声明
- **THEN** `producesOutputs`、`supportsWritableScope` 为否,而 `supportsGate` 为真(可在其上配置人工评审门)

#### Scenario: 复合别名被识别
- **WHEN** 一个既有工作流节点的引擎操作为 `delete-branch-worktree`
- **THEN** 该操作仍被视为合法的封闭集成员(复合别名),工作流照常加载与校验

#### Scenario: 未选/未知操作回落为无能力
- **WHEN** 以空字符串或不在封闭集内的操作名查询能力声明
- **THEN** 返回三项能力均为否的声明,不抛异常

#### Scenario: 能力声明不进定义文件
- **WHEN** 保存一个含引擎节点的工作流再读回
- **THEN** 定义文件不含能力声明字段,读写往返一致

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

### Requirement: 内置默认工作流种子

系统 SHALL 在工作流库为空且应用初始化工作流能力时,写入**两个**合法的内置默认工作流,使库非空。两者前半段共用(建分支 → 开 worktree → 关联环境 → 一个实现占位节点),交付段不同:

- **本地直合**:交付段为 合并 → 推送主干 → 删 worktree → 删本地分支。
- **PR 模式**:交付段为 推送需求分支(其上挂一道人工评审门)→ 合并 → 推送主干 → 删云端分支 → 删 worktree → 删本地分支。

两个默认工作流 MUST 各自通过结构校验与分支配对语义校验(均含 `create-branch` 与 `delete-branch`)。

#### Scenario: 空库时种入两个默认工作流
- **WHEN** 工作流库为空且应用初始化工作流能力
- **THEN** 系统写入「本地直合」与「PR 模式」两个合法的内置默认工作流,使库非空

#### Scenario: 两个默认工作流均通过分支配对校验
- **WHEN** 校验种入的「本地直合」与「PR 模式」默认工作流
- **THEN** 二者均含 `create-branch` 与 `delete-branch`,分支配对校验均通过

#### Scenario: 已有工作流时不重复种入
- **WHEN** 工作流库已非空时再次初始化工作流能力
- **THEN** 系统不重复种入默认工作流,既有包不被覆盖
