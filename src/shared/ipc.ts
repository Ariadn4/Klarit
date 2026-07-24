/** main ↔ renderer 的 IPC 通道名（preload 与 main 共用，避免拼写漂移）。 */
export const IPC = {
  importProject: 'project:import',
  listProjects: 'project:list',
  currentProject: 'project:current',
  openProject: 'project:open',
  linkMember: 'project:linkMember',
  unlinkMember: 'project:unlinkMember',
  relocateMember: 'project:relocateMember',
  /** 整体移除一个项目（管理项目窗口用）。 */
  removeProject: 'project:remove',
  /** 打开/聚焦「管理项目」窗口（单例）。 */
  manageOpen: 'manage:open',
  /** 关闭「管理项目」窗口。 */
  manageClose: 'manage:close',
  /** 管理项目窗口里点项目：统一打开落点后关闭管理窗口。 */
  openProjectFromManage: 'manage:openProject',
  /** 主进程把一个既有窗口绑定到项目后推给该窗口渲染层：触发重启（离开空状态、拉取新项目）。 */
  projectBound: 'project:bound',
  /** 主进程侧卡片链变化（尤其自动排程异步启动卡后）→ 广播给所有窗口，渲染层据此重载卡片。 */
  cardsChanged: 'cards:changed',
  /** main → renderer：项目注册表变更（管理窗移除/导入等）→ 广播所有窗口刷新项目列表与绑定状态。 */
  projectsChanged: 'projects:changed',
  /** 管理项目窗口里「打开本地项目」：选目录导入并打开。 */
  manageImportProject: 'manage:import',
  /** 在系统文件管理器中定位某路径。 */
  showItemInFolder: 'shell:showItemInFolder',
  /** 用系统默认浏览器打开一个外部网址（如 PR/MR 链接）。 */
  openExternal: 'shell:openExternal',
  /** 读取应用版本号。 */
  getAppVersion: 'app:getVersion',
  listDir: 'fs:listDir',
  /** 只读读取文件内容供预览。 */
  readFile: 'fs:readFile',
  getSidebarCollapsed: 'sidebar:get',
  setSidebarCollapsed: 'sidebar:set',
  getSidebarWidth: 'sidebar:getWidth',
  setSidebarWidth: 'sidebar:setWidth',
  getSidebarView: 'sidebar:getView',
  setSidebarView: 'sidebar:setView',
  getSystemLocale: 'settings:systemLocale',
  getLanguage: 'settings:getLanguage',
  setLanguage: 'settings:setLanguage',
  getAppearance: 'settings:getAppearance',
  setAppearance: 'settings:setAppearance',
  /** 读取当前生效主题（dark/light），由外观偏好 + 系统明暗解析而来。 */
  getEffectiveTheme: 'theme:getEffective',
  /** main → renderer：生效主题变更（切外观或系统明暗变化时广播）。 */
  themeChanged: 'theme:changed',
  /** 只读：列某成员仓的本地分支。 */
  gitBranches: 'git:branches',
  /** 只读：列某成员仓的 worktree（路径→分支映射）。 */
  gitWorktrees: 'git:worktrees',
  /** 设置 git 视图当前预览 worktree 路径并监听其磁盘变更。 */
  setGitWatchPath: 'git:watchPath',
  /** main → renderer：文件树增量变更。 */
  fileTreeChange: 'filetree:change',
  // ── 自绘窗口控制 ──
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximizeToggle',
  windowClose: 'window:close',
  // ── 工作流库与项目激活 ──
  listWorkflows: 'workflow:list',
  getWorkflow: 'workflow:get',
  createWorkflow: 'workflow:create',
  cloneWorkflow: 'workflow:clone',
  saveWorkflow: 'workflow:save',
  deleteWorkflow: 'workflow:delete',
  importWorkflow: 'workflow:import',
  exportWorkflow: 'workflow:export',
  createSkillFile: 'workflow:createSkill',
  importSkillFile: 'workflow:importSkill',
  readSkillFile: 'workflow:readSkill',
  /** 拼装并返回某 agent 节点提交给 AI 的完整 prompt（宪法 + 节点 prompt + 需求卡占位 + 可写范围 + 产出 + 客观门），供编辑器只读预览。 */
  previewAgentNodePrompt: 'workflow:previewNodePrompt',
  getActiveWorkflow: 'workflow:getActive',
  setActiveWorkflow: 'workflow:setActive',
  // ── 本地 agent 扫描与默认 agent/模型偏好 ──
  /** 扫描本机已安装的受支持 agent（含模型清单）。 */
  agentsScan: 'agents:scan',
  getDefaultAgent: 'settings:getDefaultAgent',
  setDefaultAgent: 'settings:setDefaultAgent',
  getDefaultModel: 'settings:getDefaultModel',
  setDefaultModel: 'settings:setDefaultModel',
  getDefaultEffort: 'settings:getDefaultEffort',
  setDefaultEffort: 'settings:setDefaultEffort',
  // ── 规则包库与项目宪法治理 ──
  listRulePacks: 'rulePack:list',
  /** 读全部规则包完整定义（编辑器/工作流引用选择器/宪法派生用）。 */
  allRulePacks: 'rulePack:all',
  getRulePack: 'rulePack:get',
  createRulePack: 'rulePack:create',
  cloneRulePack: 'rulePack:clone',
  saveRulePack: 'rulePack:save',
  deleteRulePack: 'rulePack:delete',
  importRulePack: 'rulePack:import',
  exportRulePack: 'rulePack:export',
  /** 读/写当前项目的宪法治理状态（激活包 + 逐条开关）。 */
  getConstitution: 'project:getConstitution',
  setConstitution: 'project:setConstitution',
  /** 读当前项目的生效宪法（派生：激活并集减去关闭项）。 */
  effectiveConstitution: 'project:effectiveConstitution',
  // ── 新建需求：分解能力（全局 agent 接缝；止于产出候选卡，落库归下一个 change）──
  /** 读当前项目的生效分解 prompt（激活工作流新建需求指令 → 全局默认分解 skill 兜底）；未绑定给空态。 */
  getDecomposePrompt: 'decompose:getPrompt',
  /** 提交一段自由描述，经全局 agent 接缝产出结构化候选卡；未绑定给空态。 */
  decomposeRequirement: 'decompose:run',
  /** 外部 AI 路径：提交外部产出的候选卡，规整+校验后回传供人审；未绑定给空态。 */
  submitDecomposedCandidates: 'decompose:submit',
  // ── 全局覆盖分解 skill：手写/导入/读取（与工作流节点 prompt 导入一致；可选高级覆盖）──
  readDefaultDecomposeSkill: 'decomposeSkill:read',
  writeDefaultDecomposeSkill: 'decomposeSkill:write',
  importDefaultDecomposeSkill: 'decomposeSkill:import',
  /** 读由类型注册表自动生成的分解 skill 完整文本（供类型设置页只读预览）。 */
  readGeneratedDecomposeSkill: 'decomposeSkill:readGenerated',
  // ── 需求编排（全局 agent：意图→卡操作提案 / 审阅→apply-ops / 全局对话）──
  /** 经编排核 over 全盘视野产出卡操作提案；带 conversationId 则记入该会话。未绑定项目给空态。 */
  orchestrate: 'orchestrate:run',
  /** 外部 AI 路径：提交外部产出的 ops，经同一校验后回传提案供人审；未绑定给空态。 */
  submitOrchestrationOps: 'orchestrate:submit',
  /** 审阅确认后把提案 ops 应用到 cardStore（破坏性 op 需 confirmedDestructive）。回 ApplyOpsResult。 */
  applyOps: 'orchestrate:apply',
  /** 新项目提议确认：选目录→importProject→绑窗口→把 create ops 种入新项目。取消回 null。 */
  orchestrateCreateProject: 'orchestrate:createProject',
  /** 列当前项目全部全局对话（按最近更新倒序）；未绑定给空数组。 */
  conversationsList: 'conversation:list',
  /** 取一条全局对话（含历史）。 */
  conversationGet: 'conversation:get',
  /** 新建一条全局对话，返回其 id。 */
  conversationCreate: 'conversation:create',
  /** 删除一条全局对话。 */
  conversationRemove: 'conversation:remove',
  /** 设某会话选用的 agent/模型（覆盖全局默认，传 undefined 清除回落）。 */
  setConversationAgentModel: 'conversation:setAgentModel',
  /** 重试：丢弃末尾 agent 回复、重跑上一条用户意图，返回更新后会话。 */
  conversationRetryLast: 'conversation:retryLast',
  /** 编辑：移除最新一轮，返回被移除的用户文字供回填输入。 */
  conversationDropLastTurn: 'conversation:dropLastTurn',
  // ── 单需求 agent（single-card-agent：每卡只读咨询 + 本卡干预 + 门自由输入上抛）──
  /** 取（或惰性新建）某卡的单需求 agent 会话（id=cardId，一卡一个）；未绑定给 null。 */
  cardConsultGet: 'cardConsult:get',
  /** 跑一轮咨询：装配本卡只读读上下文→三岔（查进度回复/本卡干预提议/上抛 ops 提案）；记入该卡会话。 */
  cardConsultSend: 'cardConsult:send',
  /** 重试：丢弃末尾 agent 回复、重跑上一条用户意图，返回更新后会话。 */
  cardConsultRetryLast: 'cardConsult:retryLast',
  /** 编辑：移除最新一轮，返回被移除的用户文字供回填输入。 */
  cardConsultDropLastTurn: 'cardConsult:dropLastTurn',
  /** 设某卡会话选用的 agent/模型（覆盖全局默认，传 undefined 清除回落）。 */
  cardConsultSetAgentModel: 'cardConsult:setAgentModel',
  /** 门自由输入分类前置：反偏置跑一轮咨询；塑造需求→出 ops 提案（**不消费该门决策**），否则只回复。 */
  cardGateClassify: 'cardConsult:gateClassify',
  /** 标记某消息第 index 个干预已执行（持久化，供重开卡后显「已执行」、不再重复触发）。 */
  cardConsultMarkApplied: 'cardConsult:markApplied',
  /** 清空某卡会话：清消息 + 断续接，保留会话与 agent/模型；回到空态。 */
  cardConsultClear: 'cardConsult:clear',
  /** 打断某卡进行中的咨询轮：杀掉当前咨询 agent 进程；无进行中轮为 no-op。 */
  cardConsultAbort: 'cardConsult:abort',
  // ── 需求卡类型注册表：增删改查（全局类型库；archetype 内置 container/leaf）──
  listCardTypes: 'cardType:list',
  saveCardType: 'cardType:save',
  deleteCardType: 'cardType:delete',
  // ── 描述想法窗：附件选择 / 粘贴图片落盘（均返回路径供插入正文）──
  /** 弹系统文件选择器（多选），返回所选文件绝对路径数组（取消为空数组）。 */
  pickAttachments: 'attachment:pick',
  /** 把剪贴板里的图片落盘到 userData/attachments/，返回其绝对路径；剪贴板无图片返回 null。 */
  saveClipboardImage: 'attachment:saveClipboardImage',
  /** 把一段纯文本写入系统剪贴板（Electron clipboard），供输出/prompt「一键复制」。 */
  copyText: 'clipboard:copyText',
  // ── 引擎执行（一次性触发 + 观察 + 可取消可恢复）──
  /** 触发一次运行，立即返回 runId 与首个断点；引擎持有生命周期、自驱至完成/等待决策/暂停。 */
  engineStart: 'engine:start',
  /** 暂停一个运行（进 paused，可见可恢复）。 */
  enginePause: 'engine:pause',
  /** 恢复一个运行（有待决策则回 waiting-decision，否则续跑）。 */
  engineResume: 'engine:resume',
  /** 回应一个待决策（选项/多选/填空）。 */
  engineDecide: 'engine:decide',
  /** 用户发起本卡干预——倒回到目标节点前向修复（可带注入指令）；活跑先安全挂起。回运行断点。 */
  engineReenter: 'engine:reenter',
  /** 用户发起本卡干预——就地向当前执行节点注入新指令；无可注入节点优雅无操作。回运行断点。 */
  engineInject: 'engine:inject',
  /** 查询某运行的当前断点（挂载回灌 UI）。 */
  engineGetRunState: 'engine:getRunState',
  /** 触发某人工门动作按钮（按索引）：worktree 下跑命令、流式回显、不推进运行。 */
  engineRunGateAction: 'engine:runGateAction',
  /** 停止正在跑的门把动作命令（杀进程树）。 */
  engineStopGateAction: 'engine:stopGateAction',
  /** 命令节点执行中手动推进：abort=杀+进；detach=转后台+进。 */
  engineAdvanceCommand: 'engine:advanceCommand',
  /** 列出某运行的后台命令。 */
  engineListBackground: 'engine:listBackground',
  /** 中止某后台命令（杀进程树）。 */
  engineStopBackground: 'engine:stopBackground',
  /** main → renderer：运行进度事件（节点/阶段、操作输出、流式输出、需要决策、状态变化）。 */
  engineProgress: 'engine:progress',
  /** 读某运行某桶（`node:<nodeId>` / `bg:<bgId>`）累积命令输出（可回看）。 */
  engineReadOutput: 'engine:readOutput',
  /** 列某运行的全部输出桶键。 */
  engineListOutputBuckets: 'engine:listOutputBuckets',
  // ── 需求卡持久化与运行集成（requirement-card-store / card-detail）──
  /** 列当前绑定项目的全部需求卡；未绑定给空数组。 */
  cardsList: 'cards:list',
  /** 统一创建接缝：审阅通过的候选卡落库到当前项目（手动新建 + 外部分解共用）。 */
  cardsCreate: 'cards:create',
  /** 更新一张卡（状态/涉及仓等）。 */
  cardsUpdate: 'cards:update',
  /** 删除一张卡（清理其它卡指向它的悬挂边）。 */
  cardsRemove: 'cards:remove',
  /** 删卡前算每条成员分支的合并状态与 worktree 存在（供确认框展示）。 */
  cardsBranchCleanupInfo: 'cards:branchCleanupInfo',
  /** 从卡派生运行请求并触发引擎；建立卡↔运行双向链。回 { runId } 或 { error }。 */
  cardsRun: 'cards:run',
  /** 列某卡各成员仓已建出分支的条目（成员仓名 + 实际分支）。 */
  cardsBranches: 'cards:branches',
  // ── 文档登记表（per-成员仓：分析/读/写）──
  /** agent 语义分析（分组+分类+起草一体，读清单+样本）；无 agent/失败回落启发式。并入既有表返回（不落盘）。 */
  documentsAnalyze: 'documents:analyze',
  /** 读某成员仓的登记表；无表给空壳。 */
  documentsGet: 'documents:get',
  /** 规整后整表落盘。 */
  documentsSave: 'documents:save',
  /** main → renderer：新导入项目落定，请该项目的窗口立即进入文档确认步（载荷为 memberId）。 */
  documentsOnboard: 'documents:onboard',
  /**
   * main → renderer：导入后自动派工作流命中支——后台 author 产出的可用提案已作 agent 消息追加进本项目全局对话，
   * 请渲染层打开/聚焦对话面板、选中并重取承载该提案的会话（后台追加消息无自动刷新，故须此推送驱动）。
   * 载荷为 `{ projectId, conversationId }`。
   */
  workflowProposalReady: 'workflow:proposalReady',
  /** main → renderer：导入后自动派工作流的后台生成进度（载荷为 WorkflowGenPhase：generating/done/failed），底栏显/隐指示。 */
  workflowGenStatus: 'workflow:genStatus',
  /** 程序化聚焦：把侧边栏切到 git 视图并定位到指定（成员仓, 分支）的 worktree。 */
  gitViewFocus: 'gitView:focus',
  /** main → renderer：请求渲染层把 git 视图聚焦到某（成员仓, 分支）。 */
  gitViewFocusRequest: 'gitView:focusRequest'
} as const
