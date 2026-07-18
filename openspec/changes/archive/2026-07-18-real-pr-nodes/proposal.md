## Why

现在的「PR 模式」内置工作流只是「push 分支 → 本地人工门点一下 → Klarit 自己 `merge-branch` 合并」——**从头到尾没有真的在托管平台上开 PR**，评审也不在平台上发生。用户要的是**真 PR**：Klarit 帮你开 PR、评审与合并在平台上做，Klarit 察觉合并后再做本地收尾（删分支、删 worktree）。

这里有两件新东西：①「开 PR」各家平台都不一样，交给 agent 去应对；②「等平台把 PR 合并、合了才收尾」——这是引擎**第一个「等外界环境变化」的关口**。它不是一个流水线节点，而是一种**新的门类**：既要等一个 Klarit 控制不了的外部状态（PR 合了没），又要在不满意时把 PR 打回改代码。前者靠核查（现在 git 核查、将来可接 webhook），后者正是**人工评审门天生的「打回 → 内容驱动回退」**。所以把它做成一个新门类，比做成节点更顺——打回复用现成机制，webhook 也有正经接入点。

## What Changes

- **「引擎操作」概念拓宽**：从「确定性 git 原语」升级为「平台预制的现成节点」——对外仍是 engine 操作，**内部实现可由 git 原语 / agent / 命令支撑**，是封装细节。（本 change 不改「引擎操作」这个名字。）
- **新引擎操作 `open-pr`（内部调 agent）**：对外是引擎操作节点，内部派发给 agent 认平台（GitHub PR / GitLab MR / Bitbucket / Gitea / Azure / 自建）、用对的 CLI 或 API、从需求卡写标题正文、回报 PR 链接。**多仓**：每个涉及成员仓各开自己的 PR。幂等靠 agent「先查再开」。无可用 agent 时失败挂起、给清楚提示。
- **新门类「外部门」（`external`，门的第三个 `kind`）**：`WorkflowGateItem` 除 `auto`（自动校验）、`manual`（人工评审）外新增 `external`。它**等一个 Klarit 控制不了的外部状态达成**：进门即核查（v1 支持 `pr-merged`——`fetch --prune` 后看分支是否已并入基分支 / 上游是否变 `gone`，平台无关、免平台 CLI），达成则**过门**、未达成则**挂起等待**（人点「开始收尾」触发再核查；**将来可接 webhook 由外部信号触发**）。它**复用人工评审门的自由输入 → 内容驱动回退**：写反馈即把 PR 打回——退回到之前节点改代码 → 前向重流自然 re-push 更新 PR → 回到本门再等合并。
- **新内置「真 PR 工作流」**：交付段为 `push 需求分支 → open-pr（其上挂一道外部门 pr-merged）→ 删 worktree → 删本地分支`。**没有 `merge-branch`**——合并在平台上发生；云端分支由平台「合并后自动删分支」清掉。（`verify-pr-merged` **不再是一个引擎操作/节点**，其核查逻辑成为外部门的过门条件。）
- **写工作流 skill 同步**：`buildAuthorWorkflowSkill` 从数据模型自动合成，带上新操作 `open-pr` 与新门类 `external`（及其面向需求语义）。

## Capabilities

### New Capabilities
<!-- 无全新能力：本 change 扩展现有能力（工作流数据模型、引擎执行器、写工作流 skill、git 写侧、内容驱动回退）。 -->

### Modified Capabilities
- `workflow-definition`: 门把模型新增第三个 `kind` **`external`（外部门）**——等外部状态达成的门（v1 一个内置核查 `pr-merged`；未来可接 webhook），校验与数据模型随之扩展；封闭引擎操作集加 `open-pr`（9 项）；内置默认工作流种子由两个增至三个（加「真 PR」，其 open-pr 节点挂外部门）。
- `engine-execution`: 引擎 ensure 执行器加 `open-pr`（内部拉起 agent）；**引擎执行外部门**——进门核查外部状态，达成过门、未达成挂起（人触发再核查 / 未来 webhook），其自由输入打回**复用人工评审门的内容驱动回退**；确立「引擎操作内部可由 git/agent/命令支撑」的分派语义。
- `content-driven-rollback`: 内容驱动回退的**发起入口**从「人工评审门」扩到「外部门」（同一驳回自由输入 → 判定 → 重入前向修复）；回退**回落 origin-aware**——取消/判无果时**重抛发起它的那道门**（评审门→评审门；外部门→外部门），不固定回评审门。
- `workflow-authoring`: `buildAuthorWorkflowSkill` 覆盖新操作 `open-pr` 与新门类 `external`，讲清「引擎操作可由 agent 支撑」「外部门等外部状态、pr-merged 语义、打回即回退」。
- `git-write-operations`: 新增「拉取并判定分支已合并 / 上游 gone」的只读原语（`fetch --prune` + 判定），供**外部门 `pr-merged`** 平台无关地核查合并。

## Impact

- **代码**：`src/shared/types.ts` 与 `src/shared/workflow.ts`（`WorkflowGateItem` 加 `external` 判别支、`validateGate`/`repairGate`/迁移；`ENGINE_OPERATION_SPECS`/`ENGINE_OPERATIONS` 加 `open-pr`；`buildAuthorWorkflowSkill`；新增 `createRealPrWorkflow` 种子）、`src/main/engine/engine.ts`（`runEngineOpForMember` 加 `open-pr` 委派 agent；门处理分支加 `external` 核查/挂起；驳回自由输入的回退发起扩到外部门；`raiseManualGate`→按门 kind 重抛的 `raiseGate`）、`src/main/engine/decisions.ts`（外部门挂起决策、open-pr 失败路由）、`src/main/git-write.ts`（合并核查原语）、i18n 文案。
- **依赖**：`open-pr` 依赖用户已配置的 agent（Klarit 本就依赖）；不引入对 `gh` 等平台 CLI 的硬依赖。外部门 `pr-merged` 核查零平台 CLI 依赖。
- **兼容**：既有两个默认工作流、既有引擎操作与门类、旧包不受影响；`external` 门类与 `open-pr` 均为纯增量（旧包无 `external` 门、加载不变）。分支配对约束满足（真 PR 工作流含 `create-branch` 与 `delete-branch`）。**处置 agent 与既有引擎决策路由不动**（打回=门的能力，不泛化到普通引擎失败决策）。
- **不在本 change**：外部门接 **webhook**（本期只做「人触发再核查」，webhook 留接入点）；外部门的其它外部核查种类（v1 只 `pr-merged`）；「交给 agent 问平台 API 拿确凿合并状态」的确凿退路；「引擎操作」改名；平台 CLI 一键安装。
