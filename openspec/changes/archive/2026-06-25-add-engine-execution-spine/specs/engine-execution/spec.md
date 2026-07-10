## ADDED Requirements

### Requirement: 运行的标识、请求与持久化

引擎的一次执行称为一个**运行(run)**,SHALL 以一个 `runId` 唯一标识。运行由一个**运行请求**触发,请求至少含:目标工作流 id、目标仓库上下文(仓路径、可选分支名)。运行的状态(断点)MUST 按运行**独立持久化**到用户数据目录,**不绑定需求卡**(卡数据模型尚未落地);将来卡落地时以一个可选关联字段挂接,不改运行模型本身。

#### Scenario: 触发运行得到 runId
- **WHEN** 以一个合法运行请求触发引擎
- **THEN** 引擎分配并返回一个 `runId`,并为该运行落一份持久化断点

#### Scenario: 运行状态可按 runId 查询
- **WHEN** 以某 `runId` 查询运行状态
- **THEN** 返回该运行的当前节点、阶段、运行态与(若有)待决策;未知 runId 返回空而非抛错

### Requirement: 节点执行的阶段状态机

引擎执行一个节点 SHALL 走一台**阶段状态机**:`executing`(跑执行者)→ 依序 `gate 0`、`gate 1`…`gate n`(逐道检查)→ `done`(推进到下一节点)。引擎 MUST 在**每个阶段边界**持久化断点(记录当前节点与所处阶段)。`done` 即推进到工作流节点列表的下一个节点;末节点 `done` 即运行完成。

#### Scenario: 无门节点走 executing 直达 done
- **WHEN** 执行一个无门把的引擎节点
- **THEN** 经 `executing` 阶段后直接进 `done` 并推进到下一节点,期间在阶段边界写过断点

#### Scenario: 有门节点逐道过门
- **WHEN** 执行一个含若干门把的节点,且各门把依次通过
- **THEN** 阶段依 `executing → gate 0 → … → gate n → done` 推进,每道门把通过后断点前移到下一阶段

### Requirement: 运行态与「永不静默卡住」

运行 SHALL 处于三种状态之一:`running`(推进中)、`waiting-decision`(被一个待决策阻塞)、`paused`(被用户暂停)。引擎 MUST NOT 让运行因错误进入任何**不可见、无出路**的停滞:任何使运行无法继续的情形,MUST 表现为 `waiting-decision`(携带可操作的固定选项)或 `paused`,二者皆为**可见、可操作**的状态。

#### Scenario: 终局失败进入可见的等待决策而非死挂
- **WHEN** 某节点遇到无法自动恢复的终局失败
- **THEN** 运行进入 `waiting-decision` 并携带固定选项,而非停在一个无状态、无按钮的卡死

#### Scenario: 暂停是可见状态
- **WHEN** 用户暂停一个运行
- **THEN** 运行在下一个阶段边界进入 `paused` 并持久化断点,可被恢复

### Requirement: 断点恢复与开机自动续跑

恢复 SHALL 依断点跳到 `(当前节点, 阶段)` 并**续跑当前阶段**,而非从节点开头重来。重跑当前阶段 MUST 安全:`executing` 阶段重跑引擎操作因其幂等而收敛;门把阶段恢复时**已通过的门把跳过**、从停住那道续。应用启动时,引擎 SHALL 扫描持久化运行,把处于 `running` 的自动续跑(对齐「关软件自动暂停、重开自动恢复」)。

#### Scenario: 中途中断后从断点续而非重来
- **WHEN** 一个运行在某节点的某阶段被中断(关应用/崩溃),其后引擎重新加载该运行
- **THEN** 运行从该 `(节点, 阶段)` 续跑,已完成的上游节点与已过的门把不重做

#### Scenario: 开机自动恢复进行中的运行
- **WHEN** 应用启动且存在持久化的 `running` 运行
- **THEN** 引擎自动续跑它们,无需渲染层触发

#### Scenario: 门把进度按已过道数恢复
- **WHEN** 一个运行停在 `gate k`(0..k-1 已过),随后恢复
- **THEN** 从第 k 道门把续跑,0..k-1 不重跑

### Requirement: 引擎执行器——幂等的 ensure 操作

`engine` 执行者的每个操作 SHALL 实现为一个**幂等调谐器**:先**探测** git/fs 实际状态,已达目标即 no-op,否则补齐(reconcile-by-probe)。引擎 MUST 支持以下操作,各以「确保某状态成立」语义实现,且对「目标已达 / 目标未达 / 存在半成品残留」三态都安全收敛:

- `create-branch`:确保分支存在于期望基点。
- `open-worktree`:确保该分支在期望路径有 worktree(残留半成品先 prune/repair)。
- `link-env`:确保关联环境的 junction 存在且指向正确(指向错则清后重链)。
- `merge-branch`:确保来源已并入目标(在途合并先 abort);冲突为终局失败。
- `push-branch`:确保远端分支已是本地 HEAD;非快进/无远端为终局失败。
- `remove-worktree`:确保该 worktree 不存在——删前**无条件防御性解链**(见 `git-write-operations`)。
- `delete-branch`:确保本地分支不存在——若仍被 worktree 检出则**级联**先移除该 worktree;采用安全删,未合并为终局失败。
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

### Requirement: 失败的四种归宿

引擎处理一个操作的结果 SHALL 只有四种归宿,**绝不停在不可见、无继续路径的死结**:

1. **成功** → 推进下一阶段。
2. **自动处理**:瞬时失败(目录占用、网络抖动、锁等)**有限次**自动重试;某些环境性缺失(关联目标不存在、删云端分支失败)直接**跳过**并记提示。所有重试 MUST 有限次。
3. **交给 agent 自愈**:技术性失败(合并冲突、客观门失败、越界写入)路由给 agent。本能力**不实现** agent 自愈——这类失败是 agent 干活的下游产物,纯 git(无 agent 写代码)流程里不会自然发生;其分类与给 agent 的 prompt 作后续 proposal 的输入。
4. **人工拍板**:涉及**意图取舍 / 破坏性 / 凭据环境**的停顿 → 抛一个**人工决策**、运行进入 `waiting-decision`。

引擎 SHALL **优先自动、其次 agent、最后才打扰人**:只有第 4 类才抛人工决策。

#### Scenario: 瞬时失败有限次自动重试
- **WHEN** 某操作遇到瞬时失败(如 worktree 目录被文件句柄短暂占用)
- **THEN** 引擎按上限自动重试;在限内成功则继续,超限则转为人工决策

#### Scenario: 环境性缺失自动跳过不打扰
- **WHEN** 关联环境目标不存在,或删云端分支因不存在/无权限失败
- **THEN** 引擎自动跳过该步并记一条提示,不抛任何决策、运行继续

#### Scenario: 意图/破坏性失败抛人工决策
- **WHEN** 某操作遇到需人拍板的停顿(如删未合并分支、push 非快进、push 无远端)
- **THEN** 引擎抛出对应人工决策,运行进入 `waiting-decision`,不静默

### Requirement: 统一决策的结构与回应

引擎抛出的决策 SHALL 为一个**统一结构**,失败决策与人工门共用:含 `source`、**来源类型** `sourceKind`(`engine` 或 `agent`)、**背景说明**、一组**前进式选项**(各带 `id`、一句话 `label`、可选 `detail`、可选 `recommended`)、可选 `multi`(单选/多选)、可选 `input`(填空,如「远端仓库地址」)。

**选项一律前进式**:每个选项都使运行继续(继续/跳过本节点/重做/换法),决策 MUST NOT 含「中止」「暂不处理」这类使运行卡死、无继续路径的选项。

本能力产生的决策 `sourceKind` **恒为 `engine`**。**自填选项**(`allowCustom`)由消费方从 `sourceKind==='agent'` **派生**——引擎来源永不提供自填(引擎处理不了开放答案);`agent` 来源(future)才提供。引擎决策**不写指导文案**(如何配凭据等"指导"是 agent 的职责,future)。

用户回应 SHALL 为 `{ optionId? | optionIds? | text? }`;引擎按回应续跑(跳过/强制/重试/换参/先合并再删/按填入的地址配置远端等),并清除该待决策。

#### Scenario: 决策为统一结构且选项全前进式
- **WHEN** 引擎为某需人拍板的失败抛决策
- **THEN** 决策含 `sourceKind: 'engine'`、背景与一组前进式选项,**不含**「中止」类死结选项

#### Scenario: 需填信息的决策携带填空
- **WHEN** push 因无远端失败
- **THEN** 决策携带一个 `input`(标签「远端仓库地址」)与「跳过推送」选项;用户填入地址回应后,引擎配置远端并重推,或选跳过则继续

#### Scenario: 回应选项后按语义续跑
- **WHEN** 用户对一个待决策选定某选项(如删未合并分支选「先合并再删」)
- **THEN** 引擎按该选项语义继续(先合并再删),并清除待决策

#### Scenario: 引擎来源决策不提供自填
- **WHEN** 消费方渲染一个 `sourceKind: 'engine'` 的单选决策
- **THEN** 不提供「自填选项」(自填仅 `sourceKind: 'agent'` 时派生出现)

### Requirement: 人工评审门复用决策回路

**人工评审**门把 SHALL 复用统一决策结构(`sourceKind: 'engine'`):进入该门把时,引擎抛一个携带 `通过` 选项的决策,运行进入 `waiting-decision`;选「通过」则过门进下一阶段。它与失败决策共享同一运行态、同一断点恢复、同一回应入口。

**打回不在本能力内**:打回要回退到哪个节点需按工作流 + 内容判断(内容驱动回退 + 产物溯源),属后续能力;本能力的评审门只提供 `通过` 这一前进动作。

#### Scenario: 人工门抛决策并据通过过门
- **WHEN** 执行到一个人工评审门把
- **THEN** 运行进入 `waiting-decision` 并携带 `通过` 选项;用户选「通过」则过门推进

### Requirement: 一次性触发且可取消可恢复的 IPC 契约

引擎 SHALL 经 IPC 暴露:`start(运行请求) → { runId }`(**触发一次、立即返回**,不让渲染层 await 整个运行)、`pause(runId)`、`resume(runId)`、`decide(runId, { optionId? | optionIds? | text? })`、`getRunState(runId)`,以及一个 `progress` **事件通道**(推送节点/阶段进入退出、操作输出、需要决策等事件)。运行生命周期 MUST 由主进程(引擎)持有;渲染层只触发与观察,**关闭窗口 MUST NOT 终止或丢失运行**。

#### Scenario: 触发后立即返回且运行独立存活
- **WHEN** 渲染层调用 `start` 触发一个运行
- **THEN** 立即得到 `runId`,运行在主进程独立推进;期间关闭并重开窗口,运行不丢失,可经 `getRunState` 重新观察

#### Scenario: 经事件通道观察进度
- **WHEN** 一个运行推进(进入/退出节点与阶段、产生操作输出、抛决策)
- **THEN** 渲染层经 `progress` 事件通道收到对应事件

#### Scenario: 暂停与恢复经 IPC 控制
- **WHEN** 渲染层调用 `pause` 再 `resume` 某运行
- **THEN** 运行在阶段边界进入 `paused` 后又从断点续跑

### Requirement: 非引擎执行者在本能力内被跳过

引擎执行循环 SHALL 识别全部四类执行者(`agent`/`engine`/`command`/`subworkflow`),但本能力**只实现 `engine`**。遇到 `agent`/`command`/`subworkflow` 节点,引擎 MUST 发一条「执行器未落地、跳过」的进度事件并直接过到该节点 `done` 阶段,**不报错、不卡住**。这使含占位 agent 节点的工作流仍能端到端跑完 git 生命周期。

#### Scenario: 占位节点被跳过而非阻断
- **WHEN** 工作流含一个 `agent`(或 command/subworkflow)节点
- **THEN** 引擎发「跳过」进度事件并推进到下一节点,运行不因此报错或停滞
