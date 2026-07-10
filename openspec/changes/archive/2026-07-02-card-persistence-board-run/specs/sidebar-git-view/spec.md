## ADDED Requirements

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
