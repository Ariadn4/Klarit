## MODIFIED Requirements

### Requirement: 引擎执行器——幂等的 ensure 操作

`engine` 执行者的每个操作 SHALL 实现为一个**幂等调谐器**:先**探测**实际状态,已达目标即 no-op,否则补齐(reconcile-by-probe)。操作的**内部实现可由确定性 git/worktree/fs 动作、或委派一个 agent、或跑命令任意支撑**——「引擎操作」是**平台预制的现成节点**(用户只需在下拉里择一并调参),其内部支撑是封装细节,引擎分派层按 `operation` 分流到对应实现。引擎为运行的**每个成员仓**各构造一套 ensure 上下文(各绑该成员的仓路径、逐仓解析的基分支);执行一个引擎节点时,SHALL 先按节点 `target`(见 `repo-targeting`)解析出成员仓子集,再对子集中每个成员各执行一次对应操作。引擎 MUST 支持以下操作,各以其语义实现,且对「目标已达 / 目标未达 / 存在半成品残留」三态都安全收敛:

- `create-branch`:确保分支(=卡 slug)存在于该成员仓自身主线为基的期望基点。
- `open-worktree`:确保该分支在期望路径有 worktree(残留半成品先 prune/repair)。
- `link-env`:确保关联环境的 junction 存在且指向正确(指向错则清后重链);亦用于联调——把兄弟成员仓 worktree 链进 hub worktree。
- `merge-branch`:确保来源已并入目标(在途合并先 abort);空/已合并分支报 no-op;冲突为终局失败。
- `push-branch`:确保远端分支已是本地 HEAD;非快进/无远端为终局失败;对空分支可 skip 以免建垃圾远端分支。
- `remove-worktree`:确保该 worktree 不存在——删前**无条件防御性解链**(见 `git-write-operations`)。
- `delete-branch`:确保本地分支不存在——若仍被 worktree 检出则**级联**先移除该 worktree;采用安全删,未合并为终局失败(由此天然回收未被改动成员仓的空分支、保护有真实工作的分支)。
- `delete-remote-branch`:确保远端分支不存在。
- `open-pr`:确保本运行涉及仓的 feature 分支在其托管平台上已开 PR/MR。此操作在**节点级委派一个 agent**(见 `agent-execution`)——该 agent **能看到所有涉及仓**(主仓 cwd + 其余仓 `--add-dir`,同 agent 节点的多仓布局),为**每个涉及仓各开一个** PR/MR:认平台(GitHub PR / GitLab MR / Bitbucket / Gitea / Azure / 自建)、用对的 CLI 或 API、从卡片信息写标题正文;幂等靠 agent「**先查已存在的 PR、有则不重开**」达成(非硬保证)。agent SHOULD 把各仓 PR/MR **链接经握手 `prs` 字段**(`[{ repo?, url }]`)回报;引擎 SHALL 收集这些链接**并对 agent 不守约兜底**——`prs` 缺失时从握手 `note`/`detail` 散文里正则捞 PR/MR 形态的 URL(GitHub `/pull/n`、GitLab `/merge_requests/n` 等),合并去重后**持久化到运行断点**(`prLinks`),供本节点外部门决策呈现为**可点击链接**(点击经 IPC 用系统浏览器打开)。**无可用默认 agent** 时为终局失败,抛人工决策并说明。此操作不施加本地 git 副作用。

> 「等平台把 PR 合并、合了才收尾」**不是**一个引擎操作,而是一道**外部门**(见「引擎执行外部门」);其平台无关的合并核查用 `git-write-operations` 的只读原语。

#### Scenario: 重复执行同一操作收敛为 no-op
- **WHEN** 对同一目标连续执行同一 ensure 操作两次
- **THEN** 第二次探测到目标已达、不重复施加副作用,状态不变,均标记成功

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

#### Scenario: open-pr 委派 agent 为每个涉及仓开 PR
- **WHEN** 一个涉及成员 A、B 的运行执行 `open-pr` 节点
- **THEN** 引擎在节点级委派一个能看到 A、B 两仓的 agent,为 A、B 各开一个 PR/MR;agent 先查已存在的 PR、有则不重开,回报各仓 PR 链接

#### Scenario: open-pr 无可用 agent 为终局失败
- **WHEN** 执行 `open-pr` 而未配置可用的默认 agent
- **THEN** 该操作为终局失败,抛人工决策说明原因,不静默跳过、不假装成功

#### Scenario: open-pr 不产生代码提交（分支尖不变）
- **WHEN** `open-pr` 委派的 agent 在 worktree 里留下了文件改动
- **THEN** 引擎**不把这些改动提交**(把 worktree 回到节点起始 SHA、丢弃改动),feature 分支尖保持 = 开 PR 前(已 push/PR)的状态——避免多出一个没进 PR 的本地提交、令后续「已合并」核查误判

### Requirement: 统一决策的结构与回应

引擎抛出的决策 SHALL 为一个**统一结构**,失败决策与人工门共用:含 `source`、**来源类型** `sourceKind`(`engine` 或 `agent`)、**背景说明**、一组**前进式选项**(各带 `id`、一句话 `label`、可选 `detail`、可选 `recommended`)、可选 `multi`(单选/多选)、可选 `input`(填空,如「远端仓库地址」)。

**选项一律前进式**:每个选项都使运行继续(继续/跳过本节点/重做/换法),决策 MUST NOT 含「中止」「暂不处理」这类使运行卡死、无继续路径的选项。

**每个决策 SHALL 恒带一个自由输入框**(不另设「继续问 AI」按钮——追问即在该框输入)。**人工评审门 / 外部门**的自由输入框即**打回入口**:写下不满意的点即触发内容驱动回退(见 `content-driven-rollback`),留空 + 选前进项则照旧过门/推进。用户 SHALL **选一个选项、和/或在自由输入框写内容,再提交才正式生效**。提交后:**只选内置选项、无自由文本** → 引擎按选项语义续跑;**含自由文本** → 转交 AI 处理,按有无当前 agent 路由:

- **当前有 agent 在跑本节点**(agent 节点提问/自愈超限,含正在跑的 heal agent)→ 把选中项/自由文本经**续接注入当前 agent**。
- **人工评审门 / 外部门的打回自由文本** → **内容驱动回退**(只读判定 → 回退确认 → 重入前向修复,见 `content-driven-rollback`)。
- **其余无当前 agent 的失败决策**(engine/command 失败决策、客观校验门失败决策)→ **新起一个读写处置 agent**(复用 agent 执行器、cwd = 卡工作区):喂「失败背景 + 用户自由输入」,令其**能改就改**(不自己提交,引擎提交后重跑该操作验证)、**不能改就经握手解释并把处置建议作为新选项交回用户**。

本能力产生的失败决策 `sourceKind` **恒为 `engine`**。引擎决策**不写指导文案**(如何配凭据等"指导"是 agent 的职责)。

用户回应 SHALL 为 `{ optionId? | optionIds? | text? }`;引擎按回应续跑(跳过/强制/重试/换参/先合并再删/按填入的地址配置远端/把自由文本注入当前 agent 或新起处置 agent 或转内容驱动回退等),并清除该待决策。

#### Scenario: 失败决策为统一结构且选项全前进式带自由输入
- **WHEN** 引擎为某需人拍板的失败抛决策
- **THEN** 决策含 `sourceKind`、背景、一组前进式选项与**一个自由输入框**,**不含**「中止」类死结选项

#### Scenario: 人工评审门渲染打回自由输入框
- **WHEN** 引擎为一道人工评审门抛决策
- **THEN** 该决策含唯一「通过」前进选项**与一个自由输入框**(自由输入框即打回入口,写下意见触发内容驱动回退;见 `content-driven-rollback`)

#### Scenario: 纯选项回应按语义续跑
- **WHEN** 用户对一个待决策只选某选项、未写自由文本(如删未合并分支选「先合并再删」)
- **THEN** 引擎按该选项语义继续(先合并再删),并清除待决策

#### Scenario: 有当前 agent 时自由文本注入当前 agent
- **WHEN** 一个决策当前有 agent 在跑本节点,用户写了自由文本并提交
- **THEN** 引擎把选中项/自由文本经续接注入当前 agent 续跑,而非丢弃

#### Scenario: 普通失败决策自由文本新起读写处置 agent
- **WHEN** 一个 engine/command 失败决策(非门、无当前 agent)被写入自由文本并提交
- **THEN** 引擎新起一个读写处置 agent(cwd = 卡工作区),喂「失败背景 + 用户自由输入」,令其改代码(引擎提交后重跑验证)或经握手解释并把建议作为新选项交回

#### Scenario: 需填信息的决策携带填空
- **WHEN** push 因无远端失败
- **THEN** 决策携带一个 `input`(标签「远端仓库地址」)与「跳过推送」选项;用户填入地址回应后,引擎配置远端并重推,或选跳过则继续

## ADDED Requirements

### Requirement: 引擎执行外部门（external gate）

引擎 MUST 支持门把模型的第三类门 **`external`（外部门，见 `workflow-definition`）**——它等待一个 **Klarit 控制不了的外部状态**达成。执行到一道外部门时,引擎 SHALL:

- **进门核查**该门声明的外部状态(`verify`;v1 支持 `pr-merged` → 用 `git-write-operations` 的只读合并核查,对本运行涉及仓逐仓判定,**全部涉及仓都达成才算达成**)。
- **达成 → 过门**(推进该节点后续门把 / 进 `done`,前向到清理)。
- **未达成 → 挂起**(运行进入 `waiting-decision`),抛一个决策,恒含一个前进式**「开始收尾」**选项——点它=**再核查一次**(达成则过门,仍未达成则再次挂起同一外部门)。该决策 `sourceKind` 为 `engine`,并带自由输入框(打回入口,见下)。
- 该「再核查」**将来 MAY 由外部信号(如平台 webhook)触发**;本能力只实现「用户点触发」,但外部门的过门判定 MUST 是「核查外部状态」而非「用户断言」,以便同一判定可被外部信号复用。

外部门的**打回**(自由输入框写下不满意的点)SHALL **复用人工评审门同一条内容驱动回退**(见 `content-driven-rollback`):退回之前节点前向修复,前向重流经 `push`/`open-pr`/外部门自然更新 PR 再核查。回退回落(无判定/取消)MUST **重抛本外部门**(而非评审门)。

外部门 MUST NOT 施加本地 git 副作用(核查只读);其过门不盲信用户,以核查为准。

#### Scenario: 外部门核查达成则过门
- **WHEN** 执行到一道 `external`(`verify: 'pr-merged'`)门,而涉及仓分支均已合并(已并入基分支或上游 `gone`)
- **THEN** 引擎判为达成、过门,前向推进到清理,不挂起

#### Scenario: 外部门未达成则挂起弹「开始收尾」
- **WHEN** 执行到该外部门而(某)涉及仓 PR 尚未合并
- **THEN** 运行进入 `waiting-decision`,抛含前进式「开始收尾」选项 + 自由输入框的决策,不记为失败;点「开始收尾」=再核查,达成才过门

#### Scenario: 外部门过门以核查为准、不盲信
- **WHEN** 用户点「开始收尾」而实际尚未合并
- **THEN** 引擎再核查判为未达成、再次挂起本外部门(不因用户点击就放行)

#### Scenario: 外部门打回走内容驱动回退并重抛本门
- **WHEN** 用户在外部门自由输入框写「HELLO.md 要加中文版」
- **THEN** 引擎转入内容驱动回退(只读判定 → 退回 `implement` 前向修复);判无候选/用户取消时**重抛本外部门**(而非评审门)

#### Scenario: open-pr 回报的 PR 链接在外部门决策上可点击
- **WHEN** `open-pr` agent 经握手 `prs` 回报了各仓 PR 链接,随后同节点的外部门未达成而挂起
- **THEN** 该外部门决策**附带这些 PR 链接**(引擎从断点 `prLinks` 取)、渲染为可点击项,点击用系统浏览器打开对应 PR;链接亦随断点持久化(恢复后仍在)
