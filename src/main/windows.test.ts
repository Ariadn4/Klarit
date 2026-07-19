import { describe, it, expect, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { FileTreeChange, RegistryData, WindowState } from '../shared/types'
import { DEFAULT_SIDEBAR_WIDTH } from '../shared/sidebar'
import { WindowManager } from './windows'

// 监听用真实 fs/chokidar 太重——把 fs.existsSync 与 watchProject 桩掉，捕获 onChange 以驱动断言。
vi.mock('node:fs', () => ({ existsSync: () => true }))
const watchCalls: Array<{ root: string; onChange: (c: FileTreeChange) => void; close: () => void }> =
  []
vi.mock('./filetree', () => ({
  watchProject: (root: string, _id: string, onChange: (c: FileTreeChange) => void) => {
    const watcher = { close: vi.fn() }
    watchCalls.push({ root, onChange, close: watcher.close })
    return watcher
  }
}))

// 最小化的 BrowserWindow 桩——只实现 WindowManager 用到的成员。
function fakeWindow(id: number): BrowserWindow {
  return {
    id,
    on: vi.fn(),
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    focus: vi.fn(),
    webContents: { send: vi.fn() }
  } as unknown as BrowserWindow
}

function makeManager(over: { notifyBound?: (win: BrowserWindow) => void } = {}): {
  manager: WindowManager
  created: WindowState[]
} {
  const registry: RegistryData = { projects: [] }
  const created: WindowState[] = []
  let nextId = 1
  const manager = new WindowManager({
    registry,
    saveRegistry: vi.fn(),
    newWindow: (state) => {
      if (state) created.push(state)
      return fakeWindow(nextId++)
    },
    serviceDeps: {} as never,
    notifyBound: over.notifyBound
  })
  return { manager, created }
}

describe('WindowManager 侧边栏宽度', () => {
  it('空窗口默认宽度为 DEFAULT_SIDEBAR_WIDTH', () => {
    const { manager } = makeManager()
    const win = manager.createEmptyWindow()
    expect(manager.getSidebarWidth(win)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('setSidebarWidth 后 getSidebarWidth 返回写入值', () => {
    const { manager } = makeManager()
    const win = manager.createEmptyWindow()
    manager.setSidebarWidth(win, 320)
    expect(manager.getSidebarWidth(win)).toBe(320)
  })

  it('openProject 从 state.sidebarWidth 恢复宽度', () => {
    const { manager } = makeManager()
    const win = manager.openProject('p1', { sidebarWidth: 300 })
    expect(manager.getSidebarWidth(win)).toBe(300)
  })

  it('openProject 缺省 sidebarWidth 时回退默认值', () => {
    const { manager } = makeManager()
    const win = manager.openProject('p1')
    expect(manager.getSidebarWidth(win)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('openProject 把宽度传入 newWindow 的初始 state', () => {
    const { manager, created } = makeManager()
    manager.openProject('p1', { sidebarWidth: 280 })
    expect(created.at(-1)?.sidebarWidth).toBe(280)
  })

  it('snapshotSession 输出含当前宽度', () => {
    const { manager } = makeManager()
    const win = manager.openProject('p1', { sidebarWidth: 300 })
    manager.setSidebarWidth(win, 360)
    const snap = manager.snapshotSession()
    const entry = snap.windows.find((w) => w.projectId === 'p1')
    expect(entry?.sidebarWidth).toBe(360)
  })
})

describe('WindowManager 侧边栏视图', () => {
  it('空窗口默认视图为 files，git 选择为 null', () => {
    const { manager } = makeManager()
    const win = manager.createEmptyWindow()
    expect(manager.getSidebarView(win)).toEqual({
      view: 'files',
      gitMemberId: null,
      gitBranch: null
    })
  })

  it('setSidebarView 后 getSidebarView 返回写入值', () => {
    const { manager } = makeManager()
    const win = manager.createEmptyWindow()
    manager.setSidebarView(win, { view: 'git', gitMemberId: 'm1', gitBranch: 'feature' })
    expect(manager.getSidebarView(win)).toEqual({
      view: 'git',
      gitMemberId: 'm1',
      gitBranch: 'feature'
    })
  })

  it('openProject 从 state 恢复视图与 git 选择', () => {
    const { manager } = makeManager()
    const win = manager.openProject('p1', {
      sidebarView: 'git',
      gitMemberId: 'm2',
      gitBranch: 'dev'
    })
    expect(manager.getSidebarView(win)).toEqual({
      view: 'git',
      gitMemberId: 'm2',
      gitBranch: 'dev'
    })
  })

  it('snapshotSession 输出含当前视图与 git 选择', () => {
    const { manager } = makeManager()
    const win = manager.openProject('p1')
    manager.setSidebarView(win, { view: 'git', gitMemberId: 'm1', gitBranch: 'main' })
    const snap = manager.snapshotSession()
    const entry = snap.windows.find((w) => w.projectId === 'p1')
    expect(entry?.sidebarView).toBe('git')
    expect(entry?.gitMemberId).toBe('m1')
    expect(entry?.gitBranch).toBe('main')
  })
})

describe('WindowManager.openOrFocus', () => {
  it('已有窗口绑定该项目时聚焦置前，不新开窗口', () => {
    const { manager, created } = makeManager()
    const w1 = manager.openProject('p1')
    const before = created.length
    const w2 = manager.openOrFocus('p1')
    expect(w2).toBe(w1)
    expect(w1.focus).toHaveBeenCalled()
    expect(created.length).toBe(before)
  })

  it('存在空状态窗口时就地绑定并聚焦，不新开窗口', () => {
    const { manager, created } = makeManager()
    const empty = manager.createEmptyWindow()
    const before = created.length
    const w = manager.openOrFocus('p1')
    expect(w).toBe(empty)
    expect(empty.focus).toHaveBeenCalled()
    expect(created.length).toBe(before)
  })

  it('无已开窗口也无空窗口时开新窗口', () => {
    const { manager, created } = makeManager()
    const before = created.length
    manager.openOrFocus('p1')
    expect(created.length).toBe(before + 1)
  })

  it('已绑定窗口选别的项目仍开新窗口（不复用已绑定窗口）', () => {
    const { manager, created } = makeManager()
    const w1 = manager.openProject('p1')
    const before = created.length
    const w2 = manager.openOrFocus('p2')
    expect(w2).not.toBe(w1)
    expect(created.length).toBe(before + 1)
  })
})

describe('WindowManager 绑定后通知渲染层（修复：复用空窗口不刷新的空屏 bug）', () => {
  it('openOrFocus 复用空窗口绑定项目时，通知该窗口渲染层重启', () => {
    const notifyBound = vi.fn()
    const { manager } = makeManager({ notifyBound })
    const empty = manager.createEmptyWindow()
    const bound = manager.openOrFocus('p1')
    expect(bound).toBe(empty)
    expect(notifyBound).toHaveBeenCalledWith(empty)
  })

  it('bindWindow 直接绑定空窗口时也通知渲染层', () => {
    const notifyBound = vi.fn()
    const { manager } = makeManager({ notifyBound })
    const empty = manager.createEmptyWindow()
    manager.bindWindow(empty, 'p1')
    expect(notifyBound).toHaveBeenCalledWith(empty)
  })

  it('openProject 新开窗口时不通知（新窗口自加载、无需刷新）', () => {
    const notifyBound = vi.fn()
    const { manager } = makeManager({ notifyBound })
    manager.openProject('p1')
    expect(notifyBound).not.toHaveBeenCalled()
  })

  it('openOrFocus 聚焦已绑定窗口时不通知（未发生绑定）', () => {
    const notifyBound = vi.fn()
    const { manager } = makeManager({ notifyBound })
    manager.openProject('p1')
    notifyBound.mockClear()
    manager.openOrFocus('p1')
    expect(notifyBound).not.toHaveBeenCalled()
  })
})

describe('WindowManager git worktree 监听', () => {
  it('setGitWatchPath 在该路径起监听，变更时推 filetree:change', () => {
    watchCalls.length = 0
    const { manager } = makeManager()
    const win = manager.createEmptyWindow()
    manager.setGitWatchPath(win, '/repo-wt/feature')
    const call = watchCalls.find((c) => c.root === '/repo-wt/feature')
    expect(call).toBeDefined()
    const change: FileTreeChange = {
      type: 'add',
      path: '/repo-wt/feature/a.ts',
      parentDir: '/repo-wt/feature',
      memberId: '<git-view>'
    }
    call!.onChange(change)
    expect((win.webContents.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'filetree:change',
      change
    )
  })

  it('换 worktree 路径时关闭旧监听、起新监听', () => {
    watchCalls.length = 0
    const { manager } = makeManager()
    const win = manager.createEmptyWindow()
    manager.setGitWatchPath(win, '/wt/a')
    const first = watchCalls.find((c) => c.root === '/wt/a')!
    manager.setGitWatchPath(win, '/wt/b')
    expect(first.close).toHaveBeenCalled()
    expect(watchCalls.some((c) => c.root === '/wt/b')).toBe(true)
  })

  it('setGitWatchPath(null) 关闭监听', () => {
    watchCalls.length = 0
    const { manager } = makeManager()
    const win = manager.createEmptyWindow()
    manager.setGitWatchPath(win, '/wt/a')
    const first = watchCalls.find((c) => c.root === '/wt/a')!
    manager.setGitWatchPath(win, null)
    expect(first.close).toHaveBeenCalled()
  })
})
