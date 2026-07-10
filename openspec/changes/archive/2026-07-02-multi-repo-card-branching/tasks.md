> 前置:`card-persistence-board-run` 已归档,以下已就位、本 change 不重复——卡 `repos[]`/`cardId`/`activeRunId`、卡↔运行双向链、resumeAll 按卡恢复、sidebar 程序化聚焦(成员仓,分支)。

## 1. 类型与数据模型（先行，测试先红）

- [x] 1.1 在 `src/shared/types.ts` 定义 `NodeTarget` 判别联合（`all` / `tag` / `repo` / `fromUpstream`），并给 `WorkflowNode` 增可选 `target` 字段
- [x] 1.2 给 `RepoMember` 增可选 `tag` 字段（受控可扩展词表注释），属 userData、不入 git
- [x] 1.3 扩展 agent 执行者输出类型：在既有 markdown 产出外增「结构化输出」（至少 `{ repos: string[] }` 涉及仓判定），供分诊写 `card.repos` 与 `fromUpstream` 消费
- [x] 1.4 在既有 `RunRequest.cardId` 基础上让请求承载多仓上下文（涉及仓集合取自 `card.repos`）；`repoPath` 保留作单仓退化/兼容,不带 `cardId` 仍按单仓
- [x] 1.5 扩展 `RunBreakpoint` 持久化结构：在既有 `cardId`/`nodePath` 之上增每成员派生上下文（分支/worktree 路径/逐仓 baseBranch）+ 上游结构化输出

## 2. 工作流校验（`src/shared/workflow.ts`）

- [x] 2.1 为 `target` 字段写校验：`tag` 标签名非空、`repo` 的 memberId 非空、`fromUpstream` 引用前置 agent 节点；缺省合法
- [x] 2.2 为 agent 结构化输出写校验，并确保 `fromUpstream` 引用的 agent 节点确有声明结构化输出
- [x] 2.3 确认 8 个封闭操作集与 target 组合的校验路径；单仓/无 target 工作流仍通过既有校验

## 3. 引擎逐仓化（`src/main/engine`）

- [x] 3.1 `ensure.ts`：`EnsureContext` 按成员构造（每成员绑自身 repoPath/read/run/remote），或引入「成员上下文表」
- [x] 3.2 `engine.ts` `derive()`：从派生单套改为给每个成员仓逐仓派生分支/worktree 路径/baseBranch；卡 slug 作所有命中仓的同名分支名
- [x] 3.3 逐仓 baseBranch 解析：各成员按自身主线取基（覆盖 client=master / server=main 实测场景）
- [x] 3.4 实现 target 解析器：把节点 `target` 解析为成员仓子集（`all`=全体、`tag`=按标签、`repo`=指定、`fromUpstream`=读 run 状态里的上游结构化输出）；缺省=全体
- [x] 3.5 `runEngineOp` 扇出：对解析出的成员子集逐成员各跑一遍 ensure；成员间独立，整节点等子集全收敛后按失败归宿处理
- [x] 3.6 子集中某成员终局失败 → 进入可见的等待决策（携带成员与失败归类），不静默卡住
- [x] 3.7 card store「从卡派生运行请求」由「取首仓单仓运行」改为「取 `card.repos` 全集、派生一个扇出运行」；`repos` 为空/无激活工作流仍返回可读原因

## 4. 默认全建 + 自然回收的安全收敛

- [x] 4.1 验证 `merge-branch` 对空分支报 no-op、`delete-branch` 安全删（`-d`）自然回收空/已合并分支并保护未合并分支（契约测试）
- [x] 4.2 GC 路径 worktree 移除改用非 force：成员 worktree 脏（有未提交改动）时拒删并表现为可见停点
- [x] 4.3 `push-branch` 对空分支 skip-if-empty，避免给未用成员仓建垃圾远端分支

## 5. 成员标签手动设定（`src/main/registry-core.ts`）

- [x] 5.1 `tag` 字段读写持久化到 registry.json；不入 git（`setMemberTag` + round-trip 测试）
- [x] 5.3 tag 手动设定：本轮直接写 registry.json（dogfood web=前端/api=后端 已预置）；`setMemberTag` 写入口已在，IPC/UI 暴露归 8.3 后续

## 6. 兼容与回归

- [x] 6.1 单仓卡（`repos` 单元素、节点无 target）端到端等价于今日单仓行为的契约/e2e 测试（原 8.1）
- [x] 6.2 无 `cardId` 的旧断点/运行按单仓上下文正常读取续跑（沿用 card-persistence 向后兼容）（原 8.2）
- [x] 6.3 resume 测试：same-input → same-derive，每成员上下文从断点稳定恢复（原 8.3）

## 7. 本轮验收：dogfood 跑 all / tag 两套建分支（`f:\klarit-dogfood`）

- [x] 7.1 把 `f:\klarit-dogfood` 搭成多仓项目（容器下 ≥2 个成员 git 仓，可区分标签）
- [x] 7.2 建工作流 A：`create-branch` 节点 `target=all`（在卡涉及全部成员仓建同名分支）
- [x] 7.3 建工作流 B：`create-branch` 节点 `target=tag`（只给指定标签的成员仓建分支）
- [x] 7.4 dogfood 端到端手动验收（`npm run dev`）：all 已跑通（web/api 均建同名分支）；tag 工作流已配置校验；分支下拉实时刷新已修
- [x] 7.5 工作流编辑器节点「目标仓」选择器（all / 按标签 tag）——本轮按用户要求补上（repo/fromUpstream 仍经 yaml）

## 8. 后续 change（本轮不做，仅留数据/类型口）

> 以下非本 change 任务，为后续 change 的范围记录（故不作复选框计入本 change 完成度）。

- agent 自动推断 `tag`（成员识别时 agent 猜、人确认）
- 分诊：上游 agent 判定涉及仓、结构化输出写入 `card.repos`（`fromUpstream` 运行时收窄）
- 工作流编辑器 UI 补全：节点 target 的 `repo`/`fromUpstream` 模式、agent 结构化输出声明项、成员标签编辑入口
- 联调 / 合并 / 联合验收编排（`link-env` + `command` + 合并栅栏）
- 看板卡「分支名」多仓最小适配（slug 跨仓同名展示 + 点击聚焦）
