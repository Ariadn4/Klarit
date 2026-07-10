## ADDED Requirements

### Requirement: 导入项目

用户 SHALL 能通过选择一个本地目录把项目导入 Klarit。导入时系统 MUST 以该项目主分支所在目录的文件夹名作为项目默认名，并把项目登记进已导入项目注册表。同一项目（按其持久身份判定）重复导入 MUST 不产生重复登记，而是复用既有条目。

#### Scenario: 选择目录导入新项目
- **WHEN** 用户在导入流程中选择一个尚未导入的本地目录
- **THEN** 系统以该目录的文件夹名作为项目名，并把它加入已导入项目注册表

#### Scenario: 重复导入同一项目不重复登记
- **WHEN** 用户导入一个其持久身份已存在于注册表中的项目（如换了路径的同一仓库）
- **THEN** 系统复用既有注册条目而非新建，并更新其记录的最新路径

### Requirement: 持久项目身份

每个入 git 的项目 SHALL 拥有一个持久且唯一的身份标识，写入项目内的 `.klarit/project-id`（随项目目录与 git 一起走）。注册表中的项目身份与卡片/状态数据 MUST 按此 ID 关联而非按路径，从而在移动目录、换机器、使用多个 worktree 时都不断链。

#### Scenario: 首次绑定生成身份文件
- **WHEN** 一个有 git 的项目被导入且尚无 `.klarit/project-id`
- **THEN** 系统生成唯一 ID 写入 `.klarit/project-id`，并以该 ID 在注册表中登记项目

#### Scenario: 移动目录后仍识别为同一项目
- **WHEN** 一个已绑定身份的项目被移动到新路径后再次被打开或导入
- **THEN** 系统通过 `.klarit/project-id` 识别为同一项目，复用其注册条目并更新记录路径

#### Scenario: 多 worktree 指向同一身份
- **WHEN** 同一仓库的另一个 worktree 被导入（其 `.klarit/project-id` 与主工作树一致）
- **THEN** 系统将其识别为同一项目身份，而非新建独立项目

### Requirement: git 检测与绑定

导入或打开项目时，系统 SHALL 检测该目录是否处于 git 仓库内；一旦查到 git 即 MUST 立即绑定，记录其主分支名以及（若存在）远程地址。系统 MUST 正确处理无 git、有 git 但未配置远程、有 git 且已推远程等多种情况，且不得因为缺少远程而拒绝绑定。

#### Scenario: 有 git 且已推远程
- **WHEN** 导入的项目处于 git 仓库中且配置了远程
- **THEN** 系统记录其主分支名与远程地址，并完成身份绑定

#### Scenario: 有 git 但未配置远程
- **WHEN** 导入的项目有 git 但尚未配置任何远程
- **THEN** 系统仍完成绑定并记录主分支名，远程记为缺省，不因无远程而失败

#### Scenario: 导入时无 git
- **WHEN** 导入的目录不在任何 git 仓库内
- **THEN** 系统仍把项目登记进注册表（以路径为基础标识），不创建 `.klarit/project-id`，并标记为「无 git」

### Requirement: git 出现后自动补绑

对于导入时尚无 git 的项目，当其目录之后变为 git 仓库（例如用户执行了 `git init`）时，系统 SHALL 在再次检测到 git 时立即补绑：生成并写入 `.klarit/project-id`、记录主分支与远程，并把注册表中原以路径标识的条目升级为以持久身份标识。

#### Scenario: 后续 git init 触发补绑
- **WHEN** 一个先前以「无 git」登记的项目，其目录此后被检测到已成为 git 仓库
- **THEN** 系统立即写入 `.klarit/project-id`、记录主分支与远程，并把该注册条目升级为按持久身份关联
