## Context

`card-persistence-board-run`（已归档）已把卡模型立起来并预留多仓数据口:`RequirementCard` 有 `projectId`、`repos: string[]`（涉及成员仓,多对多）、`activeRunId?`;`RunRequest`/断点有 `cardId`;卡↔运行双向链（`cardId` ↔ `activeRunId`）、resumeAll 按卡恢复、sidebar 程序化聚焦(成员仓,分支) 均已就位。但它明确「不做多仓并行」——其「从卡派生运行请求」仅取 `repos` 首仓、派生单仓运行,引擎执行层仍单仓:`derive()`（`engine.ts:146-160`）只派生一套 `branch/worktreePath/baseBranch`,`EnsureContext`「均绑定到主仓」。本 change 建在这些数据口之上,把最后一段单仓约束打通。

真实 dogfood 项目 `e:\恢复\erp_svn` 直接印证了缺口:容器目录自身是 SVN，底下 `erp-client`（前端）与 `erp-server`（后端）各是独立 git 仓；两仓默认主线**不同**（client=`master`、server=`main`）；两仓已存在大量**同名分支**（`feat/batch-workflow-actions`、`feat/list-sort`、`feat/web-push-notifications`…）——用户其实已在手动跑「一卡多仓」。

约束:8 个引擎操作是**封闭集**（`workflow.ts:54` ENGINE_OPERATION_SPECS，UI 下拉/校验/执行单一来源）；git 写原语（`git-write.ts`）本就与仓数无关、给哪个 repoPath 就在哪执行；删分支安全语义（`git branch -d` 未合并即拒）与 worktree 防御性解链（绝不无脑 --force）是既有安全红线。

## Goals / Non-Goals

**Goals:**
- 一次运行绑「项目 + 卡」,引擎对**每个成员仓**各建一套 ensure 上下文、逐仓解析 baseBranch。
- 工作流**节点**可声明「目标仓」（`all` / `tag` / `repo` / `fromUpstream`）,引擎按解析出的成员子集对该操作扇出。
- 卡 slug 作所有涉及仓的**同名分支名**。
- 默认全建 + 未用仓自然回收,**不新增引擎操作**（复用 merge-noop + 安全删）。
- 成员标签由 agent 标注、人确认,供 `tag` target 解析。
- 单仓项目（成员数 1）行为与今日等价,旧工作流（无 target）平滑兼容。

**本轮范围（2026-07-02 收缩）：** 只落地 + 验收两套「建分支」——① `target=all` 全建；② 手动打 `tag` 标签 + `target=tag`。`tag` 与 `card.repos` 本轮**手动**设定;agent 推断/分诊、`fromUpstream` 运行时收窄、联调/合并编排、编辑器与看板 UI 均降级为后续 change（类型/校验/数据口保留在代码里）。

**Non-Goals:**
- **agent 自动推断 `tag` / 分诊自动写 `card.repos`**（本轮手动）——留后续。
- **`fromUpstream` 运行时收窄接 agent**（类型与校验已在代码，本轮不验收）——留后续。
- **工作流编辑器 / 看板多仓 UI**——本轮工作流以手写 workflow.yaml 提供、tag 以 `setMemberTag`/registry.json 手动设定。
- 跨独立仓的**真 2PC 原子合并**（物理不可达）——本设计止于「联合验收栅栏 + 各仓各合 + 合前预演」。
- 联调/合并节点的全新原语——复用 `link-env` + `command` 拼装,本 change 不发明新操作。
- monorepo 子包场景（单 git 仓内多包）——那是「多包」非「多仓」,引擎几乎不涉及,不在范围。
- agent 标签推断的具体提示词工程——本 change 只定义 `tag` 字段、标注时机与人确认回路。

## Decisions

### D1：扇出位置——一个 run 内对成员仓扇出（方案 C），而非 N 个独立 run（方案 A）
联调（需同时看见多仓）、联合验收（对整张卡一次验收）、合并栅栏（联合验收过才许任一仓合）都要求一个**能看见所有涉及仓的协调者**。N 个完全独立的 run（方案 A）无法表达跨仓 joint 节点。**且 card-persistence 已把卡↔运行定为单数关系**（卡单一 `activeRunId`、运行单一 `cardId`）——方案 A（一卡 N run）会逼着把 `activeRunId` 改成数组,与既有模型冲突。故坐实方案 C:run 绑单一卡,涉及仓取 `card.repos`,引擎在一个 run 内对成员仓扇出;工作流图节点分 per-target（扇出）与 joint（栅栏）两类。

### D2：baseBranch 逐仓解析,不设卡级统一基线
实测 client 主线 `master`、server 主线 `main`。卡级统一基线会基错线;「各仓取当前分支」又会撞上脏 HEAD（client 现停在 `fix/excel-…`）。故每个成员仓各按自身主线/约定解析 base,`derive()` 从单一 `baseBranch` 改为逐成员产出。

### D3：目标仓选择是**节点属性**,判别联合,四模式统一一个字段
```
NodeTarget =
  | { kind: 'all' }                    // 默认全建
  | { kind: 'tag', tag: string }     // 按成员标签（可跨项目复用模板）
  | { kind: 'repo', memberId: string } // 写死成员（项目私有工作流）
  | { kind: 'fromUpstream', nodeId }   // 取上游 agent 节点结构化输出
```
把多仓逻辑从引擎 `derive()` 搬进工作流图当节点配置,引擎退化为忠实执行器:节点说管哪些仓,就对那些仓各跑一遍 ensure。**解析基准是 `card.repos`**(不是「项目全体成员」):`all` = `card.repos` 全集,`tag`/`repo`/`fromUpstream` 在其内选择;缺省（无 target）= `all`。
`card.repos` 本身是**卡级「分诊」的产出**:一个上游 agent 判「本卡动哪些仓」写入 `card.repos`(前端/后端/前后端/纯配置=空),人可确认改。故 `fromUpstream` 与「分诊写 card.repos」分工:分诊定**卡级基准**(运行前),`fromUpstream` 做**运行中途动态收窄**。「默认全建+GC」(D4)与「分诊预收窄」二者共存——`card.repos` 缺省为全体则触发全建+回收,被分诊收窄则无空分支可回收。
*备选*:在引擎硬编码「卡→仓」判断——否决,违背 Klarit「用户自由编排工作流」定位且不灵活。

### D4：默认全建 + 自然回收,不新增 GC 操作
`target=all` 时两仓都建空分支。未被改动的仓:
- `merge-branch` 对空分支本就报 noop（`git-write.ts:139`「已合并报 noop」）——无需手动「跳过合并」。
- `delete-branch` 走安全删 `git branch -d`（`git-write.ts:120`「未合并即拒」）——空/已合并分支删得掉、有真实未合并工作的被拒保护。「这个仓用没用上」的判断**由 git 安全删内建**,不用另写。

故生命周期 `create(all) → dev → merge(all)[空仓 noop] → delete(all)[安全删自然回收]` 天然处理「前端 only / 后端 only / 两个都没用上」。
*备选*:新增 `prune-unused` 原语——否决,冗余。

### D5：成员标签由 agent 标注、人确认,存注册表
`RepoMember` 增 `tag`（受控可扩展词表:前端/后端/配置/共享 SDK…）。识别到成员仓有改动/被注册时由 agent 推断,用户可改（呼应「分解止于审阅」的 agent 猜-人拍板调性）。存 `registry.json`（项目管理数据,不入 git）。

### D6：单仓与旧工作流兼容
单仓项目 = 成员数 1 的退化情形。节点无 `target` 时缺省解析为「全部成员」（单仓即唯一成员,行为同今日）。`RunRequest` 旧形态在迁移期映射为「单成员项目 + 无 target 节点」。

### D7：联调与合并复用现有零件
联调 = `link-env`（把兄弟成员仓 worktree junction 进 hub worktree）+ `command`（在 hub 一处启动跑联调）。合并 = 各仓 `merge-branch` 回各自主线,联合验收栅栏挂在所有 merge 节点之前;合前建议在 hub worktree 预演一次（各分支 rebase 到各自最新主线 + 试合）。

### D8：agent 节点新增结构化输出通道
现 agent 输出只能写 markdown 文件（`workflow.ts:134` v1 仅 file）。新增 typed 输出（至少 `{ repos: string[] }` 形态的涉及仓判定）,存入 `RunBreakpoint` 供 resume 与 `fromUpstream` 消费。

## Risks / Trade-offs

- **跨独立仓无法真原子合并** → 联合验收栅栏挡在所有 merge 之前（没整体验过谁都别合）+ 合前预演 + 出事「整卡回退」而非放半截。残余「B 合完 A 合时冲突」仍可能,接受为独立仓上限。
- **GC 误删未提交工作**:`ensureNoBranch` 删分支前**先 force 移除占用 worktree**（`ensure.ts:159` `{force:true}`）。某仓空分支但 worktree 有未提交改动时会被抹掉 → GC 路径上 worktree 移除改用**非 force**,脏则拒删抛给人（沿用「绝不无脑 --force」红线）。
- **`target=all` 推空分支到远端**:`push-branch(all)` 会给未用仓建垃圾远端分支 → push 对空分支 skip-if-empty,或由 `delete-remote-branch` 清理。
- **resume 复杂度上升**:run 状态从单仓变「每成员上下文 + agent 结构化输出」,断点持久化面变大 → 断点 schema 显式化每成员派生结果与上游输出,保证 same-input→same-derive。
- **tag 词表漂移**:自由 tag 易碎 → 受控可扩展集 + 人确认。
- **封闭操作集语义改变**:8 个操作从「作用主仓」→「作用 target 子集」是行为级变更 → 缺省解析 + 全量契约测试覆盖单仓退化等价。

## Migration Plan

1. 类型先行:`NodeTarget`、`RepoMember.tag`、agent 输出 schema、`RunRequest` 新形态（先红测试）。
2. `derive()` 逐仓化 + `EnsureContext` 按成员构造（保持单仓路径等价）。
3. `runEngineOp` 按 target 解析成员子集扇出;无 target 缺省全成员。
4. 节点校验（`workflow.ts`）纳入 target 与 agent 结构化输出。
5. tag 标注与持久化（`registry-core` / `project-service`）。
6. `workflow-editor` 节点 target 配置 UI。
7. 回退策略:节点 target 为可选,未用即旧行为;tag 字段缺省不影响单仓;特性可按工作流维度渐进启用。

## Open Questions

- tag 词表是固定枚举还是自由 tag + 建议集?一个成员可否多标签（全栈仓）?
- 分诊 agent 与 `fromUpstream` 的结构化输出 schema:仅「涉及仓」,还是同时承载每仓 baseBranch/分支名覆盖?二者是否共用同一 schema?
- 合前预演（rebase + 试合）是独立 joint 节点,还是 `merge-branch` 内置的前置检查?
- 联合验收栅栏挂在哪:作为一个 joint `push-branch`/`command` 节点的门把,还是新的 joint 节点类型?
- 看板卡上「分支名」多仓下如何呈现（slug 跨仓同名,点击聚焦到哪个成员仓的 worktree）?card-persistence 现为单分支展示,需最小适配。
