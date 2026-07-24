import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import type { Project, WorkflowDefinition } from '@shared/types'
import { useFileViewerStore } from './stores/fileViewer'
import { useNewRequirementStore } from './stores/newRequirement'
import { useCardsStore } from './stores/cards'
import { useGlobalChatStore } from './stores/globalChat'
import { useModalQueue } from './stores/modalQueue'
import { useWorkflowGenStore } from './stores/workflowGen'

interface KlaritMock {
  getSidebarWidth: ReturnType<typeof vi.fn>
  setSidebarWidth: ReturnType<typeof vi.fn>
  [k: string]: unknown
}

function installKlarit(over: Partial<KlaritMock> = {}): KlaritMock {
  const api: KlaritMock = {
    getSidebarCollapsed: vi.fn(async () => false),
    setSidebarCollapsed: vi.fn(async () => {}),
    getLanguage: vi.fn(async () => 'zh'),
    getAppearance: vi.fn(async () => 'system'),
    setAppearance: vi.fn(async (a: string) => a),
    getEffectiveTheme: vi.fn(async () => 'light'),
    onThemeChange: vi.fn(() => () => {}),
    onProjectBound: vi.fn(() => () => {}),
    onDocumentsOnboard: vi.fn(() => () => {}),
    onProjectsChanged: vi.fn(() => () => {}),
    onCardsChanged: vi.fn(() => () => {}),
    onWorkflowProposalReady: vi.fn(() => () => {}),
    onWorkflowGenStatus: vi.fn(() => () => {}),
    getSidebarWidth: vi.fn(async () => 240),
    setSidebarWidth: vi.fn(async () => {}),
    getSidebarView: vi.fn(async () => ({ view: 'files', gitMemberId: null, gitBranch: null })),
    setSidebarView: vi.fn(async () => {}),
    listBranches: vi.fn(async () => ({ current: null, branches: [] })),
    listWorktrees: vi.fn(async () => ({ worktrees: [] })),
    getCurrentProject: vi.fn(async () => null),
    listProjects: vi.fn(async () => []),
    onFileTreeChange: vi.fn(() => () => {}),
    onEngineProgress: vi.fn(() => () => {}),
    onGitViewFocus: vi.fn(() => () => {}),
    getRunState: vi.fn(async () => null),
    cardBranches: vi.fn(async () => []),
    focusCardGitView: vi.fn(async () => {}),
    setGitWatchPath: vi.fn(async () => {}),
    listCards: vi.fn(async () => []),
    listCardTypes: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    listDir: vi.fn(async () => []),
    readFile: vi.fn(async () => ({ kind: 'binary' })),
    scanAgents: vi.fn(async () => []),
    getDefaultAgent: vi.fn(async () => null),
    getDefaultModel: vi.fn(async () => null),
    getDefaultEffort: vi.fn(async () => null),
    setDefaultAgent: vi.fn(async (a: string) => a),
    setDefaultModel: vi.fn(async (m: string) => m),
    setDefaultEffort: vi.fn(async (e: string | null) => e),
    getActiveWorkflow: vi.fn(async () => null),
    getWorkflow: vi.fn(async () => null),
    getDecomposePrompt: vi.fn(async () => ({ prompt: 'p' })),
    decomposeRequirement: vi.fn(async () => ({ candidates: [], issues: [] })),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api
}

beforeEach(() => {
  installKlarit()
  useFileViewerStore.setState({ tabs: [], activePath: null, popupOpen: false })
  useNewRequirementStore.getState().cancel()
  // 详情态跨用例会驱动「开卡联动 git 视图」副作用，逐用例复位避免泄漏。
  useCardsStore.setState({ cards: [], runs: {}, detailSlug: null, detailFocus: null })
  // 工作流预览浮层为全局 store 驱动、跨用例常驻，逐用例复位避免泄漏。
  useGlobalChatStore.setState({ workflowPreview: null, open: false, savedWorkflowAt: [] })
  // 全局模态协调器 / 工作流生成状态亦为常驻单例 store，逐用例复位避免队列/状态泄漏。
  useModalQueue.setState({ openIds: new Set(), queue: [] })
  useWorkflowGenStore.setState({ generating: false })
})

function workflow(stages: { id: string; name: string }[]): WorkflowDefinition {
  return { id: 'w', name: { zh: 'W' }, stages: stages.map((s) => ({ id: s.id, name: { zh: s.name } })), nodes: [] }
}

/** 单仓项目（项目目录 = 其唯一成员路径），用于让侧边栏渲染文件树。 */
function singleRepoProject(rootPath: string): Project {
  return {
    id: 'p1',
    displayName: 'proj',
    derivedName: 'proj',
    members: [
      {
        id: 'm1',
        idKind: 'path',
        derivedName: 'proj',
        rootPath,
        worktreePaths: [rootPath],
        git: null,
        gitless: true
      }
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function aside(): HTMLElement | null {
  return document.querySelector('aside')
}

async function drag(fromX: number, toX: number): Promise<void> {
  const handle = await screen.findByRole('separator', { name: '调整侧边栏宽度' })
  handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: fromX }))
  handle.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: toX }))
  handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: toX }))
}

describe('App 主题应用', () => {
  it('挂载后按生效主题写 data-theme', async () => {
    installKlarit({ getEffectiveTheme: vi.fn(async () => 'dark') })
    render(<App />)
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    )
  })

  it('收到 onThemeChange 推送后同步更新 data-theme', async () => {
    let push: ((t: string) => void) | undefined
    installKlarit({
      getEffectiveTheme: vi.fn(async () => 'dark'),
      onThemeChange: vi.fn((cb: (t: string) => void) => {
        push = cb
        return () => {}
      })
    })
    render(<App />)
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    )
    act(() => push?.('light'))
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    )
  })
})

describe('App 侧边栏宽度', () => {
  it('挂载时读取并应用持久化宽度', async () => {
    const api = installKlarit({ getSidebarWidth: vi.fn(async () => 300) })
    render(<App />)
    await waitFor(() => expect(aside()).toHaveStyle({ width: '300px' }))
    expect(api.getSidebarWidth).toHaveBeenCalled()
  })

  it('拖动分隔条更新宽度，松手持久化一次', async () => {
    const api = installKlarit({ getSidebarWidth: vi.fn(async () => 240) })
    render(<App />)
    await screen.findByRole('separator', { name: '调整侧边栏宽度' })
    await drag(100, 180) // delta +80 → 320

    await waitFor(() => expect(aside()).toHaveStyle({ width: '320px' }))
    expect(api.setSidebarWidth).toHaveBeenCalledTimes(1)
    expect(api.setSidebarWidth).toHaveBeenCalledWith(320)
  })

  it('折叠再展开后宽度仍为用户上次拖动的值', async () => {
    installKlarit({ getSidebarWidth: vi.fn(async () => 240) })
    render(<App />)
    await screen.findByRole('separator', { name: '调整侧边栏宽度' })
    await drag(100, 180) // → 320
    await waitFor(() => expect(aside()).toHaveStyle({ width: '320px' }))

    await userEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))
    expect(aside()).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    await waitFor(() => expect(aside()).toHaveStyle({ width: '320px' }))
  })
})

describe('App 需求看板', () => {
  it('挂载时拉取激活工作流并按阶段渲染列（与浮层并存）', async () => {
    const api = installKlarit({
      getActiveWorkflow: vi.fn(async () => 'w'),
      getWorkflow: vi.fn(async () => workflow([{ id: 's1', name: '开发' }]))
    })
    render(<App />)
    // 书挡列 + 阶段列都在主面板渲染。
    expect(await screen.findByRole('region', { name: '待办' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '开发' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '已完成' })).toBeInTheDocument()
    expect(api.getActiveWorkflow).toHaveBeenCalled()
    expect(api.getWorkflow).toHaveBeenCalledWith('w')
  })

  it('未激活工作流时只渲染两列书挡', async () => {
    render(<App />)
    expect(await screen.findByRole('region', { name: '待办' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '已完成' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '开发' })).not.toBeInTheDocument()
  })

  it('点击「待办」列「+ 创建」触发新建需求流程（已绑定项目进描述想法窗）', async () => {
    render(<App />)
    const create = await screen.findByRole('button', { name: '新建需求' })
    await userEvent.click(create)
    expect(await screen.findByText('描述想法')).toBeInTheDocument()
  })
})

describe('App 打开详情联动 git 视图', () => {
  beforeEach(() => {
    useCardsStore.setState({ cards: [], runs: {}, detailSlug: null, detailFocus: null })
  })

  it('打开有分支的卡且侧栏未显示该分支 → 切到 git 视图（传首仓 memberId）', async () => {
    const api = installKlarit({
      cardBranches: vi.fn(async () => [{ memberId: 'A', name: 'web', branch: 'feat/x' }]),
      focusCardGitView: vi.fn(async () => {})
    })
    render(<App />)
    await waitFor(() => expect(api.getSidebarView).toHaveBeenCalled())
    act(() => {
      useCardsStore.getState().openDetail('add-thing')
    })
    await waitFor(() => expect(api.focusCardGitView).toHaveBeenCalledWith('add-thing', 'A'))
  })

  it('侧栏已在显示该（成员仓, 分支）→ 不重复切换', async () => {
    let gitFocusCb: ((req: { repoId: string; branch: string }) => void) | undefined
    const api = installKlarit({
      onGitViewFocus: vi.fn((cb: (req: { repoId: string; branch: string }) => void) => {
        gitFocusCb = cb
        return () => {}
      }),
      cardBranches: vi.fn(async () => [{ memberId: 'A', name: 'web', branch: 'feat/x' }]),
      focusCardGitView: vi.fn(async () => {})
    })
    render(<App />)
    await waitFor(() => expect(api.getSidebarView).toHaveBeenCalled())
    // 先把侧栏确定性地置为 git/A/feat/x（走既有 onGitViewFocus 通道）。
    act(() => gitFocusCb?.({ repoId: 'A', branch: 'feat/x' }))
    act(() => {
      useCardsStore.getState().openDetail('add-thing')
    })
    await waitFor(() => expect(api.cardBranches).toHaveBeenCalledWith('add-thing'))
    expect(api.focusCardGitView).not.toHaveBeenCalled()
  })

  it('打开未建分支的卡 → 不联动切换', async () => {
    const api = installKlarit({
      cardBranches: vi.fn(async () => []),
      focusCardGitView: vi.fn(async () => {})
    })
    render(<App />)
    await waitFor(() => expect(api.getSidebarView).toHaveBeenCalled())
    act(() => {
      useCardsStore.getState().openDetail('add-thing')
    })
    await waitFor(() => expect(api.cardBranches).toHaveBeenCalledWith('add-thing'))
    expect(api.focusCardGitView).not.toHaveBeenCalled()
  })
})

describe('App 文档确认步（导入后）', () => {
  const emptyRegistry = { memberId: 'm1', docs: [], conventionPreamble: '', conventionApproved: false }
  const scannedRegistry = {
    memberId: 'm1',
    docs: [
      { id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }
    ],
    conventionPreamble: '',
    conventionApproved: false
  }

  it('新导入项目绑定本窗口（projectBound）→ 不再自动弹文档确认步（改需求驱动）', async () => {
    let boundCb: (() => void) | undefined
    const fresh = singleRepoProject('/p')
    fresh.createdAt = new Date().toISOString()
    const api = installKlarit({
      onProjectBound: vi.fn((cb: () => void) => {
        boundCb = cb
        return () => {}
      }),
      getCurrentProject: vi.fn(async () => fresh),
      getDocuments: vi.fn(async () => emptyRegistry),
      analyzeDocuments: vi.fn(async () => ({ registry: scannedRegistry, error: null })),
      saveDocuments: vi.fn(async () => undefined)
    })
    render(<App />)
    await waitFor(() => expect(api.getSidebarView).toHaveBeenCalled())
    act(() => boundCb?.())
    // projectBound 仍刷新项目（getCurrentProject 再被调），但首次导入不再无条件弹文档 onboarding / 跑 analyze。
    await waitFor(() =>
      expect((api.getCurrentProject as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
    )
    expect(screen.queryByRole('dialog', { name: '文档登记表' })).toBeNull()
    expect(api.analyzeDocuments).not.toHaveBeenCalled()
  })

  it('导入进行中显示加载指示，完成后不再自动弹文档确认步（改需求驱动）', async () => {
    let resolveImport: ((v: unknown) => void) | undefined
    const fresh = singleRepoProject('/p')
    fresh.createdAt = new Date().toISOString()
    const api = installKlarit({
      importProject: vi.fn(
        () =>
          new Promise((r) => {
            resolveImport = r
          })
      ),
      getCurrentProject: vi.fn(async () => fresh),
      getDocuments: vi.fn(async () => emptyRegistry),
      analyzeDocuments: vi.fn(async () => ({ registry: scannedRegistry, error: null })),
      saveDocuments: vi.fn(async () => undefined)
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '导入新项目' }))
    // 导入/识别期间显示加载指示。
    expect(await screen.findByText('正在导入项目…')).toBeInTheDocument()
    act(() => resolveImport?.({ project: fresh, reused: false }))
    // 加载指示消失，但首次导入不再无条件弹文档 onboarding / 跑 analyze。
    await waitFor(() => expect(screen.queryByText('正在导入项目…')).toBeNull())
    expect(screen.queryByRole('dialog', { name: '文档登记表' })).toBeNull()
    expect(api.analyzeDocuments).not.toHaveBeenCalled()
  })

  it('主进程推送 documents:onboard（管理窗导入/移除后立刻重导入）→ 立即弹文档确认步', async () => {
    let onboardCb: ((memberId: string) => void) | undefined
    const api = installKlarit({
      onDocumentsOnboard: vi.fn((cb: (memberId: string) => void) => {
        onboardCb = cb
        return () => {}
      }),
      getDocuments: vi.fn(async () => emptyRegistry),
      analyzeDocuments: vi.fn(async () => ({ registry: scannedRegistry, error: null })),
      saveDocuments: vi.fn(async () => undefined)
    })
    render(<App />)
    await waitFor(() => expect(api.getSidebarView).toHaveBeenCalled())
    act(() => onboardCb?.('m1'))
    expect(await screen.findByRole('dialog', { name: '文档登记表' })).toBeInTheDocument()
    await waitFor(() => expect(api.analyzeDocuments).toHaveBeenCalledWith('m1'))
  })

  it('旧项目绑定（创建已久）不弹文档确认步', async () => {
    let boundCb: (() => void) | undefined
    const api = installKlarit({
      onProjectBound: vi.fn((cb: () => void) => {
        boundCb = cb
        return () => {}
      }),
      getCurrentProject: vi.fn(async () => singleRepoProject('/p')), // createdAt=2026-01-01（久远）
      getDocuments: vi.fn(async () => emptyRegistry),
      analyzeDocuments: vi.fn(async () => ({ registry: scannedRegistry, error: null }))
    })
    render(<App />)
    await waitFor(() => expect(api.getSidebarView).toHaveBeenCalled())
    act(() => boundCb?.())
    await waitFor(() => expect(api.getCurrentProject).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: '文档登记表' })).toBeNull()
    expect(api.analyzeDocuments).not.toHaveBeenCalled()
  })
})

describe('App 注册表变更广播', () => {
  it('收到 projects:changed 后刷新：被移除项目从切换器消失、当前窗口回空态', async () => {
    let projectsCb: (() => void) | undefined
    const proj = singleRepoProject('/p')
    let projects = [proj]
    const api = installKlarit({
      onProjectsChanged: vi.fn((cb: () => void) => {
        projectsCb = cb
        return () => {}
      }),
      getCurrentProject: vi.fn(async () => (projects.length > 0 ? proj : null)),
      listProjects: vi.fn(async () => projects)
    })
    render(<App />)
    // 挂载后切换器显示当前项目名（项目名可能同时出现在文件树分组，用 findAll）。
    expect((await screen.findAllByText('proj')).length).toBeGreaterThan(0)
    // 管理窗移除该项目 → 主进程广播 → 本窗口刷新。
    projects = []
    act(() => projectsCb?.())
    await waitFor(() => expect(screen.queryByText('proj')).toBeNull())
    // 无项目后切换器回「导入新项目」空态。
    expect(screen.getByRole('button', { name: '导入新项目' })).toBeInTheDocument()
    expect((api.listProjects as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('App 工作流提案主动露出', () => {
  it('收到 onWorkflowProposalReady 推送后打开对话面板并选中承载提案的会话（无需先开面板）', async () => {
    let readyCb: ((p: { projectId: string; conversationId: string }) => void) | undefined
    const api = installKlarit({
      onWorkflowProposalReady: vi.fn((cb: (p: { projectId: string; conversationId: string }) => void) => {
        readyCb = cb
        return () => {}
      }),
      listConversations: vi.fn(async () => [
        { id: 'conv-x', projectId: 'p1', title: 't', messages: [], createdAt: 1, updatedAt: 1 }
      ]),
      getConversation: vi.fn(async (id: string) => ({
        id,
        projectId: 'p1',
        title: 't',
        messages: [],
        createdAt: 1,
        updatedAt: 1
      }))
    })
    render(<App />)
    await waitFor(() => expect(api.onWorkflowProposalReady).toHaveBeenCalled())
    // 面板初始关闭。
    expect(useGlobalChatStore.getState().open).toBe(false)
    await act(async () => {
      readyCb?.({ projectId: 'p1', conversationId: 'conv-x' })
    })
    // 无模态在开 → 立即打开对话面板并选中承载该提案的会话。
    await waitFor(() => expect(useGlobalChatStore.getState().open).toBe(true))
    expect(useGlobalChatStore.getState().activeId).toBe('conv-x')
    expect(api.getConversation).toHaveBeenCalledWith('conv-x')
  })

  it('文档 onboarding 开着时收到就绪推送不叠加，待其关闭再打开对话面板', async () => {
    let onboardCb: ((memberId: string) => void) | undefined
    let readyCb: ((p: { projectId: string; conversationId: string }) => void) | undefined
    const scannedRegistry = {
      memberId: 'm1',
      docs: [{ id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }],
      conventionPreamble: '',
      conventionApproved: false
    }
    installKlarit({
      onDocumentsOnboard: vi.fn((cb: (memberId: string) => void) => {
        onboardCb = cb
        return () => {}
      }),
      onWorkflowProposalReady: vi.fn((cb: (p: { projectId: string; conversationId: string }) => void) => {
        readyCb = cb
        return () => {}
      }),
      getDocuments: vi.fn(async () => ({ memberId: 'm1', docs: [], conventionPreamble: '', conventionApproved: false })),
      analyzeDocuments: vi.fn(async () => ({ registry: scannedRegistry, error: null })),
      saveDocuments: vi.fn(async () => undefined),
      listConversations: vi.fn(async () => [
        { id: 'conv-x', projectId: 'p1', title: 't', messages: [], createdAt: 1, updatedAt: 1 }
      ]),
      getConversation: vi.fn(async (id: string) => ({
        id,
        projectId: 'p1',
        title: 't',
        messages: [],
        createdAt: 1,
        updatedAt: 1
      }))
    })
    render(<App />)
    // 先让文档 onboarding 弹出（登记进协调器）。
    act(() => onboardCb?.('m1'))
    expect(await screen.findByRole('dialog', { name: '文档登记表' })).toBeInTheDocument()

    // 此刻推送就绪：应排队、不叠加——对话面板不打开。
    await act(async () => {
      readyCb?.({ projectId: 'p1', conversationId: 'conv-x' })
    })
    expect(useGlobalChatStore.getState().open).toBe(false)

    // 关闭文档 onboarding（跳过）→ 协调器出队 → 对话面板这才打开并选中该会话。
    await userEvent.click(screen.getByRole('button', { name: '跳过' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '文档登记表' })).toBeNull())
    await waitFor(() => expect(useGlobalChatStore.getState().open).toBe(true))
    expect(useGlobalChatStore.getState().activeId).toBe('conv-x')
  })

  it('底栏工作流生成指示：收到 generating 事件显示，done 后清除', async () => {
    let genCb: ((phase: 'generating' | 'done' | 'failed') => void) | undefined
    installKlarit({
      onWorkflowGenStatus: vi.fn((cb: (phase: 'generating' | 'done' | 'failed') => void) => {
        genCb = cb
        return () => {}
      })
    })
    render(<App />)
    await waitFor(() => expect(useWorkflowGenStore.getState()).toBeTruthy())
    act(() => genCb?.('generating'))
    expect(await screen.findByText('正在为本项目生成工作流…')).toBeInTheDocument()
    act(() => genCb?.('done'))
    await waitFor(() => expect(screen.queryByText('正在为本项目生成工作流…')).toBeNull())
  })
})

describe('App 文件查看器', () => {
  it('点击文件树里的文件后查看器浮层出现并展示该文件', async () => {
    installKlarit({
      getCurrentProject: vi.fn(async () => singleRepoProject('/p')),
      listDir: vi.fn(async () => [{ name: 'README.md', path: '/p/README.md', kind: 'file' }])
    })
    render(<App />)
    await userEvent.click(await screen.findByText('README.md'))
    // 浮层出现：蒙层 + 以该文件名命名的标签。
    expect(await screen.findByTestId('viewer-scrim')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /README\.md/ })).toBeInTheDocument()
  })
})
