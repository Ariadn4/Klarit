## ADDED Requirements

### Requirement: 自动 author 产出经固定脚手架规整(头尾写死、中间为其生成的干活段)

自动（导入后）author 产出的工作流,系统 SHALL 经**固定脚手架规整**成最终提案——即把 author 产出里的**干活节点当作中间**喂给 `buildScaffoldedWorkflow`,由它套上**固定头**（建分支→开 worktree→关联环境）与**固定尾**（人工验收门 → 归档 `archive-docs` → 合并/推送/清理,按变体），顺序钉死为 **中间→验收门→归档→合并→清理**。author 产出里的**脊柱类节点**（分支/worktree/合并/推送/清理/归档/验收门）SHALL 被脚手架**丢弃并以固定脊柱替换**（比照 `repairWorkflow` 丢非法节点）——故 author 把脊柱摆错也无所谓,结构由脚手架保证。规整后仍走 `repairWorkflow`+`validateWorkflow`+`checkBranchPairing` 兜底。

- **变体**：由 author 产出推断（含 `open-pr` → `pr`,否则 `local-merge`；缺省 `local-merge`）。
- **归档清单**：从 author 产出的 `archive-docs` 节点的 `executor.archiveDocs` 抽出,带进脚手架的归档节点（无则空、走扫描兜底）。
- **聊天写工作流路不变**（仍产整份、用户全权控制、不走脚手架规整）。

> 机制注:让 author 照旧产整份、再确定性规整到脚手架——比改 author 的产出契约(只产中间)更稳,结果等价(头尾固定、中间是 author 生成的干活段)。

#### Scenario: author 产出被规整成固定脚手架

- **WHEN** 自动 author 产出一份工作流（脊柱可能摆错）
- **THEN** 系统把其干活节点当中间、套固定头/尾,产出 中间→验收门→归档→合并→清理 的合法提案

#### Scenario: 脊柱位置永远正确(结构消灭排序问题)

- **WHEN** 任何自动 author 产出经脚手架规整
- **THEN** 验收门在合并前、归档在验收后合并前、清理在最后——位置由脚手架固定,author 摆错被替换

#### Scenario: author 脊柱/验收/归档节点被替换

- **WHEN** author 产出里含自己的 `merge-branch`/验收门/`archive-docs` 等脊柱节点
- **THEN** 规整丢弃它们、以固定脊柱替换（archive 清单从其 archive-docs 节点抽出后带入固定归档节点）

#### Scenario: 聊天路不走脚手架

- **WHEN** 用户在全局聊天里写/改工作流
- **THEN** 仍产整份 `WorkflowDefinition`,不套脚手架规整

#### Scenario: 自动 author 产中间被脚手架拼成整份

- **WHEN** 自动 author 产 `{ variant:'local-merge', middle:[...干活...], archiveDocPaths:[...] }`
- **THEN** 系统拼成:固定头 + middle + 验收门 + archive-docs(带清单) + 合并/推送/清理,顺序为 中间→验收门→归档→合并→清理,过两闸校验

#### Scenario: 脊柱位置永远正确(结构消灭排序问题)

- **WHEN** 任何自动 author 产出经脚手架装配
- **THEN** 验收门在合并前、归档在验收后合并前、清理在最后——位置由脚手架固定,LLM 产不出错位

#### Scenario: middle 混入脊柱节点 → 丢弃

- **WHEN** author 的 `middle` 里误含 `merge-branch`/`create-branch` 等脊柱节点
- **THEN** 装配丢弃这些、只保留干活类节点

#### Scenario: 聊天路不走脚手架

- **WHEN** 用户在全局聊天里写/改工作流
- **THEN** 仍产整份 `WorkflowDefinition`,不套脚手架

### Requirement: 写工作流 skill 教归档规范(列清单 + 优先项目自带 + 通用不点名)

`buildAuthorWorkflowSkill` SHALL 正向、讲原因地加轻量**归档规范**(脊柱由脚手架规整,故 skill 只需管归档这块的内容质量):

- 归档**尽量只一个文档归档节点**；
- **项目若有自己的归档/沉淀方式,优先用它**（措辞**通用**,MUST NOT 点名具体技能名,例子只轻点）；
- 它没覆盖到的文档,在 `archive-docs` 节点里**把该归档的文档路径列进清单**（`executor.archiveDocs`),这样归档直接按清单走、免二次扫描；
- 归档**不设门**（脚手架已保证归档在人工验收之后,author 不必自己摆位置）。

#### Scenario: skill 教归档规范

- **WHEN** 合成写工作流 skill
- **THEN** 文本正向说明「优先项目自带归档(通用不点名)、尽量单归档节点、没覆盖的文档在 archive-docs 里列清单、归档不设门」及原因

#### Scenario: 措辞通用不点名

- **WHEN** skill 讲优先用项目自带归档
- **THEN** 用「项目自己的归档方式」这类通用措辞,不写死某个具体技能名

### Requirement: 提案预览浮层主操作为「保存并设为本项目工作流」一键

工作流提案预览浮层（chromeless 底栏）的**主操作** SHALL 由原「保存为正式工作流 → (二次确认) 设置为本项目工作流」两步**合并为一键**:

- 当这份工作流**尚不是**当前项目的活动工作流时,主按钮显示「**保存并设为本项目工作流**」,点击 SHALL **先保存入库、再激活为本项目工作流**(一次点击完成);保存被校验拦下则不激活、回报原因。
- 当它**已是**当前项目活动工作流时,主按钮显示「**更新工作流**」(仅保存/更新,不必再激活)。
- 底栏保留「关闭」;**移除**原独立的「设置为本项目工作流」按钮与其二次确认步骤(一键即人确认)。

此改仅作用于**提案预览浮层**(chromeless 底栏);设置里的工作流编辑（顶栏保存）不受影响。

#### Scenario: 未激活 → 一键保存并设为本项目工作流

- **WHEN** 预览浮层里这份工作流尚不是当前项目活动工作流,用户点主按钮「保存并设为本项目工作流」
- **THEN** 系统先保存入库、再 `setActiveWorkflow` 激活到当前项目(一次点击);之后按钮变为「更新工作流」

#### Scenario: 已是活动工作流 → 主按钮仅「更新工作流」

- **WHEN** 这份已是当前项目活动工作流
- **THEN** 主按钮显示「更新工作流」,点击仅保存/更新

#### Scenario: 保存校验不过 → 不激活

- **WHEN** 点「保存并设为本项目工作流」但保存被语义校验拦下
- **THEN** 回报原因、不激活、不写盘

#### Scenario: 设置里编辑不受影响

- **WHEN** 在设置里编辑库中工作流(非 chromeless 预览)
- **THEN** 仍是顶栏保存那套,无此合并按钮

### Requirement: 自动 author 被喂项目文档枚举、产出 archive-docs 分类配置

自动 author 运行时,系统 SHALL 把**项目文档枚举**(复用 `scanCandidates` 的**廉价文件遍历**,无 agent)注入 author 上下文,使 author 无需自行发现文档。author SHALL 据此为 `archive-docs` 节点产出**分类文档配置** `[{ path, kind: 'dynamic'|'snapshot' }]`:

- **剔除**项目自有归档方式已覆盖的文档(不重复归);
- 剩余文档各判 `dynamic`(就地更新现状)/ `snapshot`(冻结追加);
- 写进 archive-docs 节点配置(经脚手架规整时带入固定归档节点)。

如此归档配置随工作流一次产出,自动流**无需独立的文档分析 agent、激活时不触发扫描**。skill 相应教 author 此产出方式(措辞通用、不点名具体技能)。

#### Scenario: 喂枚举、author 产分类配置

- **WHEN** 自动 author 运行,系统注入项目文档枚举
- **THEN** author 剔除项目自有归档覆盖的文档、把剩余分动态/快照,产出 archive-docs 的 `[{path,kind}]` 配置

#### Scenario: 配置随工作流产出、免二次扫描

- **WHEN** 自动 author 产出含分类配置的 archive-docs
- **THEN** 该配置经脚手架带入固定归档节点,激活/运行时按配置归档,不触发独立文档分析 agent
