## MODIFIED Requirements

### Requirement: 运行的标识、请求与持久化

引擎的一次执行称为一个**运行(run)**,SHALL 以一个 `runId` 唯一标识。运行由一个**运行请求**触发,请求至少含:目标工作流 id、目标仓库上下文,并 MAY 携带一个可选 **`cardId`**——把该运行**关联到一张需求卡**(见 `requirement-card-store`)。带 `cardId` 时,运行的**涉及仓集合来自该卡的 `repos`**(需求与成员仓多对多);运行 SHALL 以卡预取名(slug)作**所有被命中成员仓的同名工作分支名**。运行 MUST 为涉及仓集合中**每个成员仓各构造一套执行上下文**(各绑该成员的仓路径、逐仓解析的基分支),在一个运行内对成员仓**扇出**执行——**一卡对应一个运行**(对齐卡侧单一 `activeRunId` 与运行侧单一 `cardId`),不为多仓拆成多个运行。单仓卡(`repos` 单元素)是成员数为 1 的退化情形,行为与今日单仓一致。

运行的状态(断点)MUST 按运行**独立持久化**到用户数据目录(`userData/engine-runs/<runId>.json`),其 `request.cardId` 随之持久化,作运行 → 卡的**正向链**;卡侧以 `activeRunId` 记反向链。断点 MUST 额外持久化**每个成员仓的派生上下文**(分支/worktree 路径/逐仓基分支)与**上游节点结构化输出**,以保证恢复稳定。运行模型本身(阶段状态机、决策回路、恢复)MUST NOT 因绑卡或多仓而改变——`cardId` 仍为可选关联字段,不带 `cardId` 的运行(如旧数据)按无关联、单仓上下文处理。

> 说明:运行断点本期仍物理存于 `engine-runs`(运行机制单一来源,`resumeAll` 依赖之),逻辑上经 `cardId`/`activeRunId` 双向链归属于卡。

#### Scenario: 触发运行得到 runId
- **WHEN** 以一个合法运行请求触发引擎
- **THEN** 引擎分配并返回一个 `runId`,并为该运行落一份持久化断点(含每成员派生上下文)

#### Scenario: 运行状态可按 runId 查询
- **WHEN** 以某 `runId` 查询运行状态
- **THEN** 返回该运行的当前节点、阶段、运行态与(若有)待决策;未知 runId 返回空而非抛错

#### Scenario: 运行请求可关联需求卡并按卡涉及仓扇出
- **WHEN** 以一个携带 `cardId`、其卡 `repos` 含成员 A、B 的运行请求触发引擎
- **THEN** 单个运行为 A、B 各建执行上下文,断点记下 `request.cardId` 与每成员派生上下文,可据此反查所属卡

#### Scenario: 旧断点无 cardId 仍可读
- **WHEN** 引擎加载一份不含 `cardId` 的旧断点
- **THEN** 正常读取并续跑,视为无卡关联、单仓上下文,不报错(向后兼容)

#### Scenario: 单仓卡退化等价
- **WHEN** 绑卡运行的卡 `repos` 仅一个仓且工作流节点均未声明 target
- **THEN** 运行行为与今日单仓一致(派生单套分支/worktree/base,作用于唯一成员)

### Requirement: 引擎执行器——幂等的 ensure 操作

`engine` 执行者的每个操作 SHALL 实现为一个**幂等调谐器**:先**探测** git/fs 实际状态,已达目标即 no-op,否则补齐(reconcile-by-probe)。引擎为运行的**每个成员仓**各构造一套 ensure 上下文(各绑该成员的仓路径、逐仓解析的基分支);执行一个引擎节点时,SHALL 先按节点 `target`(见 `repo-targeting`)解析出成员仓子集,再对子集中每个成员各执行一次对应操作。引擎 MUST 支持以下操作,各以「确保某状态成立」语义实现,且对「目标已达 / 目标未达 / 存在半成品残留」三态都安全收敛:

- `create-branch`:确保分支(=卡 slug)存在于该成员仓自身主线为基的期望基点。
- `open-worktree`:确保该分支在期望路径有 worktree(残留半成品先 prune/repair)。
- `link-env`:确保关联环境的 junction 存在且指向正确(指向错则清后重链);亦用于联调——把兄弟成员仓 worktree 链进 hub worktree。
- `merge-branch`:确保来源已并入目标(在途合并先 abort);空/已合并分支报 no-op;冲突为终局失败。
- `push-branch`:确保远端分支已是本地 HEAD;非快进/无远端为终局失败;对空分支可 skip 以免建垃圾远端分支。
- `remove-worktree`:确保该 worktree 不存在——删前**无条件防御性解链**(见 `git-write-operations`)。
- `delete-branch`:确保本地分支不存在——若仍被 worktree 检出则**级联**先移除该 worktree;采用安全删,未合并为终局失败(由此天然回收未被改动成员仓的空分支、保护有真实工作的分支)。
- `delete-remote-branch`:确保远端分支不存在。

#### Scenario: 重复执行同一操作收敛为 no-op
- **WHEN** 对同一目标连续执行同一 ensure 操作两次
- **THEN** 第二次探测到目标已达、不重复施加副作用,git/fs 状态不变,均标记成功

#### Scenario: 半成品残留被调谐
- **WHEN** 执行 `open-worktree` 而该路径存在一个被中断留下的半成品/失效 worktree 注册
- **THEN** 操作先清理残留(prune/repair)再补齐,最终达成期望 worktree

#### Scenario: 删分支级联清理检出它的 worktree
- **WHEN** 执行 `delete-branch` 而该分支仍被某 worktree 检出
- **THEN** 操作先对该 worktree 执行 `remove-worktree`(含防御性解链),再删分支

#### Scenario: 逐仓解析各自主线为基
- **WHEN** `create-branch` 命中成员 A(主线 master)与 B(主线 main)
- **THEN** A 的分支基于 master、B 的分支基于 main,各以自身主线为基点

#### Scenario: 未被改动成员仓的空分支被安全删回收
- **WHEN** 某成员仓的卡分支无新提交(未被改动),运行到 `delete-branch` 节点
- **THEN** 安全删 `git branch -d` 成功删除该空/已合并分支;若另一成员有未合并真实提交则其安全删被拒、分支受保护

## ADDED Requirements

### Requirement: 默认全建后未用成员仓的回收

当 `create-branch`/`open-worktree` 以 `target=all`(解析为卡 `repos` 全集)在涉及仓建分支后,未被改动的成员仓 SHALL 通过既有节点自然回收,**无需新增 GC 操作**:`merge-branch` 对其空分支报 no-op,`delete-branch` 经安全删将其回收。GC 路径上的 worktree 移除 SHALL 沿用「绝不无脑 --force」红线——成员仓 worktree 含未提交改动时 MUST 拒绝删除并表现为可见停点,绝不静默抹掉未提交工作。

#### Scenario: 前后端都改时两仓分支都保留合并
- **WHEN** 卡涉及仓 A、B 且两仓都有真实提交,走到 merge/delete 节点
- **THEN** 两仓各 merge 回各自主线;两仓分支均非空,安全删按生命周期在合并后回收

#### Scenario: 仅后端被改时前端空分支自然回收
- **WHEN** 卡涉及仓 A、B 但仅 B 有提交,走到 merge/delete 节点
- **THEN** A 的空分支 merge 报 no-op、随后被安全删回收;B 正常合并

#### Scenario: 空分支但 worktree 脏时拒删抛给人
- **WHEN** 某成员空分支但其 worktree 含未提交改动,GC 尝试移除该 worktree
- **THEN** 移除被拒(非 force),运行进入可见停点而非抹掉未提交改动
