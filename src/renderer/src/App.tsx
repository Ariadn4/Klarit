import { useCallback, useEffect, useRef, useState } from 'react'
import type { DetectedAgent, Project, SidebarViewState, WorkflowDefinition } from '@shared/types'
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@shared/language'
import { DEFAULT_APPEARANCE, type Appearance } from '@shared/appearance'
import type { AgentId } from '@shared/agents'
import { DEFAULT_SIDEBAR_WIDTH, clampSidebarWidth } from '@shared/sidebar'
import { chunkBucket } from '@shared/output-bucket'
import { Topbar } from './components/Topbar'
import { Sidebar } from './components/Sidebar'
import { FileViewer } from './components/FileViewer'
import { NewRequirementFlow } from './components/NewRequirementFlow'
import GlobalChatPanel, { GlobalChatEntry } from './components/GlobalChatPanel'
import { KanbanBoard } from './components/KanbanBoard'
import { AgentOnboardingDialog } from './components/AgentOnboardingDialog'
import { RequirementCardDetail } from './components/RequirementCardDetail'
import { useCardsStore } from './stores/cards'
import i18n from './i18n'

export function App(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [current, setCurrent] = useState<Project | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  // 当前项目激活工作流的定义；驱动主面板看板的中间阶段列。null＝未激活或定义缺失（只渲两列书挡）。
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [language, setLanguage] = useState<SupportedLanguage>(DEFAULT_LANGUAGE)
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE)
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgent[]>([])
  const [defaultAgent, setDefaultAgent] = useState<AgentId | null>(null)
  const [defaultModel, setDefaultModel] = useState<string | null>(null)
  // 首启引导：仅当用户尚未选默认 agent 且扫描到至少一个 agent 时显示。
  const [onboarding, setOnboarding] = useState(false)
  const [viewState, setViewState] = useState<SidebarViewState>({
    view: 'files',
    gitMemberId: null,
    gitBranch: null
  })
  // 需求卡视图（由 cards store 驱动看板真卡与详情面板）。
  const cards = useCardsStore((s) => s.cards)
  const cardTypes = useCardsStore((s) => s.cardTypes)
  const runs = useCardsStore((s) => s.runs)

  const refresh = useCallback(async (): Promise<void> => {
    const [cur, list] = await Promise.all([
      window.klarit.getCurrentProject(),
      window.klarit.listProjects()
    ])
    setCurrent(cur)
    setProjects(list)
    // 当前项目的需求卡 + 类型集（驱动看板真卡）。
    void useCardsStore.getState().load()
  }, [])

  // 取当前窗口项目的激活工作流定义：先拿激活 id，再读完整定义；无激活/定义缺失则置空（看板退回两列书挡）。
  const refreshActiveWorkflow = useCallback(async (): Promise<void> => {
    const id = await window.klarit.getActiveWorkflow()
    setActiveWorkflow(id ? await window.klarit.getWorkflow(id) : null)
  }, [])

  // 用户在工作流选择器激活某工作流后：重读该定义刷新看板（中间阶段列实时重算，书挡列不变）。
  const onActiveWorkflowChange = useCallback(async (id: string): Promise<void> => {
    setActiveWorkflow(await window.klarit.getWorkflow(id))
  }, [])

  useEffect(() => {
    window.klarit.getSidebarCollapsed().then(setCollapsed)
    window.klarit.getSidebarWidth().then(setWidth)
    window.klarit.getSidebarView().then(setViewState)
    window.klarit.getLanguage().then((lang) => {
      setLanguage(lang)
      document.documentElement.lang = lang
      // 由 language 偏好驱动文案渲染(类比 data-theme 驱动令牌翻色)。
      void i18n.changeLanguage(lang)
    })
    window.klarit.getAppearance().then(setAppearance)
    // agent：扫描本机已装 agent + 读默认偏好；未选默认且扫到至少一个 → 弹首启引导。
    Promise.all([
      window.klarit.scanAgents(),
      window.klarit.getDefaultAgent(),
      window.klarit.getDefaultModel()
    ]).then(([agents, agent, model]) => {
      setDetectedAgents(agents)
      setDefaultAgent(agent)
      setDefaultModel(model)
      if (agent === null && agents.length > 0) setOnboarding(true)
    })
    // 生效主题：读入后写 <html data-theme> 驱动令牌翻色；订阅变更（切外观或系统明暗）实时更新。
    window.klarit.getEffectiveTheme().then((t) => {
      document.documentElement.dataset.theme = t
    })
    const offTheme = window.klarit.onThemeChange((t) => {
      document.documentElement.dataset.theme = t
    })
    refresh()
    refreshActiveWorkflow()
    const offTree = window.klarit.onFileTreeChange(() => setRefreshKey((k) => k + 1))
    // 引擎运行进度：流式输出按桶累积；其余事件回灌断点；状态/后台变化重载卡（卡状态在主进程跟随更新）。
    const offEngine = window.klarit.onEngineProgress((evt) => {
      if (evt.kind === 'op-chunk') {
        useCardsStore.getState().appendOutput(evt.runId, chunkBucket(evt.nodeId, { bgId: evt.bgId, cmdIndex: evt.cmdIndex }), evt.chunk)
        return
      }
      // 进入新节点：清掉上个节点残留的**已终止**后台命令窗口（运行中的转后台命令保留）。
      if (evt.kind === 'node-enter') useCardsStore.getState().pruneStoppedBackgrounds(evt.runId)
      // 后台命令登记变化：upsert 到 backgrounds（终止态保留待用户清除，不随断点消失）。
      if (evt.kind === 'background') {
        useCardsStore.getState().onBackground(evt.runId, {
          bgId: evt.bgId,
          nodeId: evt.nodeId,
          label: evt.label,
          status: evt.status === 'started' ? 'running' : evt.status
        })
      }
      void window.klarit.getRunState(evt.runId).then((bp) => {
        if (!bp) return
        useCardsStore.getState().setRun(bp)
        // 运行抵达终局：引擎已杀掉全部后台命令，清掉该运行的全部后台窗口，不留死格。
        if (bp.state === 'done' || bp.state === 'aborted') useCardsStore.getState().clearRunBackgrounds(evt.runId)
      })
      // 引擎 git 操作(建/删分支等)改的是 .git/refs、不动工作树文件，git 视图的目录 watcher 收不到；
      // 故每完成一个引擎 op 就 bump refreshKey，让 git 视图分支下拉实时重拉。
      if (evt.kind === 'op-output') setRefreshKey((k) => k + 1)
      if (evt.kind === 'state' || evt.kind === 'background') void useCardsStore.getState().load()
    })
    // 卡上分支名点击 → 主进程解析卡首仓+分支 → 切到 git 视图并定位该 worktree（按窗口持久化）。
    const offGitFocus = window.klarit.onGitViewFocus(({ repoId, branch }) => {
      const next: SidebarViewState = { view: 'git', gitMemberId: repoId, gitBranch: branch }
      setViewState(next)
      window.klarit.setSidebarView(next)
    })
    return () => {
      offTheme()
      offTree()
      offEngine()
      offGitFocus()
    }
  }, [refresh, refreshActiveWorkflow])

  const onChangeLanguage = useCallback(async (lang: SupportedLanguage) => {
    const saved = await window.klarit.setLanguage(lang)
    setLanguage(saved)
    document.documentElement.lang = saved
    // 切换语言即时重渲染界面(无需重启、无需 IPC 推送)。
    void i18n.changeLanguage(saved)
  }, [])

  // 外观偏好变更：持久化并更新本地 state；本 change 不渲染主题，故不动 documentElement。
  const onChangeAppearance = useCallback(async (next: Appearance) => {
    const saved = await window.klarit.setAppearance(next)
    setAppearance(saved)
  }, [])

  // 默认 agent 变更：持久化并同步本地；切换可能清除不匹配的模型，故一并回读模型。
  const onChangeDefaultAgent = useCallback(async (agentId: AgentId) => {
    const saved = await window.klarit.setDefaultAgent(agentId)
    setDefaultAgent(saved)
    const model = await window.klarit.getDefaultModel()
    setDefaultModel(model)
  }, [])

  const onChangeDefaultModel = useCallback(async (modelId: string) => {
    const saved = await window.klarit.setDefaultModel(modelId)
    setDefaultModel(saved)
  }, [])

  // 首启引导确认：持久化所选 agent + 模型后关闭弹窗。
  const onConfirmOnboarding = useCallback(async (agentId: AgentId, modelId: string | null) => {
    const savedAgent = await window.klarit.setDefaultAgent(agentId)
    setDefaultAgent(savedAgent)
    if (modelId !== null) {
      const savedModel = await window.klarit.setDefaultModel(modelId)
      setDefaultModel(savedModel)
    }
    setOnboarding(false)
  }, [])

  // 首启引导跳过：不写入任何偏好，仅关闭弹窗。
  const onSkipOnboarding = useCallback(() => setOnboarding(false), [])

  // 视图选择（文件树/git、git 下的成员仓与分支）变更后写回主进程按窗口持久化。
  const onChangeViewState = useCallback((next: SidebarViewState) => {
    setViewState(next)
    window.klarit.setSidebarView(next)
  }, [])

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      window.klarit.setSidebarCollapsed(next)
      return next
    })
  }, [])

  // 拖动分隔条调整侧边栏宽度：pointerdown 记录起点并捕获指针，move 钳制后实时更新，up 释放并持久化一次。
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      drag.current = { startX: e.clientX, startWidth: width }
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setResizing(true)
      e.preventDefault()
    },
    [width]
  )

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const delta = e.clientX - drag.current.startX
    setWidth(clampSidebarWidth(drag.current.startWidth + delta, window.innerWidth))
  }, [])

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setResizing(false)
    setWidth((w) => {
      window.klarit.setSidebarWidth(w)
      return w
    })
  }, [])

  const onImport = useCallback(async () => {
    // 含多子仓的目录直接组建多仓项目（无需确认）；导入后刷新以显示。
    const outcome = await window.klarit.importProject()
    if (outcome) await refresh()
  }, [refresh])

  const onSelectProject = useCallback(
    async (projectId: string) => {
      if (projectId === current?.id) return
      await window.klarit.openProject(projectId)
      // 空窗口会在本窗口绑定该项目 → 刷新以显示；已有项目则新开窗口，刷新无副作用。
      await refresh()
      // 本窗口若绑定了新项目，激活工作流随之而变 → 重读以更新看板列。
      await refreshActiveWorkflow()
    },
    [current, refresh, refreshActiveWorkflow]
  )

  const onRelocateMember = useCallback(
    async (projectId: string, memberId: string) => {
      const updated = await window.klarit.relocateMember(projectId, memberId)
      if (updated) await refresh()
    },
    [refresh]
  )

  const onRemoveProject = useCallback(
    async (projectId: string) => {
      await window.klarit.removeProject(projectId)
      await refresh()
    },
    [refresh]
  )

  return (
    <div className="flex h-full flex-col">
      <Topbar collapsed={collapsed} onToggleSidebar={toggleSidebar} />
      <div className={`flex min-h-0 flex-1${resizing ? ' select-none' : ''}`}>
        {!collapsed && (
          <Sidebar
            current={current}
            projects={projects}
            refreshKey={refreshKey}
            language={language}
            width={width}
            viewState={viewState}
            onChangeViewState={onChangeViewState}
            onSelectProject={onSelectProject}
            onImport={onImport}
            onRelocateMember={onRelocateMember}
            onRemoveProject={onRemoveProject}
            onChangeLanguage={onChangeLanguage}
            appearance={appearance}
            onChangeAppearance={onChangeAppearance}
            detectedAgents={detectedAgents}
            defaultAgent={defaultAgent}
            defaultModel={defaultModel}
            onChangeDefaultAgent={onChangeDefaultAgent}
            onChangeDefaultModel={onChangeDefaultModel}
            onActiveWorkflowChange={onActiveWorkflowChange}
            onResizeStart={onResizeStart}
            onResizeMove={onResizeMove}
            onResizeEnd={onResizeEnd}
          />
        )}
        {/* 主面板区：改 flex 行——看板 flex-1 + 详情侧抽屉推挤（无遮罩、看板让位）。浮层/蒙层/底栏仍限定在此。 */}
        <main className="relative flex min-w-0 flex-1 overflow-hidden bg-paper">
          {/* 看板区（flex-1，详情抽屉打开时让位收窄）；relative 供其内浮层定位。 */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            {/* 需求看板：列按激活工作流阶段渲染，承载本项目真需求卡（按 cardColumn 派生入列）。 */}
            <KanbanBoard
              activeWorkflow={activeWorkflow}
              cards={cards}
              cardTypes={cardTypes}
              runs={runs}
            />
            {/* 应用级文件查看器：由全局 store 驱动，供文件树及未来其它入口调用。 */}
            <FileViewer />
            {/* 新建需求流程：描述想法→建卡中→审阅候选，无蒙层浮窗；限看板区、不跨详情抽屉。 */}
            <NewRequirementFlow />
            {/* 全局对话：常驻入口「项目Agent」+ 无蒙层面板；限看板区，不漂到详情抽屉上。 */}
            <GlobalChatEntry />
            <GlobalChatPanel />
          </div>
          {/* 需求卡详情：右侧推挤式侧抽屉（含底部询问 Agent 抽屉）；关闭时 null 不占宽。 */}
          <RequirementCardDetail />
        </main>
      </div>
      {onboarding && (
        <AgentOnboardingDialog
          agents={detectedAgents}
          onConfirm={onConfirmOnboarding}
          onSkip={onSkipOnboarding}
        />
      )}
    </div>
  )
}
