# Tasks

## 1. 痕迹存在性探测(门控)
- [x] 1.1 写测试:纯函数 `hasAgentHabits(memberRoots): boolean`——任一成员仓根有 `.claude/`/`CLAUDE.md`/`.cursor/`/`AGENTS.md`/`.codex`/`.github/` 即 true;空项目 false;多仓任一命中 true
- [x] 1.2 实现探测器(主进程、`fs.existsSync` 级、不读内容)—— `src/main/agent-habits.ts`

## 2. 默认工作流稳定 id
- [x] 2.1 写测试:启动种子后,主默认(本地直合)以稳定 id 存在且幂等(重复种子不重复建)
- [x] 2.2 让主默认以稳定 id 种子化 —— `DEFAULT_LOCAL_MERGE_WORKFLOW_ID` + `seedDefaultLocalMergeWorkflow(store)`

## 3. 无头 author 入口
- [x] 3.1 写测试:`authorWorkflow(deps, produce, projectId, intent)` 以系统意图跑 seam、返回 `WorkflowProposal`(经修复+两闸校验),不追加用户会话
- [x] 3.2 从 `runOrchestrateTurn` 抽出 projectId-显式核(`orchestrateForProject`);`runOrchestrateTurn` 改为薄封装
- [x] 3.3 定义系统合成意图字符串(`WORKFLOW_ONBOARDING_INTENT`,第一步直白版)

## 4. 文档分析完成信号
- [x] 4.1 写测试:判据核在触发时按矩阵行为(纳入 5.1/5.2)
- [x] 4.2 在主进程 `IPC.documentsAnalyze` 返回处触发工作流 onboarding(不依赖渲染层保存)

## 5. 判据编排(核心)
- [x] 5.1 写测试:判据矩阵——有痕迹+有 agent → author;无痕迹 → 默认;有痕迹+无 agent → 默认;reused/已有活动工作流 → 跳过
- [x] 5.2 写测试:author 失败/`issues` 非空 → 回落默认,项目不留「无工作流」态
- [x] 5.3 实现 `runWorkflowOnboarding(project, deps)`:门控 → 派默认占位 → (命中)后台 author → 主动推送提案
- [x] 5.4 接到导入/分析完成触发点

## 6. 提案主动露出
- [x] 6.1 新增 main→renderer 提案推送 `IPC.workflowProposalPush`(载荷 `WorkflowProposal`)+ preload `onWorkflowProposal`
- [x] 6.2 渲染层订阅 → `openWorkflowPreview` 复用 `WorkflowPreviewModal`(提升到 App 级、去重);采用即保存+`setActiveWorkflow`;弃用停在默认
- [x] 6.3 测试:推送到达即打开预览(无需先开聊天面板);弃用不清活动工作流

## 7. 收尾
- [x] 7.1 i18n:复用现有 `globalChat.workflowPreview` 本地化串,未引入硬编码色面(无新增用户串)
- [x] 7.2 `npm run typecheck`(两套)+ `npm run test:run`(120 文件 / 1398 用例)全绿
- [x] 7.3 端到端验证:全流程(导入带 `.claude/CLAUDE.md` 的项目 → 分析完 → 提案进对话 → 反馈改写 → 审批门)需 live agent、headless Playwright 不稳,故**改由手动 dogfood 反复实测**(十余轮 `build`+`npm start` 真机验证,逐轮借 `logs/workflow-onboarding.log` 核对产出)+ 全面单元/契约覆盖代之;**自动化 e2e 显式留作后续**(非本 change 阻塞项)

## 8. 写工作流 skill 补正向搭流约束(实测反馈)
- [x] 8.1 写测试:`buildAuthorWorkflowSkill()` 文本含「连续作业交同一节点」的正向讲原因表达(据即时反馈逐步收敛 → 同一 agent 节点 + 何时才分节点)
- [x] 8.2 写测试:文本含「固化步骤(离开可回退区)排在人工验收之后」的正向讲原因表达
- [x] 8.3 实现:在 `buildAuthorWorkflowSkill` 门/纪律段补这两条(正向、讲原因、例子轻点、不用负向禁止句)

## 9. 工作流软校验(结构可判反模式,非阻断)
- [x] 9.1 写测试:软校验纯函数——不可逆固化操作(`merge-branch`/`push-branch`/`open-pr`/`archive-docs`)执行序之前无 `manual` 门 → 出告警;之前有 `manual` 门 → 不告警;无固化操作 → 不适用
- [x] 9.2 写测试:软校验非阻断(不影响 `validateWorkflow`/存库);红门(命令文本藏取反)不被纳入
- [x] 9.3 实现软校验函数(`src/shared/workflow.ts`,比照 `checkBranchPairing`;固化操作集从引擎能力单一来源派生 `IRREVERSIBLE_FINALIZATION_OPS`)
- [x] 9.4 经 `WorkflowSummary.warnings` 露出告警;编辑器(实时)/库/选择器展示(`--color-warning`、非阻断)

## 10. 弹窗时机改造:底栏进度 + 排队不叠加(返工 group 6 的直接弹出)
- [x] 10.1 写测试:全局模态协调器 store——记录「有无模态在开」+ 待弹队列;无模态 → 立即弹;有模态 → 入队,模态关闭出队顺次弹 —— `src/renderer/src/stores/modalQueue.ts`(+ test)
- [x] 10.2 改 `App.tsx` 订阅:提案到达经协调器排队(`requestPopup`),不再无条件 `openWorkflowPreview`;文档 onboarding(`DocumentOnboardingDialog`)与预览浮层(`WorkflowPreviewModal`)自身登记进协调器
- [x] 10.3 生成进度进底栏状态区(比照文档扫描状态呈现):`WorkflowGenStatus` + `workflowGen` store;main 侧 `reportStatus` dep → `IPC.workflowGenStatus`(载荷 `WorkflowGenPhase`)推送
- [x] 10.4 写测试:提案在文档 onboarding 开着时不叠加、待其关闭再弹(App.test「工作流提案主动露出」)

## 11. 软校验校正(实测)
- [x] 11.1 写测试:`archive-docs` 不算固化——仅含 `archive-docs`(无 merge/push/open-pr)时不告警
- [x] 11.2 写测试:`manual` 门挂在第一个固化节点自身上 → 不告警(取「固化节点及其之前」范围)
- [x] 11.3 改 `finalizesIrreversibly`:`archive-docs` 置 false;lint 判据范围改为 `slice(0, firstFinalizeIdx + 1)`

## 12. 写工作流 skill 补「要人拍板处落成 manual 门」(实测)
- [x] 12.1 写测试:`buildAuthorWorkflowSkill()` 文本正向含「要人拍板/验收处用 `manual` 门(可弹决策/可驳回),非徒有其名的命令/agent 节点」+ 原因
- [x] 12.2 实现:在 skill 门/纪律段补此条(正向讲原因)

## 13. 自动生成的提案留调试日志(实测 meta 反馈)
- [x] 13.1 写测试:runWorkflowOnboarding 命中 author 后,产出(成功/失败)经注入的 `logProposal` dep 记一条含项目 + 定义概览 + issues/失败原因
- [x] 13.2 实现:主进程把该日志落到 `logs/workflow-onboarding.log`(JSONL)+ 结构化 console,不打扰用户

## 15. author 真正读到项目(根因修复,实测)
- [x] 15.1 写测试:自动 author 路把项目成员仓真实路径作为可访问目录(`--add-dir`)传入 producer / agent runner
- [x] 15.2 成员仓真实路径取自 member `rootPath`;`createOpsProducer` 加 `addDirs` → `AgentRunSpec.extraDirs` → adapter(claude/cursor `--add-dir`,codex 兜底 `-C`)
- [x] 15.3 `authorWorkflowForProject` 传成员仓路径;`WORKFLOW_ONBOARDING_INTENT` 改「文件已挂给你、可直接查看」+ 只读/只输出工作流/不改文件
- [x] 15.4 只改自动 author 路(聊天路不带 addDirs——`--add-dir` 非严格只读、聊天无对应只读意图约束)

## 16. 生成失败:重来一次 + 抓原因 + 轻提示(实测)
- [x] 16.1 写测试:`authorWorkflow` 返回富结果 `{proposal, reply?, failure?: 'threw'|'empty'|'invalid'}`,不再一律 null
- [x] 16.2 写测试:`runWorkflowOnboarding` 首次失败 → 自动重试一次;仍失败才回落默认(有界一次)
- [x] 16.3 写测试:失败按种类记日志(不再「返回 null」);最终失败 `reportStatus('failed')` 触发底栏轻提示
- [x] 16.4 实现:seam `producerFailed` 标记 + orchestrate-service 富结果 + workflow-onboarding 重试/记因 + 渲染层 `WorkflowGenStatus` 失败轻提示(5s 自动消失)

## 17. 节点列表门徽标(门可见,实测)
- [x] 17.1 写测试:`SortableNodeRow` 对含门节点渲染对应徽标;无门不渲染;多类分别标出
- [x] 17.2 实现:`SortableNodeRow` 名字旁读 `node.gate[]` 加徽标(manual=cobalt/auto=stone/external=info,语义令牌)

## 18. 提案改走全局对话(替换孤立浮层,实测)
- [x] 18.1 写测试:命中成功 → `deliverProposal` 把提案作 agent 消息进本项目全局对话(取最近/新建),而非孤立浮层
- [x] 18.2 新增推送 `IPC.workflowProposalReady{projectId, conversationId}`;渲染层订阅 → 模态协调器排队 → `openConversation(id)`(开面板+选中+重取+滚底)
- [x] 18.3 移除旧 `workflow:proposalPush` 自动弹链(彻底删);`openWorkflowPreview`/`WorkflowPreviewModal` 保留作「预览草稿」落点
- [x] 18.4 写测试:文档弹窗开着时打开对话面板排队、待其关闭再打开(不叠加)

## 19. 编辑基准取会话未存草稿(就着草稿改,实测)
- [x] 19.1 写测试:会话末条 agent 消息带未存草稿 → 改写以该草稿作基准(覆盖活动工作流)、`baseId` 留空;无草稿回落活动
- [x] 19.2 实现:seam 内 `lastDraftWorkflow(history)` 覆盖 `authoring.activeWorkflow`(纯 orchestrate-service,未碰 index.ts)
- [x] 19.3 契约:自动提案进对话 → 回复「加验收门」→ 就着草稿改(经 19.2 基准覆盖 + 18 的对话回路)

## 20. 默认工作流合并前加审批门 + 纠正措辞(实测)
- [x] 20.1 写测试:`createDefaultWorkflow(id)` 合并前含 `manual` 门、`lintWorkflow` 无告警、名/描述无「无人值守/unattended」
- [x] 20.2 实现:`merge-branch` 不支持门,故新增 `command` 复核节点 `review-before-merge`(挂 manual 门、动作 `git diff`)在合并前;description 去「无人值守」改「合并前停下等你审批」
- [x] 20.3 更新受影响测试:`engine/smoke.test.ts` 本地直合用例改为「停在审批门→decide(pass)→done」(默认不再无人值守跑到底)

## 21. lint 警告喂回 author 修订(用户指定,实测)
- [x] 21.1 写测试:触发 lint 告警 → 喂回警告+上版定义修订、改好投递;有界仍告警投递最后一版(不阻断);本无告警不触发
- [x] 21.2 实现:author 产出后跑 `lintWorkflow`,有告警则有界(`WORKFLOW_ONBOARDING_REVISION_MAX=2`)喂回修订(`buildWorkflowRevisionIntent` 嵌上版定义+警告);日志加 `revisionPasses`/`lintWarnings`

## 22. skill 加固「固化前必有人工审批」为硬要求(实测)
- [x] 22.1 写测试:`buildAuthorWorkflowSkill()` 正向含「不可逆固化前必有人工审批 manual 门=硬要求,不因项目自主而省」+原因
- [x] 22.2 实现:skill 门/纪律段加「不可逆固化前必有一道人工审批门(硬要求)」正向段

## 23. 缺审批门确定性自动补(实测:LLM 喂回不可靠)
- [x] 23.1 写测试:`ensureApprovalBeforeFinalization(def)`——固化前无 manual 门 → 插带 manual 门复核节点、`lintWorkflow` 转空;已有/无固化则幂等 no-op;过 `validateWorkflow`+`checkBranchPairing`
- [x] 23.2 写测试:`runWorkflowOnboarding` 投递前跑该修复 → 投递必含审批门(即便 author 只给 agent「验收」节点);`revisionPasses` 恒 0
- [x] 23.3 实现:`ensureApprovalBeforeFinalization`(shared/workflow.ts,照 `review-before-merge`;抽 `MISSING_FINALIZATION_APPROVAL_WARNING` 单一来源);workflow-onboarding 投递前 `withApproval` 包裹(仅自动路)

## 24. 移除项目清对话历史(实测遗漏)
- [x] 24.1 写测试:conversation-store `removeScope(projectId)` 整清该项目会话;别的项目不受影响(内存+文件后端)
- [x] 24.2 写测试/接线:`removeProject` 连带清 `conversationStore` + `cardConversationStore` 该项目作用域
- [x] 24.3 实现:conversation-store 加 `removeScope`(文件删项目目录 / 内存删该 projectId 条目);index.ts `removeProject` 调用

## 14. 架构再议(仅调研 + 捕获,暂不改)
- [x] 14.1 调研:文档登记表 / `conventionPreamble` 的消费方——**结论:运行时只被 `archive-docs` 消费**(`runArchiveDocsNode` 唯一调用方),故「扫描按需」可行
- [x] 14.2 (后续 change 指针,非本 change 范围)「归档优先用项目自带、预制退兜底」→ 归步骤 2 `workflow-from-habits` 的 skill 打磨
- [x] 14.3 (后续 change 指针,非本 change 范围)「需求驱动文档扫描」(先 author→用到 archive-docs 才扫,翻转触发链)→ 单开 change `demand-driven-doc-scan`
