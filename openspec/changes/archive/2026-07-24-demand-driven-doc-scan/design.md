# 设计:需求驱动文档扫描

## 出发点(调研结论)

`auto-workflow-on-import` 的 task 14.1 调研已实锤:**文档登记表运行时只被 `archive-docs` 一个引擎操作消费**(`getDocRegistry` 唯一调用方 `runArchiveDocsNode`;`conventionPreamble`/`docs`/`habitPrompt` 不进编排/分解/agent 上下文)。故「工作流不含 archive-docs → 文档扫描白做」。当前却每次首次导入无条件扫。

## 两步改动

### 1. 翻转触发链:导入 → 先 author(不再扫完再 author)

现状:`import → 文档 onboarding 弹 → analyze 返回 → 触发 runWorkflowOnboarding`(为单默认 agent 档期串行,才排在扫描后)。

改为:`import → 触发 runWorkflowOnboarding(author 第一个占 agent)`。文档扫描不再是 author 的前置。**串行仍成立**:author 先占默认 agent,若之后需要扫描,扫描再占。author 本就靠 `--add-dir` 自己读项目(不依赖登记表),所以不需要扫描先行。

### 2. 文档扫描改需求驱动:含 archive-docs 的工作流被激活才扫

**核心判据**:文档扫描/onboarding 的触发信号 = **一个含 `archive-docs` 节点的工作流成为项目活动工作流**,且该项目**尚无登记表**。

- 采纳自动提案 / 聊天产出 / 设置里选定 / 兜底默认——凡 `setActiveWorkflow` 到一个含 archive-docs 的 def,若无登记表则触发扫描去 populate。
- 兜底默认(本地直合)**不含** archive-docs → 不触发扫描(常见路径直接免扫)。
- opsx 项目的工作流用 `opsx:archive`(agent 节点)而非引擎 `archive-docs` → 不触发扫描。

判「是否含 archive-docs」= 纯结构:`def.nodes.some(n => n.executor.kind==='engine' && n.executor.operation==='archive-docs')`。

## 关键岔口(请拍板)

**扫描的确切时机**,有几个选项,影响 UX 和实现:

- **A(推荐)激活即扫**:`setActiveWorkflow` 到含 archive-docs 的 def 且无登记表 → 立刻触发扫描/onboarding。优点:登记表在真跑到该节点前就备好、`archive-docs` 不会因缺表挂起;时机明确。缺点:采纳含 archive-docs 的工作流后会紧接一次扫描(但这正是「需要它」的时刻,不算突兀)。
- **B 懒扫**:不预扫,等 `run` 真跑到 archive-docs 节点、发现无登记表时才触发扫描。优点:最省(连激活了也可能一直没跑到)。缺点:扫描插在任务执行中途,体验割裂;`archive-docs` 的「无表挂起」兜底会先触发一下。
- **C 采纳时扫**:仅在「用户采纳自动提案」这条路检查+扫,不管其它激活路径。优点:窄、简单。缺点:漏掉聊天/设置激活含 archive-docs 工作流的情形。

**我推荐 A**:与「重大步骤前备好资料」一致,时机明确、不打断任务执行;实现上挂在 `setActiveWorkflow`(所有激活路径的单一收口)最干净。B 的中途扫描体验差;C 覆盖不全。

## 触发点与 onboarding UX 的连带改动

- **移除**首次导入的无条件 `notifyDocumentsOnboard`/`maybeDocOnboard` 自动扫。
- 需求驱动触发命中时,仍复用现有 `DocumentOnboardingDialog`/`analyze` 那套(只是**触发时机**变了:从「导入即弹」变「激活含 archive-docs 工作流时弹」)。
- `DocumentRegistrySettings` 的**手动重扫**保留(用户想随时扫都行)。

## 与既有兜底的关系

`archive-docs` 运行时已有「无登记表/无 agent → 失败挂起给清楚提示」(见 `document-archive`)。A 方案把 populate 前移到激活时,使正常路径下跑到 archive-docs 时表已备好;那条兜底仍在、作为「用户跳过了扫描/激活后没扫成」的最后防线,不删。

## 不在本 change

「预制 `archive-docs` 退兜底、优先用项目自带归档(opsx:sync+archive、changelog、ADR)」——归**步骤 2 `workflow-from-habits`** 的 skill 打磨。两者互补:**本 change 决定「扫不扫」(按工作流用不用 archive-docs);步骤 2 影响「工作流用不用 archive-docs」(教 author 优先项目自带)。** 步骤 2 落地后,吃 opsx 的项目会更少产出 archive-docs,本 change 的「免扫」命中率随之更高。
