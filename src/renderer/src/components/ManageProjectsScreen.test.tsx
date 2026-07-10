import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@shared/types'
import { ManageProjectsScreen } from './ManageProjectsScreen'

function project(over: Partial<Project>): Project {
  return {
    id: 'id',
    displayName: 'name',
    derivedName: 'name',
    members: [
      {
        id: 'm',
        idKind: 'uuid',
        derivedName: 'name',
        rootPath: 'F:\\repo',
        worktreePaths: ['F:\\repo'],
        git: null,
        gitless: true
      }
    ],
    createdAt: '',
    updatedAt: '',
    ...over
  }
}

const A = project({ id: 'a', displayName: '反刍', members: [{ id: 'ma', idKind: 'path', derivedName: '反刍', rootPath: 'F:\\fanchu', worktreePaths: ['F:\\fanchu'], git: null, gitless: true }] })
const B = project({ id: 'b', displayName: 'klarit', members: [{ id: 'mb', idKind: 'path', derivedName: 'klarit', rootPath: 'F:\\klarit', worktreePaths: ['F:\\klarit'], git: null, gitless: true }] })

interface KlaritMock {
  listProjects: ReturnType<typeof vi.fn>
  getAppVersion: ReturnType<typeof vi.fn>
  openProjectFromManage: ReturnType<typeof vi.fn>
  showItemInFolder: ReturnType<typeof vi.fn>
  removeProject: ReturnType<typeof vi.fn>
  importProjectFromManage: ReturnType<typeof vi.fn>
}

function setup(projects: Project[]): KlaritMock {
  const klarit: KlaritMock = {
    listProjects: vi.fn().mockResolvedValue(projects),
    getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
    openProjectFromManage: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
    removeProject: vi.fn().mockResolvedValue([]),
    importProjectFromManage: vi.fn().mockResolvedValue(null)
  }
  ;(window as unknown as { klarit: KlaritMock }).klarit = klarit
  return klarit
}

describe('ManageProjectsScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('列出全部项目（名称 + 父目录路径）与版本号', async () => {
    setup([A, B])
    render(<ManageProjectsScreen />)
    expect(await screen.findByText('反刍')).toBeInTheDocument()
    expect(screen.getByText('klarit')).toBeInTheDocument()
    // 路径只显示父目录（不与项目名重复）：F:\fanchu → F:\、F:\klarit → F:\
    expect(screen.getAllByText('F:\\')).toHaveLength(2)
    expect(await screen.findByText(/版本 0\.1\.0/)).toBeInTheDocument()
  })

  it('点击条目调 openProjectFromManage', async () => {
    const klarit = setup([A, B])
    render(<ManageProjectsScreen />)
    await userEvent.click(await screen.findByText('反刍'))
    expect(klarit.openProjectFromManage).toHaveBeenCalledWith('a')
  })

  it('三点菜单「在资源管理器中显示文件夹」调 showItemInFolder', async () => {
    const klarit = setup([A])
    render(<ManageProjectsScreen />)
    await screen.findByText('反刍')
    await userEvent.click(screen.getByRole('button', { name: /更多操作/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /在资源管理器中显示文件夹/ }))
    expect(klarit.showItemInFolder).toHaveBeenCalledWith('F:\\fanchu')
  })

  it('三点菜单「从项目列表中移除」调 removeProject 并刷新清单', async () => {
    const klarit = setup([A])
    klarit.removeProject.mockResolvedValue([])
    render(<ManageProjectsScreen />)
    await screen.findByText('反刍')
    await userEvent.click(screen.getByRole('button', { name: /更多操作/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /从项目列表中移除/ }))
    expect(klarit.removeProject).toHaveBeenCalledWith('a')
    await waitFor(() => expect(screen.queryByText('反刍')).not.toBeInTheDocument())
  })

  it('点三点按钮不触发打开项目', async () => {
    const klarit = setup([A])
    render(<ManageProjectsScreen />)
    await screen.findByText('反刍')
    await userEvent.click(screen.getByRole('button', { name: /更多操作/ }))
    expect(klarit.openProjectFromManage).not.toHaveBeenCalled()
  })

  it('无项目时不渲染条目，右侧「打开本地项目」仍可用', async () => {
    const klarit = setup([])
    render(<ManageProjectsScreen />)
    expect(await screen.findByText('还没有导入任何项目。')).toBeInTheDocument()
    const open = screen.getByRole('button', { name: /打开本地项目/ })
    await userEvent.click(open)
    expect(klarit.importProjectFromManage).toHaveBeenCalledOnce()
  })
})
