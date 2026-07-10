## Why

一张需求卡常常牵动多个独立 git 仓（如 erp 项目：`erp-client` 前端 + `erp-server` 后端，各自独立 `.git`、主线分别为 `master` / `main`）。`card-persistence-board-run`（已归档）已把卡模型立起来并**预留了多仓数据口**：卡有 `repos[]`（涉及成员仓）、运行绑 `cardId`、卡记 `activeRunId`；但它明确「不做多仓并行」，其「从卡派生运行请求」**仅取 `repos` 首仓、派生单仓运行**。于是引擎执行仍是**单仓的**——`derive()` 只派生一套分支/worktree/基分支，涉及仓里除首仓外都跑不起来。结果是用户只能手动在每个仓重复建同名分支、各自维护，规模化后正是「卡多了就腐烂」要解决的问题。本 change 把这最后一段单仓约束打通：让一卡一运行在涉及仓内**扇出**。

> **本轮范围（2026-07-02 收缩）**：只落地并**验收两套「建分支」方案**——① `target=all`（在卡涉及的全部成员仓建同名分支）；② **手动**给成员仓打 `tag` 标签 + `target=tag`（只给指定标签的成员仓建分支）。
> **本轮不做**：agent 自动推断标签 / 分诊自动写 `card.repos`（`tag` 与 `card.repos` 本轮**手动**设定）；`fromUpstream` 的运行时收窄（类型/校验已在代码里，但不接 agent、不在本轮验收）；联调 / 合并 / 联合验收编排（6.x）；工作流编辑器与看板 UI（7.x / 8.4）。这些留作后续 change。

## What Changes

- **一卡一运行、在涉及仓内扇出**：运行仍绑单一 `cardId`（沿用 card-persistence 的一卡一 `activeRunId`），其涉及仓集合取自 `card.repos`；引擎为集合中每个成员仓各建一套 ensure 上下文，在**一个运行内**对成员仓扇出（不为多仓拆多个运行）。卡 slug = 所有涉及仓的**同名分支名**。`RunRequest` 在既有 `cardId` 基础上承载多仓上下文（`repoPath` 保留作单仓退化/兼容）。
- **baseBranch 逐仓解析**：每个成员仓各按自己的主线取基（client=`master`、server=`main`），不再有单一 `baseBranch`。
- **工作流节点新增「目标仓」选择（target）**：判别联合，四种取值——`all`（本轮验收，全建）、`tag`（本轮验收，手动打标签）、`repo`（写死成员，已实现）、`fromUpstream`（类型/校验已在，接 agent 与运行时收窄留后续）。引擎把 target 解析成成员子集，对每个成员各跑一遍该引擎操作。
- **默认全建 + 自然回收，不新增操作**：`target=all` 时涉及仓都建空分支；未被改动的仓——`merge-branch` 对空分支本就是 noop，`delete-branch` 走安全删 `git branch -d`（未合并即拒）自动回收空/已合并分支、保护有真实工作的分支。无需新的 GC 原语。
- **成员仓标签（tag），本轮手动设定**：`RepoMember` 增 `tag` 字段，供 `target=tag` 解析。本轮由用户手动打标签（写入口 `setMemberTag` / 直接编辑 `registry.json`）；**agent 自动推断留后续**。
- **agent 节点结构化输出通道（数据留口）**：类型已定义（`{ repos }`），供将来 `fromUpstream` 与卡级分诊消费；本轮不接 agent、不填充。
- **联调与合并（留后续）**：联调 = `link-env` + `command`；合并 = 各仓 merge 回各自主线、联合验收栅栏挡在所有 merge 之前。本轮不实现、不验收。

## Capabilities

### New Capabilities
- `repo-targeting`: 工作流节点的「目标仓」选择模型（`all` / `tag` / `repo` / `fromUpstream` 判别联合）及引擎把 target 解析为成员仓子集、对子集扇出执行引擎操作的语义。

### Modified Capabilities
- `engine-execution`: 运行在既有 `cardId` 关联上，涉及仓取自 `card.repos`；按成员仓各建 ensure 上下文、逐仓解析 baseBranch；按节点 target 解析出的成员子集在一个运行内扇出；卡 slug 作所有涉及仓的同名分支名；断点持久化每成员派生上下文。
- `requirement-card-store`: 「从卡派生运行请求」由「仅取首仓、单仓运行」改为「取 `card.repos` 全集、派生一个扇出运行」。
- `workflow-definition`: `WorkflowNode` 增可选 `target` 字段（目标仓选择）；agent 节点增结构化输出通道（供 `fromUpstream` 下游与卡级分诊消费）。
- `multi-repo-project`: `RepoMember` 增 `tag` 字段，供 `target=tag` 解析。本轮由用户**手动**设定（`setMemberTag` 写入口 / 直接编辑 registry.json）；agent 自动标注留后续。

## Impact

- **前置依赖**：`card-persistence-board-run`（已归档）——卡 `repos[]`/`cardId`/`activeRunId`、卡↔运行双向链、resumeAll 按卡恢复、sidebar 程序化聚焦(成员仓,分支) 均已就位,本 change 建在其上,不重复实现。
- **代码**：`src/shared/types.ts`（`RunRequest` 承载多仓上下文、`RepoMember.tag`、`WorkflowNode.target`、agent 结构化输出、新增 `NodeTarget`）、`src/main/engine/engine.ts`（`derive` 逐仓化、`runEngineOp` 按 target 扇出）、`src/main/engine/ensure.ts`（`EnsureContext` 按成员构造）、`src/shared/workflow.ts`（节点校验含 target、agent 输出 schema）、card store 的「从卡派生运行请求」改多仓、`src/main/registry-core.ts` 与 `project-service.ts`（tag 标注与持久化）、`workflow-editor`（节点 target 配置 UI）。
- **数据/持久化**：`RunBreakpoint` 需持久化「每成员上下文 + agent 结构化输出」以保证 resume 稳定；`registry.json` 的 `RepoMember` 增 `tag`（项目管理数据，不入 git）。
- **兼容**：单仓项目是成员数为 1 的退化情形，须保证旧单仓工作流（无 target 字段）默认等价于「作用于唯一成员仓」，平滑迁移。
- **安全红线**：GC 路径上 worktree 移除沿用「绝不无脑 --force」克制——空分支但 worktree 脏（有未提交改动）时应拒删并抛给人，避免抹掉未提交工作。
