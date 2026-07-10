import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import type { FSWatcher } from 'chokidar'
import type {
  Project,
  RegistryData,
  SessionState,
  SidebarViewState,
  WindowState
} from '../shared/types'
import { DEFAULT_SIDEBAR_WIDTH } from '../shared/sidebar'
import { projectRootPath } from '../shared/project'
import { findProjectById, reconcileMissing } from './registry-core'
import { rebindMemberIfGitAppeared, type ProjectServiceDeps } from './project-service'
import { watchProject } from './filetree'

/** 未绑定项目的空状态窗口用此 projectId 占位。 */
const UNBOUND = ''

/** 新窗口/老会话缺省时的侧边栏视图选择。 */
const DEFAULT_SIDEBAR_VIEW: SidebarViewState = {
  view: 'files',
  gitMemberId: null,
  gitBranch: null
}

/** git 视图 worktree 监听的占位 memberId（区别于真实成员仓 id）。 */
const GIT_VIEW_WATCH_ID = '<git-view>'

interface WinCtx {
  window: BrowserWindow
  projectId: string
  sidebarCollapsed: boolean
  sidebarWidth: number
  sidebarView: SidebarViewState
  watchers: FSWatcher[]
  /** git 视图当前预览 worktree 的监听（独立于成员仓监听，随预览路径切换）。 */
  gitWatcher: FSWatcher | null
}

export interface WindowManagerOptions {
  registry: RegistryData
  saveRegistry: () => void
  /** 新建一个 BrowserWindow（含 preload、尺寸、并加载渲染层）。 */
  newWindow: (state: WindowState | null) => BrowserWindow
  serviceDeps: ProjectServiceDeps
}

/** 每窗口绑定一个项目，管理多窗口、（多成员仓）文件监听、磁盘对账与会话快照。 */
export class WindowManager {
  private ctxs = new Map<number, WinCtx>()

  constructor(private opts: WindowManagerOptions) {}

  /** 当前窗口绑定的项目（空状态返回 null）；返回前先对账成员缺失状态。 */
  current(win: BrowserWindow): Project | null {
    const ctx = this.ctxs.get(win.id)
    if (!ctx || ctx.projectId === UNBOUND) return null
    reconcileMissing(this.opts.registry, (p) => existsSync(p))
    return findProjectById(this.opts.registry, ctx.projectId) ?? null
  }

  getSidebarCollapsed(win: BrowserWindow): boolean {
    return this.ctxs.get(win.id)?.sidebarCollapsed ?? false
  }

  setSidebarCollapsed(win: BrowserWindow, collapsed: boolean): void {
    const ctx = this.ctxs.get(win.id)
    if (ctx) ctx.sidebarCollapsed = collapsed
  }

  getSidebarWidth(win: BrowserWindow): number {
    return this.ctxs.get(win.id)?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH
  }

  setSidebarWidth(win: BrowserWindow, width: number): void {
    const ctx = this.ctxs.get(win.id)
    if (ctx) ctx.sidebarWidth = width
  }

  getSidebarView(win: BrowserWindow): SidebarViewState {
    return this.ctxs.get(win.id)?.sidebarView ?? { ...DEFAULT_SIDEBAR_VIEW }
  }

  setSidebarView(win: BrowserWindow, view: SidebarViewState): void {
    const ctx = this.ctxs.get(win.id)
    if (ctx) ctx.sidebarView = view
  }

  /**
   * 设置 git 视图当前预览的 worktree 路径并监听它（只读预览随磁盘变更刷新）。
   * 传 null 或换路径时关闭旧监听。变更以 filetree:change 推给渲染层（复用同一刷新通道）。
   */
  setGitWatchPath(win: BrowserWindow, path: string | null): void {
    const ctx = this.ctxs.get(win.id)
    if (!ctx) return
    if (ctx.gitWatcher) {
      void ctx.gitWatcher.close()
      ctx.gitWatcher = null
    }
    if (path && existsSync(path)) {
      ctx.gitWatcher = watchProject(path, GIT_VIEW_WATCH_ID, (change) => {
        if (!ctx.window.isDestroyed()) ctx.window.webContents.send('filetree:change', change)
      })
    }
  }

  createEmptyWindow(): BrowserWindow {
    const win = this.opts.newWindow(null)
    this.register(win, {
      projectId: UNBOUND,
      sidebarCollapsed: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarView: { ...DEFAULT_SIDEBAR_VIEW }
    })
    return win
  }

  /** 打开项目：已有窗口绑定它则聚焦；否则开新窗口。 */
  openProject(projectId: string, state?: Partial<WindowState>): BrowserWindow {
    for (const ctx of this.ctxs.values()) {
      if (ctx.projectId === projectId && !ctx.window.isDestroyed()) {
        ctx.window.focus()
        return ctx.window
      }
    }
    this.maybeRebind(projectId)
    const sidebarWidth = state?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH
    const sidebarView: SidebarViewState = {
      view: state?.sidebarView ?? DEFAULT_SIDEBAR_VIEW.view,
      gitMemberId: state?.gitMemberId ?? null,
      gitBranch: state?.gitBranch ?? null
    }
    const win = this.opts.newWindow({
      projectId,
      sidebarCollapsed: state?.sidebarCollapsed ?? false,
      sidebarWidth,
      sidebarView: sidebarView.view,
      gitMemberId: sidebarView.gitMemberId,
      gitBranch: sidebarView.gitBranch,
      bounds: state?.bounds
    })
    this.register(win, {
      projectId,
      sidebarCollapsed: state?.sidebarCollapsed ?? false,
      sidebarWidth,
      sidebarView
    })
    return win
  }

  /**
   * 统一打开落点（切换器与管理项目窗口共用）：
   * ① 已有窗口绑定该项目 → 聚焦置前；② 否则有空状态窗口 → 就地绑定并聚焦；③ 否则开新窗口。
   */
  openOrFocus(projectId: string): BrowserWindow {
    for (const ctx of this.ctxs.values()) {
      if (ctx.projectId === projectId && !ctx.window.isDestroyed()) {
        ctx.window.focus()
        return ctx.window
      }
    }
    for (const ctx of this.ctxs.values()) {
      if (ctx.projectId === UNBOUND && !ctx.window.isDestroyed()) {
        this.bindWindow(ctx.window, projectId)
        ctx.window.focus()
        return ctx.window
      }
    }
    return this.openProject(projectId)
  }

  /** 把一个空状态窗口绑定到刚导入的项目（导入流程复用当前窗口）。 */
  bindWindow(win: BrowserWindow, projectId: string): void {
    const ctx = this.ctxs.get(win.id)
    if (!ctx) return
    this.stopWatch(ctx)
    this.maybeRebind(projectId)
    ctx.projectId = projectId
    this.startWatch(ctx)
  }

  /** 项目成员变化后（关联/解绑/重定位）重启监听并刷新渲染层。 */
  refreshWindowsFor(projectId: string): void {
    for (const ctx of this.ctxs.values()) {
      if (ctx.projectId !== projectId || ctx.window.isDestroyed()) continue
      this.stopWatch(ctx)
      this.startWatch(ctx)
    }
  }

  snapshotSession(): SessionState {
    const windows: WindowState[] = []
    for (const ctx of this.ctxs.values()) {
      if (ctx.window.isDestroyed() || ctx.projectId === UNBOUND) continue
      windows.push({
        projectId: ctx.projectId,
        sidebarCollapsed: ctx.sidebarCollapsed,
        sidebarWidth: ctx.sidebarWidth,
        sidebarView: ctx.sidebarView.view,
        gitMemberId: ctx.sidebarView.gitMemberId,
        gitBranch: ctx.sidebarView.gitBranch,
        bounds: ctx.window.getBounds()
      })
    }
    return { windows }
  }

  /** 对项目的所有 gitless 成员尝试补绑（git 出现后立即绑定）。 */
  private maybeRebind(projectId: string): void {
    const project = findProjectById(this.opts.registry, projectId)
    if (!project) return
    let changed = false
    for (const member of [...project.members]) {
      if (rebindMemberIfGitAppeared(this.opts.registry, member, this.opts.serviceDeps)) changed = true
    }
    if (changed) this.opts.saveRegistry()
  }

  private register(
    win: BrowserWindow,
    state: {
      projectId: string
      sidebarCollapsed: boolean
      sidebarWidth: number
      sidebarView: SidebarViewState
    }
  ): void {
    const ctx: WinCtx = {
      window: win,
      projectId: state.projectId,
      sidebarCollapsed: state.sidebarCollapsed,
      sidebarWidth: state.sidebarWidth,
      sidebarView: state.sidebarView,
      watchers: [],
      gitWatcher: null
    }
    this.ctxs.set(win.id, ctx)
    if (ctx.projectId !== UNBOUND) this.startWatch(ctx)
    win.on('closed', () => {
      this.stopWatch(ctx)
      if (ctx.gitWatcher) {
        void ctx.gitWatcher.close()
        ctx.gitWatcher = null
      }
      this.ctxs.delete(win.id)
    })
  }

  /** 监听项目目录（派生自成员路径）：文件树视图以它为根，单一监听覆盖其下全部内容。 */
  private startWatch(ctx: WinCtx): void {
    const project = findProjectById(this.opts.registry, ctx.projectId)
    if (!project) return
    const root = projectRootPath(project)
    if (!root || !existsSync(root)) return
    const watcher = watchProject(root, project.id, (change) => {
      if (!ctx.window.isDestroyed()) ctx.window.webContents.send('filetree:change', change)
    })
    ctx.watchers.push(watcher)
  }

  private stopWatch(ctx: WinCtx): void {
    for (const w of ctx.watchers) void w.close()
    ctx.watchers = []
  }
}
