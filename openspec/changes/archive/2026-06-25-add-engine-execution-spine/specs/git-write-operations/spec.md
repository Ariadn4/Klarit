## ADDED Requirements

### Requirement: 异步 git 运行器

系统 SHALL 提供一个**异步 git 运行器**,在指定目录下跑一条 git 子命令并返回**结构化结果** `{ code, stdout, stderr }`(退出码 + 捕获的标准输出/错误,均 trim)。它与既有只读同步运行器(`makeGitRunner`/`execFileSync`)**并存**,不取代之;写侧操作一律走异步运行器,避免阻塞主进程事件循环。运行器**不携带取消信号**(引擎操作跑到底、不被中途打断,见 `engine-execution`)。

#### Scenario: 成功命令返回退出码与输出
- **WHEN** 在一个 git 仓库目录下用异步运行器跑一条成功的 git 命令
- **THEN** 返回 `code=0` 与 trim 后的 stdout,Promise 正常 resolve(不抛)

#### Scenario: 失败命令以结构化结果返回而非抛错
- **WHEN** 跑一条非零退出的 git 命令(如在非 git 目录、或非法参数)
- **THEN** 返回非零 `code` 与 stderr 文本,Promise 仍 resolve(由调用方据 code 判定,不靠 try/catch 控流)

### Requirement: 写侧四件套(分支与 worktree 的增删)

系统 SHALL 提供四个 git 写原语,各为**纯函数式**封装(给定运行器与参数、返回结构化结果)、可独立测试:

- **建分支**:在指定基点创建分支。
- **加 worktree**:在指定路径检出指定分支为一个 worktree。
- **删 worktree**:移除指定路径的 worktree,并清理残留注册(`worktree prune`)。
- **删分支**:删除指定**本地**分支,采用**安全删**语义(未合并即拒绝,不强删)。

每个原语 MUST 返回足以让上层判定「成功 / 目标已处于期望态 / 失败原因」的结构化结果,使上层(`engine-execution` 的 `ensure-*`)能据此做幂等调谐。

#### Scenario: 建分支成功
- **WHEN** 在一个仓库以某基点建一个尚不存在的分支
- **THEN** 分支被创建并指向该基点,结果标记成功

#### Scenario: 加 worktree 成功
- **WHEN** 为某分支在一个空闲路径加 worktree
- **THEN** 该路径成为检出该分支的 worktree,结果标记成功

#### Scenario: 删 worktree 后清理残留注册
- **WHEN** 删除一个存在的 worktree
- **THEN** 该 worktree 目录被移除且其在 git 中的注册被清理(prune),后续 `worktree list` 不再含它

#### Scenario: 删本地分支用安全删语义
- **WHEN** 删一个**已合并**进当前/目标分支的本地分支
- **THEN** 删除成功
- **WHEN** 删一个**未合并**的本地分支(安全删)
- **THEN** 删除被拒绝、分支保留,结果带出「未合并」原因(供上层抛决策,不静默强删)

### Requirement: 合并分支(冲突即回到干净态)

系统 SHALL 提供一个**合并**原语:把来源分支合并进目标分支。当合并产生**冲突**或被打断而留下在途合并(`MERGE_HEAD` 存在)时,该原语(或其上层 ensure)MUST 能**中止合并**(`git merge --abort`)使工作树回到合并前的干净态,并以结构化结果报「冲突/已中止」,**不留半合并的脏索引**。当来源已并入目标(无可合并)时,MUST 报「已是最新」而非报错。

#### Scenario: 无冲突合并成功
- **WHEN** 把一个与目标无冲突的来源分支合并进目标
- **THEN** 合并完成,结果标记成功

#### Scenario: 冲突合并回到干净态并上报
- **WHEN** 把一个与目标冲突的来源分支合并进目标
- **THEN** 合并被中止、工作树回到合并前干净态,结果标记「冲突」(供上层抛固定决策)

#### Scenario: 已合并则报已是最新
- **WHEN** 来源分支已并入目标
- **THEN** 结果标记「已是最新」(幂等 no-op),不报错

### Requirement: 推送(非快进/无远端即结构化失败)

系统 SHALL 提供一个**推送**原语:把某本地分支推到远端,并提供推送**删除**远端分支的能力。当远端不存在、认证失败、或推送为**非快进**(远端先行)时,MUST 以结构化结果报对应失败原因,**不静默强推**;强推只在上层据用户决策显式选择时进行。

#### Scenario: 普通推送成功
- **WHEN** 把本地分支推到一个可达的远端、且为快进
- **THEN** 远端分支更新到本地 HEAD,结果标记成功

#### Scenario: 非快进推送以结构化结果上报
- **WHEN** 远端分支已先行,普通推送该分支
- **THEN** 推送被拒,结果标记「非快进」(供上层抛「先拉再推 / 强推 / 跳过 / 中止」决策),不自动强推

#### Scenario: 删除远端分支
- **WHEN** 推送删除一个存在的远端分支
- **THEN** 远端分支被删除,结果标记成功;若远端分支已不存在,标记「已不在」(幂等 no-op)

### Requirement: junction 链接与防御性解链

系统 SHALL 提供 junction(目录链接)的**链接**与**解链**原语,用于「关联环境」让 worktree 能完整运行验收:

- **链接**:在 worktree 内某路径建一个指向目标目录的 junction(Windows 用目录 junction、不需管理员;非 Windows 退化为符号链接)。
- **防御性解链**:在删除一个 worktree **之前**,**无条件**扫描该 worktree 树,找出其中每一个 reparse point(junction/符号链接)并**解链其本身**,且扫描 MUST **绝不递归进任何 reparse point 内部**。该扫描不依赖「我们记录过链接过什么」——即便 junction 是用户或 AI 越过本软件私自建立的,也 MUST 被解掉。

「绝不递归进 reparse point」是**安全不变量**:它保证删除 worktree 的过程永远不会顺着 junction 走进其目标(如真实 `node_modules`)而误删目标内容。

#### Scenario: 链接后可探测到指向
- **WHEN** 在 worktree 内某路径建一个指向某目标目录的 junction
- **THEN** 对该路径 `lstat` 判为链接、`readlink` 得到该目标(供 ensure-junction 做幂等探测)

#### Scenario: 删 worktree 前解掉自建 junction
- **WHEN** 一个 worktree 内含本软件建立的 junction,对其执行防御性解链
- **THEN** 该 junction 本身被解除、其目标目录内容**原封不动**,worktree 树随后可被安全删除

#### Scenario: 解掉越过软件私自建立的 junction
- **WHEN** 一个 worktree 内含一个**非**本软件建立的 junction(用户/AI 私自建),对其执行防御性解链
- **THEN** 该 junction 同样被扫到并解除(扫描基于实际 reparse point 而非记录),其目标内容原封不动

#### Scenario: 扫描绝不递归进 reparse point
- **WHEN** 防御性解链扫描遇到一个 reparse point
- **THEN** 解链其本身后**不**进入其内部继续遍历(故永不触达 junction 目标内的文件)
