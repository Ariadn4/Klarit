import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, RepoMember } from '@shared/types'
import { Sidebar } from './Sidebar'

// Sidebar 内的 FileTree/GitView 走 window.klarit——测试里给个最小桩。
beforeEach(() => {
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = {
    listDir: vi.fn(async () => []),
    listBranches: vi.fn(async () => ({ current: 'main', branches: ['main'] })),
    listWorktrees: vi.fn(async () => ({ worktrees: [{ path: '/solo', branch: 'main' }] })),
    setGitWatchPath: vi.fn(async () => {})
  }
})

function member(id: string, over: Partial<RepoMember> = {}): RepoMember {
  return {
    id,
    idKind: 'uuid',
    derivedName: id,
    rootPath: `/${id}`,
    worktreePaths: [`/${id}`],
    git: { branch: 'main', remote: null, commonDir: `/${id}/.git` },
    gitless: false,
    ...over
  }
}

function project(members: RepoMember[]): Project {
  return {
    id: 'p',
    displayName: '产品',
    derivedName: '产品',
    members,
    createdAt: '',
    updatedAt: ''
  }
}

const noop = (): void => {}

function renderSidebar(current: Project | null, over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(
    <Sidebar
      current={current}
      projects={current ? [current] : []}
      refreshKey={0}
      language="zh"
      width={240}
      viewState={{ view: 'files', gitMemberId: null, gitBranch: null }}
      onChangeViewState={noop}
      onSelectProject={noop}
      onImport={noop}
      onRelocateMember={noop}
      onRemoveProject={noop}
      onChangeLanguage={noop}
      appearance="system"
      onChangeAppearance={noop}
      detectedAgents={[]}
      defaultAgent={null}
      defaultModel={null}
      defaultEffort={null}
      onChangeDefaultAgent={noop}
      onChangeDefaultModel={noop}
      onChangeDefaultEffort={noop}
      {...over}
    />
  )
}

describe('Sidebar 文件树视图 = 项目目录浏览器', () => {
  it('单仓项目以该仓目录为根渲染文件树', () => {
    const listDir = vi.fn(async () => [])
    ;(window as unknown as { klarit: { listDir: typeof listDir } }).klarit.listDir = listDir
    renderSidebar(project([member('solo', { rootPath: '/solo' })]))
    expect(listDir).toHaveBeenCalledWith('/solo')
    // 没有成员分组的「解绑」按钮
    expect(screen.queryByRole('button', { name: /解绑/ })).not.toBeInTheDocument()
  })

  it('多仓项目以成员公共父目录为根、不再按成员分组', () => {
    const listDir = vi.fn(async () => [])
    ;(window as unknown as { klarit: { listDir: typeof listDir } }).klarit.listDir = listDir
    renderSidebar(
      project([
        member('frontend', { rootPath: '/product/frontend' }),
        member('backend', { rootPath: '/product/backend' })
      ])
    )
    // 文件树根在项目目录（公共父目录），不再为每个成员仓加分组标题
    expect(listDir).toHaveBeenCalledWith('/product')
    expect(screen.queryByText('frontend')).not.toBeInTheDocument()
    expect(screen.queryByText('backend')).not.toBeInTheDocument()
  })

  it('项目目录缺失（全部成员缺失）时显示项目级提示，可移除', async () => {
    const onRemoveProject = vi.fn()
    renderSidebar(
      project([
        member('frontend', { missing: true }),
        member('backend', { missing: true })
      ]),
      { onRemoveProject }
    )
    expect(screen.getByText(/项目的目录在磁盘上找不到/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /从项目列表中移除/ }))
    expect(onRemoveProject).toHaveBeenCalledWith('p')
  })

  it('单仓项目目录缺失时可重新定位', async () => {
    const onRelocate = vi.fn()
    renderSidebar(project([member('solo', { missing: true })]), { onRelocateMember: onRelocate })
    await userEvent.click(screen.getByRole('button', { name: /重新定位/ }))
    expect(onRelocate).toHaveBeenCalledWith('p', 'solo')
  })

  it('不再展示「关联成员仓」入口（成员仓由项目子目录自动构成）', () => {
    renderSidebar(project([member('solo')]))
    expect(screen.queryByRole('button', { name: /关联成员仓/ })).not.toBeInTheDocument()
  })
})

describe('Sidebar 视图切换条', () => {
  it('默认文件夹 icon 选中（aria-pressed），git icon 未选', () => {
    renderSidebar(project([member('solo')]))
    expect(screen.getByRole('button', { name: '文件树视图' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'git 视图' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('点击 git icon 触发 onChangeViewState 切到 git', async () => {
    const onChange = vi.fn()
    renderSidebar(project([member('solo')]), { onChangeViewState: onChange })
    await userEvent.click(screen.getByRole('button', { name: 'git 视图' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'git' })
    )
  })

  it('git 视图下点击文件夹 icon 触发 onChangeViewState 切回 files', async () => {
    const onChange = vi.fn()
    renderSidebar(project([member('solo')]), {
      viewState: { view: 'git', gitMemberId: null, gitBranch: null },
      onChangeViewState: onChange
    })
    await userEvent.click(screen.getByRole('button', { name: '文件树视图' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ view: 'files' }))
  })

  it('view=files 渲染文件树视图，view=git 渲染 git 视图', () => {
    const { rerender } = renderSidebar(project([member('solo')]))
    // files 视图：无 git 视图标志性的成员仓选择器按钮
    expect(screen.queryByRole('button', { name: /切换成员仓/ })).not.toBeInTheDocument()
    rerender(
      <Sidebar
        current={project([member('solo')])}
        projects={[]}
        refreshKey={0}
        language="zh"
        width={240}
        viewState={{ view: 'git', gitMemberId: 'solo', gitBranch: 'main' }}
        onChangeViewState={noop}
        onSelectProject={noop}
        onImport={noop}
        onRelocateMember={noop}
        onRemoveProject={noop}
        onChangeLanguage={noop}
        appearance="system"
        onChangeAppearance={noop}
        detectedAgents={[]}
        defaultAgent={null}
        defaultModel={null}
        defaultEffort={null}
        onChangeDefaultAgent={noop}
        onChangeDefaultModel={noop}
        onChangeDefaultEffort={noop}
      />
    )
    expect(screen.getByRole('button', { name: /切换成员仓/ })).toBeInTheDocument()
  })
})

describe('Sidebar 新建需求入口已移除', () => {
  it('侧边栏不再渲染「新建需求」入口（已移至看板「待办」列）', () => {
    renderSidebar(project([member('m1')]))
    expect(screen.queryByRole('button', { name: '新建需求' })).not.toBeInTheDocument()
  })
})

describe('Sidebar 宽度可调', () => {
  it('按 width prop 应用内联宽度（不再写死 w-60）', () => {
    const { container } = renderSidebar(null, { width: 320 })
    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()
    expect(aside).toHaveStyle({ width: '320px' })
    expect(aside?.className).not.toContain('w-60')
  })

  it('渲染右边缘分隔条，带 col-resize 光标，pointerDown 触发回调', async () => {
    const onResizeStart = vi.fn()
    renderSidebar(null, { width: 240, onResizeStart })
    const handle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    expect(handle.className).toContain('cursor-col-resize')
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(onResizeStart).toHaveBeenCalled()
  })
})
