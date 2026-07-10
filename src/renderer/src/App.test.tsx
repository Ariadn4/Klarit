import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import type { Project, WorkflowDefinition } from '@shared/types'
import { useFileViewerStore } from './stores/fileViewer'
import { useNewRequirementStore } from './stores/newRequirement'

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
    listCards: vi.fn(async () => []),
    listCardTypes: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    listDir: vi.fn(async () => []),
    readFile: vi.fn(async () => ({ kind: 'binary' })),
    scanAgents: vi.fn(async () => []),
    getDefaultAgent: vi.fn(async () => null),
    getDefaultModel: vi.fn(async () => null),
    setDefaultAgent: vi.fn(async (a: string) => a),
    setDefaultModel: vi.fn(async (m: string) => m),
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
