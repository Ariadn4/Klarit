## MODIFIED Requirements

### Requirement: 运行的标识、请求与持久化

引擎的一次执行称为一个**运行(run)**,SHALL 以一个 `runId` 唯一标识。运行由一个**运行请求**触发,请求至少含:目标工作流 id、目标仓库上下文,并 MAY 携带一个可选 **`cardId`**——把该运行**关联到一张需求卡**(见 `requirement-card-store`)。带 `cardId` 时,运行的**涉及仓集合来自该卡的 `repos`**(需求与成员仓多对多);运行 SHALL 以卡预取名(slug)作**所有被命中成员仓的同名工作分支名**。运行 MUST 为涉及仓集合中**每个成员仓各构造一套执行上下文**(各绑该成员的仓路径、逐仓解析的基分支),在一个运行内对成员仓**扇出**执行——**一卡对应一个运行**(对齐卡侧单一 `activeRunId` 与运行侧单一 `cardId`),不为多仓拆成多个运行。单仓卡(`repos` 单元素)是成员数为 1 的退化情形,行为与今日单仓一致。

当运行请求**要求避撞**时(`avoidBranchConflict`——**卡派生的运行请求默认开启**,直接触发的运行缺省关闭),分支名 MUST 在运行**触发(start)时一次性解析**出一个在**所有涉及仓都空闲**的名字:自卡 slug 起,若该名在**任一**涉及仓已存在同名本地分支、**或**其在任一涉及仓派生出的 worktree 路径已被占用,则**所有涉及仓一起**递增尾号(`x`→`x-2`→`x-3`…)另取下一档,逐档对全体涉及仓复检,直到找到一个在**每个涉及仓的本地分支与 worktree 路径两个维度上都空闲**的名字;解析结果 SHALL **一次性烙入 `request.branch`**。涉及仓始终**共用同一个**分支名——不做逐仓分别递增(保「卡 slug = 各仓同名分支」不变量)。此解析 MUST 只在 start 发生**一次**且只读探测(不写 git):`deriveMembers` 等派生 MUST 保持纯函数,恢复(resume)时**沿用已烙入的分支名**,MUST NOT 在恢复时重跑撞名检测(否则会从运行自己已建的 worktree 上递增走开、造成孤儿)。start 之后若外部插入同名分支,由既有幂等认领(见「引擎执行器」`create-branch`)兜底,不重解析。**未要求避撞**的运行沿用既有幂等认领语义——遇同名分支即认领(noop),不改名。

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

#### Scenario: 建分支撞名时全仓统一递增避撞（opt-in）
- **WHEN** 触发一个 `avoidBranchConflict` 开启、slug 为 `x`、涉及仓 A、B 的运行,其中 B 已存在本地分支 `x`(或 B 的 `x` 派生 worktree 路径已被占用)
- **THEN** start 解析出下一档 `x-2`(A、B **一起**用 `x-2`,不是只 B 递增),烙入 `request.branch`;A、B 的 worktree 路径均据 `x-2` 派生

#### Scenario: 未要求避撞的运行遇同名分支沿用幂等认领
- **WHEN** 触发一个 `avoidBranchConflict` 关闭(缺省)、分支为 `x` 的运行,而 `x` 已存在
- **THEN** 不改名(`request.branch` 仍为 `x`),由既有幂等认领处理(create-branch 报 noop),保直接触发运行的既有语义

#### Scenario: 冲突判定含分支与 worktree 路径两维
- **WHEN** slug `x` 的分支在所有涉及仓都不存在,但其在某涉及仓派生的 worktree 路径已被占用
- **THEN** `x` 判为不可用,全仓递增到 `x-2`(直到某档在每个涉及仓分支与路径两维都空闲)

#### Scenario: 恢复时沿用已烙入分支名不再递增
- **WHEN** 一个已把 `request.branch` 解析为 `x-2` 并建出 worktree 的运行随应用重开、触发恢复,`deriveMembers` 重跑
- **THEN** 派生沿用已烙入的 `x-2`(尽管此刻 `x-2` 分支/worktree 已由本运行自己占用),不再重跑撞名检测、不递增到 `x-3`

#### Scenario: 旧断点无 cardId 仍可读
- **WHEN** 引擎加载一份不含 `cardId` 的旧断点
- **THEN** 正常读取并续跑,视为无卡关联、单仓上下文,不报错(向后兼容)

#### Scenario: 单仓卡退化等价
- **WHEN** 绑卡运行的卡 `repos` 仅一个仓且工作流节点均未声明 target
- **THEN** 运行行为与今日单仓一致(派生单套分支/worktree/base,作用于唯一成员);无撞名时分支名即原 slug 不变
