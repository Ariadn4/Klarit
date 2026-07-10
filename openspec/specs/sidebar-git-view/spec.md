# sidebar-git-view Specification

## Purpose

侧边栏的 git 视图能力：一个**只读预览器**，让用户在侧边栏内查看不同成员仓、不同分支对应 worktree 目录的文件，而**不修改 git 状态或工作区**。视图切换入口与持久化由 `app-shell-sidebar` 能力定义，本能力定义 git 视图内的展示与交互。

## Requirements

### Requirement: git 视图展示成员仓、选中分支与 worktree 文件树

git 视图是一个**只读预览器**（类似资源管理器），仅用于查看不同成员仓、不同分支对应 worktree 目录的文件，**不修改 git 状态或工作区**。当侧边栏处于 git 视图时，侧边栏 SHALL 在顶部展示**当前成员仓名**与**当前选中分支**（形如 `🖥 仓名  ⑂ 分支名`），其下 SHALL 展示该分支对应 **worktree 目录的文件树**。worktree 文件树 MUST 反映该目录在磁盘上的实际内容，并对其内的增删改在合理时延内更新。当当前成员仓不是 git 仓库（无 git）时，git 视图 MUST 给出明确的「该成员仓无 git」提示，而非展示空白或崩溃。

#### Scenario: 切到 git 视图展示成员仓与分支

- **WHEN** 用户把侧边栏切换到 git 视图，且当前项目至少有一个成员仓
- **THEN** 侧边栏顶部显示当前成员仓名与当前选中分支，下方显示该分支对应 worktree 的文件树

#### Scenario: worktree 文件树随磁盘变更同步

- **WHEN** git 视图下当前 worktree 的目录内发生新增、删除或重命名
- **THEN** worktree 文件树在监听到变更后更新以反映最新内容

#### Scenario: 当前成员仓无 git 时给出提示

- **WHEN** git 视图下的当前成员仓不是 git 仓库
- **THEN** 侧边栏在 git 视图区显示「该成员仓无 git」之类的明确提示，不展示分支与 worktree 文件树

### Requirement: 点击成员仓名切换当前成员仓

git 视图顶部的**成员仓名 SHALL 可点击**，点击后弹出当前项目的全部成员仓列表（当前成员仓带勾选标记）。用户选择某个成员仓后，git 视图 MUST 切换到该成员仓，并刷新其分支与 worktree 文件树。当前选中的成员仓 MUST 按窗口持久化。

#### Scenario: 弹出成员仓列表并切换

- **WHEN** 用户点击 git 视图顶部的成员仓名
- **THEN** 弹出该项目全部成员仓的列表，当前成员仓带勾选标记

#### Scenario: 选择另一成员仓后刷新

- **WHEN** 用户在成员仓列表中选择另一个成员仓
- **THEN** git 视图切换到该成员仓，顶部分支与下方 worktree 文件树刷新为该成员仓的内容

#### Scenario: 单仓项目仍可正常工作

- **WHEN** 当前项目仅含一个成员仓且用户处于 git 视图
- **THEN** 顶部仍展示该唯一成员仓名（点击列表中仅该仓且带勾选），分支与 worktree 文件树正常展示

### Requirement: 点击分支名切换所预览的 worktree（只读）

git 视图顶部的**分支名 SHALL 可点击**，点击后弹出当前成员仓的**本地分支**列表（当前选中分支带勾选标记）。本能力是**只读预览器**：选择某个分支 MUST 仅切换「下方文件树所展示的 worktree 目录」，**绝不**执行 `git checkout`、`switch` 等任何修改工作区或 git 状态的操作，与工作区是否有未提交改动无关。各分支对应的 worktree 目录由 `git worktree list` 解析得到。当所选分支没有对应的 worktree（其文件未在任何 worktree 检出）时，git 视图 MUST 给出明确空态提示（如「该分支无 worktree」）而非崩溃或展示其它分支内容。分支列表 SHALL 只列本地分支，不含远端跟踪分支与 tag。当前选中分支 MUST 按窗口持久化。

#### Scenario: 弹出本地分支列表

- **WHEN** 用户点击 git 视图顶部的分支名
- **THEN** 弹出当前成员仓的本地分支列表，当前选中分支带勾选标记，不含远端分支与 tag

#### Scenario: 选择另一分支后切换所预览的 worktree

- **WHEN** 用户在分支列表中选择另一个有对应 worktree 的分支
- **THEN** git 视图顶部分支名更新，下方文件树刷新为该分支 worktree 目录的内容，过程中不发生任何 git checkout/switch 等工作区修改

#### Scenario: 所选分支无 worktree 时给出空态

- **WHEN** 用户选择的分支没有对应的 worktree 目录
- **THEN** git 视图显示「该分支无 worktree」之类的空态提示，不崩溃也不误展示其它分支内容

### Requirement: git 视图选择项按窗口持久化

git 视图下当前选中的**成员仓**与**分支** MUST 按窗口持久化，下次打开该窗口并切到 git 视图时恢复上次的选择。当持久化的成员仓或分支在磁盘上已不存在时，系统 MUST NOT 崩溃，SHALL 回退到一个有效的默认选择（如该项目的首个成员仓与其当前分支）。

#### Scenario: 跨会话恢复 git 视图选择

- **WHEN** 用户在 git 视图选定某成员仓与分支后关闭软件再重新打开并切到 git 视图
- **THEN** git 视图恢复到上次选中的成员仓与分支

#### Scenario: 持久化选择失效时回退

- **WHEN** 上次持久化的成员仓或分支已不存在
- **THEN** 系统回退到一个有效的默认选择，不崩溃

### Requirement: 程序化聚焦到指定成员仓与分支的 worktree

git 视图 SHALL 提供一个**程序化聚焦**入口,供外部(如点击需求卡上的分支名)请求把侧边栏切到 git 视图并把其选择**定位到指定的(成员仓, 分支)**对应的 worktree。该入口 MUST 复用既有的"选成员仓 / 选分支只读预览 worktree"机制:聚焦只切换所预览的 worktree 目录,**绝不**执行 `git checkout`/`switch` 等修改工作区或 git 状态的操作;当目标分支无对应 worktree 时,复用既有「该分支无 worktree」空态而非崩溃;聚焦后的选择同样按窗口持久化。目标成员仓不属当前项目、或目标分支不存在时,MUST 安全回退(给空态/提示),不崩溃。

#### Scenario: 程序化聚焦切到 git 视图并定位 worktree
- **WHEN** 外部以一个(成员仓, 分支)请求聚焦,且该分支在该成员仓有对应 worktree
- **THEN** 侧边栏切到 git 视图,顶部成员仓与分支更新为目标,下方文件树刷新为该分支 worktree 目录内容,过程中不发生任何 git checkout/switch

#### Scenario: 聚焦目标分支无 worktree 时给空态
- **WHEN** 外部请求聚焦的(成员仓, 分支)没有对应 worktree
- **THEN** git 视图复用「该分支无 worktree」空态提示,不崩溃、不误展示其它内容

#### Scenario: 聚焦目标无效时安全回退
- **WHEN** 外部请求聚焦的成员仓不属当前项目,或分支不存在
- **THEN** 系统安全回退(空态/提示或回落有效默认选择),不崩溃
