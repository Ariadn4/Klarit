# 设计:导入后自动派工作流

## 判据(单一信号,不是新旧两轴)

真正的判据不是「项目新旧 × agent 有无」两轴,而是**一条**:

> 这项目身上有没有可读的 agent 习惯痕迹,且本机有没有能跑的 agent。

```
首次导入(非 reused)完成
      │
      ▼  文档语义分析 agent 返回(agent 腾出档期)
      │
      ├─ 该项目任一成员仓有痕迹标记?     ── 否 ──┐
      │        (.claude/ CLAUDE.md .cursor/       │
      │         AGENTS.md .codex .github/)         │
      │  是                                        │
      ▼                                            │
      ├─ 设了默认 agent 且它在 detectedAgents 里? ─ 否 ─┤
      │  是                                        │
      ▼                                            ▼
   无头 author:系统合成意图               派内置默认工作流(本地直合)
   「照这项目的习惯写工作流」              作为活动工作流
      │
      ▼
   WorkflowProposal(经 repairWorkflow+两闸校验)
      │
      ▼
   主动弹出 → WorkflowEditor 浮层预览
      │
      ├─ 采用 → 保存入库 + setActiveWorkflow
      └─ 弃 / 关 → 保持默认工作流(不留半成品激活)
```

「新项目」只是「没痕迹」的一个特例——空目录天然没 `.claude`/`CLAUDE.md`,自然落到默认支。所以**不需要单独判断新旧**。

## 关键决策

### 1. 触发时机 = 文档分析 agent 返回,不是用户点保存

排在文档扫描之后的理由是 **agent 档期串行**,不是数据依赖:全局只有一个默认 agent,文档语义分析(`IPC.documentsAnalyze` → `analyzeDocuments`)正占着它。**author agent 会自己去翻项目**(`.claude/`、`CLAUDE.md`、`git log`),不需要审批过的 `conventionPreamble`,所以不必等用户在 `DocumentOnboardingDialog` 里点「保存」。

因此触发点钉在**主进程 `IPC.documentsAnalyze` handler 返回那一刻**(`src/main/index.ts:1168`),此时分析 agent 已释放。用户还在慢慢审阅 doc dialog 时,写工作流已在后台跑。

> 反面约束:**不要**因为「看起来能并行就并行」把 author 与文档分析同时跑——会双占默认 agent。串行是有意的。

### 2. 痕迹探测只做门控,不做抽取

痕迹探测是一个**廉价的存在性检查**(`fs.existsSync` 级),只回答「有没有东西可学」,用来决定**要不要为这项目花一次 agent**。它**不读内容、不解析、不喂给 agent**——深读与解读是 author agent 自己的活(这是第一步「靠 agent 本事」的核心)。

标记集(项目级,多仓任一命中即算有习惯):`.claude/`、`CLAUDE.md`、`.cursor/`、`AGENTS.md`、`.codex`、`.github/`(以及可扩展的少量已知痕迹)。项目级 = 只看成员仓根目录,不碰用户 home(`~/.claude`),与「项目级习惯」的定位一致。

### 3. 无头 author:复用 seam,只改调用侧

`createOrchestrateSeam(deps, produce).orchestrate({ intent, conversationId? }, projectId)` 的 `intent` 本就是任意字符串。现有 `runOrchestrateTurn`(`index.ts:1327`)从发送者事件取 `pid`、并把结果追加进用户会话——这两点是耦合。抽出一个 **projectId-显式、不追加用户会话** 的核:

```
authorWorkflowForProject(projectId, intent) -> WorkflowProposal | null
```

系统合成意图(第一步用直白版,措辞的打磨归第二步):

> 「这是一个已有项目。请查看它平时怎么使用 AI 编程 agent(如 .claude/、CLAUDE.md、.cursor 等)与它的 git/交付习惯,据此为它写一份贴合的 Klarit 工作流。」

产出仍走 `buildWorkflowProposal` → `repairWorkflow` + `validateWorkflow` + `checkBranchPairing`,拿到永远合法的 def + `issues[]`。

### 4. 提案主动露出:底栏进度 + 排队不叠加

现在提案只在会话流里露(`GlobalChatPanel` 渲染 `WorkflowProposalReview`),后台产出的提案没有推送通道。新增一条 main→renderer 事件(比照 `documentsOnboard`,`ipc.ts:223` / `index.ts:1126`),载荷 `WorkflowProposal`。渲染层订阅后复用 `WorkflowPreviewModal` 整套预览-编辑-保存-设为项目工作流。**不**塞进聊天会话——避免依赖「用户开着聊天面板」。

**弹出时机(实测反馈校正)**:工作流生成是后台异步,曾在用户**正看文档 onboarding** 时直接弹出、叠加两个模态,体验割裂。改为对齐文档扫描的呈现逻辑:

- **进度进底栏**:生成期间在底栏状态区显示进度(比照文档扫描状态),不打断。
- **排队、不叠加**:得到可用提案后,若此刻**无**全局模态在开则弹预览;若**有**则**排队**,待当前模态关闭再弹。为此引入一个轻量**全局模态协调器**(渲染层小 store):记录「当前是否有模态在开」+ 一个待弹队列;模态关闭时出队顺次弹。这条能力对未来别的主动弹出同样适用。

**为何不选「文档+工作流都好才统一弹」**:那会被两个异步任务里较慢的一个拖住,拖慢用户看文档的决定;而占位默认工作流已让项目**秒级可用**,定制提案作为「升级」在用户一空出来就弹,既不慢也够显眼。统一弹既慢又把两件独立事耦死,弃。占位是**真能跑的正经流**、非降级,故「先用默认」不构成差体验。

### 5. 写工作流约束的措辞哲学(正向、讲原因、例子别太满)

给 author 的搭流约束一律**正向措辞 + 讲清原因**,不用负向禁止句(负向易致幻),例子只做轻点、不写满(过细例子会让 agent 不再自行外推到相邻情境)。本 change 补两条:

- **连续作业交同一节点**:一段要靠 agent 保持上下文、据即时反馈逐步收敛的工作(如边写测试边据结果改实现直到达成),交给**同一个** agent 节点——它才有连续上下文与反馈闭环把事做到位;需要分节点是当各段间有明确交接产物或换了执行者时。
- **固化排在拍板之后**:会让改动离开可回退工作区的步骤(合入主线、对外公开、封存归档等)一旦做了难收回,故安排一道**人工验收**在这些固化步骤之前,先经人确认再固化。

### 6. 工作流软校验:结构可判才兜,红门认栽

诉求是「即便 prompt 调好,用户**手动**也可能改出坏流,能否代码兜住并提示」。分两半:

- **红门(期望失败)不可结构判**:`auto` 门 = `{ check }`,`check` 是 inline 命令串或规则库引用,**通过条件写死为退出码 0、无取反字段**。用户想做红门只能把取反藏进命令文本——不可靠地识别,至多脆弱字符串启发式,ROI 低,**不做**;仅留 prompt 约束。
- **排序/配对可结构判**:节点有执行序,不可逆固化操作集已知,「某 `manual` 门是否在其前(含其上)」是可判的。故加一层**软校验**(比照 `checkBranchPairing` 的「可加载但有隐患」),非阻断、经 `WorkflowSummary.warnings` 在编辑器/选择器提示。首条:存在不可逆固化操作而其**之前及该节点自身**都无 `manual` 门 → 告警「固化前缺人工验收」。软校验**不阻断存库/加载**,`validateWorkflow` 硬校验不动。这条同时兜住 agent 生成与手动改乱。

**实测校正(两处)**:
1. **`archive-docs` 移出固化集**:它把文档提交到**特性分支/worktree**,合入前驳回即随分支丢弃、**可回退**,不属「离开可回退区」的固化。留在集里会把「第一个固化点」错误提前、误报。真正固化仅 `merge-branch`/`push-branch`/`open-pr`。
2. **固化节点自身挂的 `manual` 门要计入**:把人工评审门挂在 `push-branch`/`merge-branch` 上是正规打法(该门在动作生效前拦人),故判据取「第一个固化节点**及其之前**」是否有 `manual` 门,而非只看严格之前。

### 7. 人工验收要落成 `manual` 门(实测:author 拿命令节点糊弄)

实测中 author 产出的「人工验收(dogfood 后拍板)」是个执行者为**命令**、跑 `npm run build` 的普通节点,并非 `manual` 门——不会真的等人、也无从驳回。故 lint「无 manual 门」其实**没冤枉**,只是理由要按第 6 节校正。根因在 author:skill 要正向教「**要人拍板处用 `manual` 门**(可弹决策、可驳回),而非徒有其名的命令/agent 节点」。

### 8. 生成结果留调试日志(实测 meta 反馈)

自动 author 的产出现在只 fire-and-forget 推给 UI,开发者事后无从查看,调试只能靠用户逐节点截图。补:产出提案(成功/失败)时在主进程记一条日志——目标项目 + 工作流定义概览(节点/门/执行者)+ `issues`/失败原因——落在开发者可读处、不打扰用户。

### 10. author 读不到项目 → 给 `--add-dir`(实测根因)

实测一次 `null` 空产出,借日志定位:根因不是偶发,是 **author agent 对项目无文件系统访问**。证据:orchestrate producer `cwd = app.getPath('userData')`(index.ts:530/542,注释「只读姿态、脱 worktree、cwd 用 userData scratch」),`getProjectRepos` 只回 `{name,tag,memberId}`、**无路径**(index.ts:494)。故 agent **读不到** `.claude/`/`CLAUDE.md`/`git log`,系统意图叫它「查看项目习惯」根本无法执行——它只能靠 prompt 上下文(constitution/摘要)猜,上一轮 opsx 节点是从 constitution 推的、非真读文件,这一轮则空手而归(`outcome=empty`)。

**修复**:自动 author 那条路给 producer 传**项目成员仓的真实路径**作 `--add-dir`(读访问),系统意图改为「可直接查看本项目文件」+ 硬约束「**只读探查、只输出工作流 JSON、不要改动任何文件**」。

**取舍**:`--add-dir` 并非严格只读(CLI 层给读也给写),但靠 OPS_CONTRACT 强制结构化产出 + 明确只读指令把它约束成只读探查。这是让步骤 1 的「读项目习惯」名副其实的最小改动;更强的沙箱/只读权限模式留待需要时。仅改**自动 author 路**(聊天写工作流路是否也带,顺带评估)。

### 11. 生成失败:重来一次 + 抓原因 + 轻提示(实测)

`authorWorkflow` 现在 `return outcome.workflow ?? null`,把 seam 里**能区分失败种类的 `reply`**(「agent 调用失败」vs「跑通没产出」)**丢了**,日志只能记「返回 null」。改:

- **上浮原因**:`authorWorkflow` 返回富结果(含 `reply`/失败种类:抛错 / 空产出 / 校验不过),`runWorkflowOnboarding` 据此记入日志(区分种类)。
- **自动重试一次**:命中 author 支且首次失败 → 重试 1 次(救偶发);仍失败才回落默认。**有界**(1 次),避免系统性失败下死循环。
- **失败轻提示**:失败/空产出时经 `reportStatus('failed')` 触发底栏轻提示「未能生成定制工作流,已用默认」,自动消失(落实 spec 早有的「至多轻提示」)。

### 12. 提案改走全局对话(实测:孤立浮层是死胡同,**部分取代决策 #4**)

实测暴露:孤立 `WorkflowPreviewModal` 是**死胡同**——用户只能手动编辑,**没有让 AI 改的入口**(想说「把验收门放合并前」却无处写)。而聊天里手写工作流那条路**本就有反馈回路**(回复→改写)。故把自动提案**接进全局对话**:

- **产出后**:main 把提案作为一条 `role:'agent'` 消息 `appendMessage` 进本项目全局对话(取最近会话或新建);消息带 `proposal.workflow`,渲染层复用 `WorkflowProposalReview` + 「预览草稿」按钮(点开仍是完整编辑器手动微调)。
- **主动露出**:新增一条 main→renderer 推送(比照 `workflowProposalPush`,载荷 `{projectId, conversationId}`),渲染层据此 `openPanel()` + 选中并**重取**该会话(现无 `conversationChanged` 广播故须补)+ 自动滚底。经**模态协调器排队**——文档弹窗开着就等它关。
- **反馈回路**:对话输入框即「告诉 AI 改什么」;回复触发正常 orchestrate 改写轮。
- **保留**:底栏进度、失败轻提示、模态协调器仍用;`openWorkflowPreview`/`WorkflowPreviewModal` 仍作「预览草稿」落点。**移除**的是「`onWorkflowProposal` → `requestPopup` → 直接开孤立浮层」这一自动弹。

> 这**部分取代**决策 #4「提案主动露出=孤立浮层排队弹」——排队/底栏保留,但**落点从孤立浮层改为全局对话**。

### 13. 「就着挂起草稿改」——编辑基准取会话未存草稿

现状(调研确认):改写基准 `AuthoringContext.activeWorkflow` **只来自 `deps.getActiveWorkflow()`(库里活动工作流)**;而自动/聊天产出的是**未存库草稿**,其完整定义**其实存在会话消息** `message.proposal.workflow.workflow` 里,只是没人接回来。故:

- 主进程改写轮(`runOrchestrateTurn`/`orchestrateForProject`)在装配 authoring 前,**探测本会话最后一条 agent 消息是否带未存工作流草稿**;有则用**该草稿定义**覆盖 `authoring.activeWorkflow`(作 prompt 基准),`baseId` 仍留空(未存库→整体替换新建,合「无 diff」契约)。
- 效果:「加一道验收门」改的是这份草稿,而非活动工作流。**同惠**自动提案与聊天手写提案的迭代。
- 不违「只提案、人确认才落库」:草稿全程未落库,改写只在会话里滚动,人点「保存/设为项目工作流」才落库。

### 14. 节点列表门徽标(门可见)

实测:门挂在 `node.gate[]`、节点列表 `SortableNodeRow` 不显示,用户逐个点铅笔才看得到,误判「没验收」。补:`SortableNodeRow`(WorkflowEditor.tsx:1464-1507)读 `node.gate ?? []`,对含门节点标**徽标**区分 manual/auto/external(语义令牌、小而不喧),使人工/自动/外部检查点一眼可见。纯展示,不改数据模型。

**实测微调**:(a)徽标文案太简(「人工」)看不懂 → 扩成可读的(manual=「需人工评审」/auto=「自动校验门」/external=「外部门」,en 同步);(b)与节点名/阶段名挤一行显乱 → 徽标**移到该行第二行**单独一排,行内更清爽;(c)第二行徽标贴住行分隔线(顶边)显挤 → 加大行竖向内边距并抬高徽标行上边距(`py-2` + 徽标行 `mt-1.5`),让徽标干净地落在节点名下方、不压边框。

### 15. 「重大步骤必须人工审批」是硬原则(纠正 #12 里的误判)

实测:author 反复把「验收」做成命令/agent 节点、合并前无 `manual` 门。我一度把它当作「项目无人值守习惯,author 照实反映、没错」——**这是错的,用户明确纠正**:**不可逆固化(合并回主干 / 推送 / 开 PR)之前必须有一道人工审批,是产品原则,与项目是否"自主"无关。**故:

- **纠正措辞**:`createDefaultWorkflow` 描述里的「全程本地、可无人值守跑完 / Fully local, unattended」是与原则冲突的措辞,删除/改写为「合并前停下等你审批」。("本地直合"作为**合并策略名**保留,它指本地合并 vs PR 合并,不含免审批之意。)codex 适配器里的"免审批沙箱"是 CLI 技术项、与此无关,不动。
- **默认工作流言行一致**:给内置默认(本地直合)在**合并前**加一道 `manual` 审批门(照 `createDefaultWorkflowPr` 把 manual 门挂在交付段的写法),使它**自身就过 `lintWorkflow`**、体现原则,而非只在描述里说。
- **lint 喂回 author(用户指定的做法)**:`runWorkflowOnboarding` 里 author 产出可用提案后,**先跑 `lintWorkflow`**;若有警告(如"固化前缺人工验收"),就把**该警告文字 + 上一版工作流定义**合成一段修订意图**喂回 author**,让它补上审批门再产出;**有界**(至多 N 次)后仍不过才带警告投递(UI lint 仍提示)。这把我们做的 lint 从"UI 提示"升级为"author 的自检-自修信号"。修订不依赖草稿基准线程——直接把上版定义嵌进意图(整体替换)。
- **skill 加固**:`buildAuthorWorkflowSkill` 正向加固——不可逆固化前**必有**一道人工审批门,是**硬要求**(不因项目"自主/无人值守"而省)。

> 这条**纠正决策 #12** 的措辞立场:不是"author 照习惯省掉审批就对",而是"审批是硬底线,author 漏了要被 lint 逼着补回来"。

### 16. 审批门:确定性自动补,别再求 LLM(实测:喂回 2 轮仍失败)

实测日志:`revisionPasses: 2, lintWarnings: ["固化步骤前缺人工验收"]`——lint 喂回改了满 2 轮,author **仍**把「人工验收(合并前拍板)」做成 **agent 节点**而非 `manual` **门**(它一直理解成"造个叫验收的节点")。结论:**「靠 prompt 求 LLM 产出正确 `manual` 门结构」不可靠**——`node.gate:[{kind:'manual'}]` 这种嵌套结构 LLM 老是绕开、改成加节点。

**改为确定性修复**:lint 已精确知道「第一个不可逆固化前缺 `manual` 门」,补它是机械动作。加纯函数 `ensureApprovalBeforeFinalization(def)`——若该 lint 命中,就在**第一个固化节点前**插一个带 `manual` 门的复核节点(照默认工作流 `review-before-merge` 的 command+manual 写法),幂等(已有则不重复插)。`runWorkflowOnboarding` 投递前对 author 产出**确定性地跑一遍**,使投递工作流**永远**带审批门、lint 永不再报。这与 `repairWorkflow` 已在做的「建了分支自动补删分支」同类——**硬规则用代码保证,不赌 LLM**。

**作用域**:仅**自动路**(`runWorkflowOnboarding`)。聊天写工作流路**不强加**(用户在聊天里显式控制门;强加会出现"删了又被加回")——聊天路仍靠 skill + lint 提示。原 group 21 的 LLM 喂回循环保留作其它 lint 规则的兜底,但对本规则:确定性修复先跑、lint 已清,循环不再触发(不浪费 LLM 调用)。

### 17. 移除项目须清对话历史(实测遗漏)

实测:`IPC.removeProject`(index.ts:821-825)只 `documentStore.remove` 每个成员 + `removeProjectCore`,**没清** `conversationStore` 与 `cardConversationStore`(都按 projectId 分目录)——移除项目后全局对话/卡对话历史成孤儿留存。现在自动提案还往对话里写,更该清。补:conversation-store 加 `removeScope(projectId)`(整删该项目会话目录);`removeProject` 一并 `conversationStore.removeScope(projectId)` + `cardConversationStore.removeScope(projectId)`。

### 9. 架构再议(捕获,暂不在本 change 动手)

实测暴露一个更深的耦合,记录方向、留待落定:

- **预制 `archive-docs` 应退成「兜底」,不是默认**:项目**有自己的归档/沉淀约定**(如 opsx 的 `opsx:sync`+`opsx:archive`、changelog、ADR)时,author 应用**项目自带**的方式(installed 技能/命令),而非我们那套「读登记表派子 agent」的预制节点;**没有**约定时才用预制兜底。实测里 author 同时放了 `文档归档(archive-docs)` 与 `opsx:archive`,即此冗余。→ 归**步骤 2 `workflow-from-habits`** 的 skill 打磨(教「优先项目自带归档」)。
- **文档扫描是否应「按需」——调研已出结论**:查证(task 14.1)**文档登记表在运行时只被 `archive-docs` 一个引擎操作消费**(`getDocRegistry` 唯一调用方是 `engine.ts` 的 `runArchiveDocsNode`;`conventionPreamble`/`docs`/`habitPrompt` 不进任何编排/分解/agent 上下文)。故**工作流不含 `archive-docs` 时,文档扫描是纯浪费**。
  - **理想流**:`import → 先 author 工作流 → 用户采纳 → 若采纳的流含 archive-docs 才扫文档`(需求驱动扫描),同时消掉 `archive-docs` 与 `opsx:archive` 的冗余(opsx 项目无 archive-docs → 不扫)。
  - **代价**:要**翻转当前触发链**——现在「扫完→触发 author」(为单 agent 串行);翻成「先 author→按需扫」要把 author 触发点从「文档分析返回」移到「导入完成」,并改现有**文档 onboarding 的弹出时机**(不再每次导入都扫/弹)。串行仍成立。
  - **定性**:一次**独立再架构**(重塑触发链 + 改一个已发功能的 UX),与「archive-docs 退兜底」天然成对。**建议单开 change 做**(如 `demand-driven-doc-scan`),排在本 change 提交后、与步骤 2 相邻;**不塞进本 change**,以免动摇刚建好的触发链。

### 5. 默认工作流要能指名

兜底与「否则」支要派「内置默认(本地直合)」。今天启动种子(`index.ts:1730`)给三份内置各配 `randomUUID()`,无法稳定指名。改为**主默认工作流以稳定 id 种子化**(比照两份验收样例已按稳定 id 幂等种子的做法),这样兜底能 `setActiveWorkflow(project, STABLE_DEFAULT_ID)`。

## 失败与边界

- **author 失败 / 超时 / 产出无骨架**(`issues` 非空、存库入口禁用)→ 回落派默认工作流,不让项目卡在无工作流;失败不打扰用户或仅轻提示。
- **reused 导入**(重开已知项目)→ 整条判据跳过,不覆盖用户已有 `activeWorkflowId`。
- **用户弃用提案** → 保持已派的默认工作流(判据支若走了 author,则先不派默认、待用户决定;弃用后落默认)。定稿:**先派默认作占位,author 提案作「升级」浮层**,弃用即停在默认——避免任何时刻项目无工作流。
- **多仓**:痕迹探测跨成员仓(任一命中);author agent 本就能看到所有成员仓。各仓习惯不一致的细粒度处理归第二步。
- **并发导入多个项目**:每项目一次判据;author 任务复用默认 agent,天然串行/排队(与文档分析同一档期约束)。

## 与第二步的边界

| 归属 | 内容 |
|---|---|
| 本步 `auto-workflow-on-import` | 触发时机、判据门、痕迹存在性门控、无头 author 入口、提案主动露出、默认稳定 id、失败回落 |
| 第二步 `workflow-from-habits` | 推断质量:稳定发现并解读 `.claude`/`CLAUDE.md`/`.cursor`/hooks/git;映射到执行器 tool/model、门、交付策略;「习惯用 Cursor 但本机只装 Claude」的调和(结构学习自习惯、执行落到能跑的 agent);多仓习惯不一致 |

本步刻意用**直白系统意图 + agent 自身探项目能力**跑通端到端;第二步把 `buildAuthorWorkflowSkill` 扩成对「从项目习惯反推」有明确指导。
