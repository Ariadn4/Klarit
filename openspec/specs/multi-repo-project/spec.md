# multi-repo-project Specification

## Purpose
TBD - created by archiving change support-multi-repo-project. Update Purpose after archive.
## Requirements
### Requirement: 项目由一个或多个成员仓组成

一个项目 SHALL 由 1..N 个**成员仓**（git 代码仓）组成。每个成员仓 MUST 各自拥有持久身份（沿用 `.klarit/project-id` 与既有 git 检测/补绑逻辑）；项目层面的**成员分组**MUST 存于 Klarit 管理数据（userData），不入 git。单仓项目是成员数为 1 的退化情形，其行为与扩展前一致。

#### Scenario: 单仓项目作为成员数为 1 的情形
- **WHEN** 导入一个单独的 git 仓库为项目
- **THEN** 系统建立一个仅含该仓为唯一成员的项目，对外行为与单仓时代一致

#### Scenario: 成员仓各自持久绑定
- **WHEN** 一个多仓项目的某个成员仓有 git
- **THEN** 该成员仓按既有逻辑获得自己的 `.klarit/project-id` 与 git 信息，独立于其它成员仓

#### Scenario: 分组存于 userData 不入 git
- **WHEN** 系统记录某项目的成员仓集合
- **THEN** 该成员分组写入 userData 注册表，不写入任何成员仓的 git

### Requirement: 导入含子仓的目录时自动组建多仓项目

当用户选择导入的目录**自身不是 git 仓库**、但其直接子目录中存在多个 git 仓时，系统 SHALL 检测出这些子仓并**直接**把它们组成一个多仓项目，无需任何确认步骤。组建时若这些子仓凭 `.klarit/project-id` 已属某既有项目，MUST 复用既有项目而非新建（见 `project-registry`）。组建后的项目以容器目录文件夹名为默认名；其项目目录由成员仓路径派生（见 `project-registry` 的「项目目录由成员仓路径派生」）。直接子目录中只有 0 或 1 个 git 仓时，仍按 gitless 容器登记为成员数为 1 的项目。

#### Scenario: 容器目录含多个子仓直接组建
- **WHEN** 用户导入的目录自身无 git，其下含 `frontend/`、`backend/` 两个 git 仓
- **THEN** 系统直接建立一个含 `frontend`、`backend` 两个成员仓的项目，各成员仓分别完成身份绑定，不弹确认提示

#### Scenario: 不足两个子仓按 gitless 容器登记
- **WHEN** 用户导入的目录自身无 git 且其下不足两个 git 子仓
- **THEN** 系统把该容器目录登记为单个 gitless 项目

### Requirement: 成员仓由项目目录下的子仓自动构成

成员关系是 Klarit 侧的分组元数据，磁盘内容才是事实来源——系统 MUST 对账而非掌管那些目录。成员仓由**项目目录下的 git 子目录**自动检测纳入（如 `/A` 下的 `/A/front`、`/A/back`），无需手动添加；系统**不提供**手动关联任意路径独立仓、也不提供在文件树视图里逐个解绑成员仓的用户入口。要增减成员仓，用户在项目目录下增减对应子目录即可，系统按磁盘对账跟随。整个项目的移除由「从项目列表中移除」在项目层级完成（见 `manage-projects-window`），且 MUST NOT 删除任何磁盘内容或 `.klarit/project-id`。

#### Scenario: 成员仓来自项目子目录
- **WHEN** 用户导入 `/A`（自身非 git），其下含 `/A/front`、`/A/back` 两个 git 子仓
- **THEN** 系统把 `front`、`back` 作为成员仓自动纳入项目，无需任何手动关联操作

#### Scenario: 增减子目录后成员随磁盘对账
- **WHEN** 用户在项目目录下新增或移走一个 git 子仓目录
- **THEN** 系统在下次检测/刷新时按磁盘对账更新成员集合，不需要手动关联或解绑

### Requirement: 项目目录在磁盘上缺失时的处理

当项目目录的记录路径在磁盘上已不存在（用户在 Klarit 之外删除或移动了它）时，系统 MUST NOT 崩溃或丢弃该项目。侧边栏文件树视图 SHALL 改为给出「项目目录找不到」的提示，并提供「从项目列表中移除」入口；单仓项目 MAY 额外提供「重新定位」以指向新路径。系统 MUST NOT 仅因路径缺失就自动从注册表清除该项目。

#### Scenario: 项目目录被外部删除后不崩溃
- **WHEN** 某项目的项目目录在 Klarit 之外被删除，用户随后打开/刷新该项目
- **THEN** 文件树视图显示「项目目录找不到」提示与移除入口，应用不崩溃，项目不被自动丢弃

#### Scenario: 缺失不自动清除
- **WHEN** 一个项目目录的路径暂时不存在
- **THEN** 系统保留其注册条目，不自动删除该项目

### Requirement: 多仓项目侧边栏以项目目录为文件树根

多仓项目的侧边栏文件树视图 SHALL 以**项目目录**为根，像资源管理器一样列出该目录下的全部文件夹与文件——其中的 git 子仓只作为普通文件夹出现，**不**再为每个成员仓加顶层分组层。单仓项目同样以其项目目录为根直接展示。（git 视图仍按成员仓选择分支，见 `app-shell-sidebar` 不变部分。）

#### Scenario: 多仓项目以项目目录为根展示
- **WHEN** 当前项目含多个成员仓且侧边栏文件树视图展开
- **THEN** 侧边栏以项目目录为根列出其下全部子项（子仓表现为普通文件夹），不显示按成员仓的分组层

#### Scenario: 单仓项目同样以项目目录为根
- **WHEN** 当前项目仅含一个成员仓
- **THEN** 侧边栏以其项目目录为根直接展示目录树，不加分组层

### Requirement: 移动或换机器后凭各仓身份复原分组

当多仓项目的成员仓被移动路径、或在新机器上重新导入时，系统 SHALL 凭各成员仓的 `.klarit/project-id` 重新识别它们，并据 userData 中（含云同步而来）的成员分组复原项目。

#### Scenario: 成员仓移动路径后仍归属原项目
- **WHEN** 某多仓项目的一个成员仓被移动到新路径后再次被打开或导入
- **THEN** 系统通过其 `.klarit/project-id` 识别为同一成员仓，更新其记录路径而不脱离原项目

#### Scenario: 换机器后分组复原
- **WHEN** 在同步了 userData 的新机器上重新导入各成员仓
- **THEN** 系统按各仓 `project-id` 与已同步的成员分组，把它们复原到同一项目下

### Requirement: 成员仓的标签标注

`RepoMember` SHALL 支持一个可选的 `tag` 字段(受控可扩展词表,如 前端/后端/配置/共享 SDK),用于工作流节点 `target=tag` 的解析。`tag` MUST 可由用户**手动设定/修改**(经写入口 `setMemberTag`,或直接编辑 registry.json)。`tag` 属项目管理数据,MUST 持久化到 `registry.json`(userData)、**不入 git**。缺省(未标注)合法,不影响单仓项目与 `target=all`/`target=repo` 的解析。

> 说明:由 agent 在成员识别时**自动推断**标签留作后续 change(本轮不做);本轮标签为手动设定。

#### Scenario: 用户手动设定标签
- **WHEN** 用户经写入口把某成员的 `tag` 设为「后端」
- **THEN** 标签写入该成员并持久化到 registry.json,后续 `target=tag` 解析按该标签生效

#### Scenario: 用户修改标签
- **WHEN** 用户把某成员的 `tag` 从「后端」改为「共享 SDK」
- **THEN** 修改持久化,后续 `target=tag` 解析按新标签生效

#### Scenario: 空串清除标注
- **WHEN** 用户把某成员的 `tag` 设为空串
- **THEN** 该成员的标签标注被清除,`target=tag` 不再命中它

#### Scenario: 标签缺省不影响其它解析
- **WHEN** 成员仓未标注 `tag`
- **THEN** `target=all` 与 `target=repo` 仍正常解析;仅 `target=tag` 不命中该成员

#### Scenario: 标签不入 git
- **WHEN** 某成员被标注标签
- **THEN** 标签仅存于 userData 的 registry.json,不写入任何成员仓的工作树或 git

