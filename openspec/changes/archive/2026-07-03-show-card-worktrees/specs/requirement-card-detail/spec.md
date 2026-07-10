## RENAMED Requirements

- FROM: `### Requirement: 卡上分支名仅在分支落地后展示并联动 git 视图`
- TO: `### Requirement: 卡上按成员仓展示已建分支并联动 git 视图`

## MODIFIED Requirements

### Requirement: 卡上按成员仓展示已建分支并联动 git 视图

需求卡的**预取名**只是"打算用的分支名",不代表已有分支;卡面 MUST NOT 在分支尚未创建时展示。仅当该卡的运行在某成员仓**真正建出该分支**(探测确认该成员仓本地分支存在)时,才 SHALL 为**每个已建出分支的成员仓各展示一个可点条目(chip)**;多个成员仓的条目 SHALL **内联平铺**(不折叠)。

条目 SHALL 以「**成员仓名/分支名**」标识(如 `web/test-create-card`)。分支名 MUST 是**引擎实际使用的分支名**(统一递增避撞后可能与预取名不同,见 `engine-execution`),而非预取名。**展示门控是「分支已建出」而非「worktree 已建出」**——分支一建出即展示,不等 worktree。

每个条目 SHALL **可点击**:点击后侧边栏切到 git 视图并**程序化聚焦**到 (该条目对应的成员仓, 该分支)(见 `sidebar-git-view`)——聚焦到点中的那个成员仓,而非一律首仓:

- 该分支**已建出 worktree** → git 视图展示其 worktree 目录文件树。
- 该分支**尚未建出 worktree** → git 视图展示「暂未创建 worktree」空态(复用 `sidebar-git-view` 既有空态),而非跳转失败或空白。

某成员仓的**分支被删除**(如交付后 `delete-branch`)后,其条目 SHALL 从卡面消失(卡面仅展示当前实际存在分支的成员仓);worktree 被单独回收但分支仍在时,条目**仍在**、点击落到「暂未创建 worktree」空态。面板 MUST 遵循 `docs/brand` 与设计令牌(仅语义令牌、深浅双主题)。

#### Scenario: 分支未建出时不展示
- **WHEN** 一张卡尚未运行、或运行尚未在任何成员仓建出分支
- **THEN** 卡面不展示任何分支条目(预取名不作分支展示)

#### Scenario: 分支建出即按成员仓内联平铺展示条目
- **WHEN** 一张卡的运行已在成员仓 A、B 各建出分支(worktree 尚未建)
- **THEN** 卡面为 A、B **各展示一个可点条目**、内联平铺,条目以「成员仓名/分支名」标识,分支名为引擎实际使用的分支(非预取名)

#### Scenario: 点条目且 worktree 已建 → 定位其 worktree
- **WHEN** 用户点击成员仓 B 的条目,且 B 的该分支已建出 worktree
- **THEN** 侧边栏切到 git 视图并聚焦到 (成员仓 B, 该分支),下方展示其 worktree 目录文件树

#### Scenario: 点条目但 worktree 未建 → git 视图给「暂未创建 worktree」空态
- **WHEN** 用户点击成员仓 B 的条目,而 B 的该分支尚未建出 worktree
- **THEN** 侧边栏切到 git 视图并聚焦到 (成员仓 B, 该分支),git 视图展示「暂未创建 worktree」空态(不崩溃、不空白)

#### Scenario: 成员仓分支被删除后其条目消失
- **WHEN** 某成员仓的该分支被 `delete-branch` 删除
- **THEN** 该成员仓的条目从卡面消失,其余仍有该分支的成员仓条目照常展示

#### Scenario: 单仓卡退化只展示一个条目
- **WHEN** 一张单仓卡的运行建出其唯一成员仓的分支
- **THEN** 卡面展示一个条目(该唯一成员仓名/分支),点击聚焦到该唯一成员仓的 (分支, worktree 或空态)
