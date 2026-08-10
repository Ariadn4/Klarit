import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '../shared/ipc'
import type { KlaritApi } from '../shared/types'

// 捕获 contextBridge 暴露的 api 与 ipcRenderer.invoke 调用，验证 preload→IPC 通道契约。
const { invoke, on, removeListener, exposeInMainWorld } = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
  exposeInMainWorld: vi.fn()
}))

vi.mock('electron', () => ({
  ipcRenderer: { invoke, on, removeListener },
  contextBridge: { exposeInMainWorld }
}))

async function loadApi(): Promise<KlaritApi> {
  await import('./index')
  return exposeInMainWorld.mock.calls[0][1] as KlaritApi
}

beforeEach(() => {
  invoke.mockClear()
  on.mockClear()
  removeListener.mockClear()
})

describe('preload git 只读查询契约', () => {
  it('listBranches 转发到 git:branches 通道并带 rootPath', async () => {
    const api = await loadApi()
    await api.listBranches('/repo')
    expect(invoke).toHaveBeenCalledWith(IPC.gitBranches, '/repo')
  })

  it('listWorktrees 转发到 git:worktrees 通道并带 rootPath', async () => {
    const api = await loadApi()
    await api.listWorktrees('/repo')
    expect(invoke).toHaveBeenCalledWith(IPC.gitWorktrees, '/repo')
  })
})

describe('preload 决策收件箱契约', () => {
  it('listDecisionInbox 转发到 decisionInbox:list 通道', async () => {
    const api = await loadApi()
    await api.listDecisionInbox()
    expect(invoke).toHaveBeenCalledWith(IPC.decisionInboxList)
  })

  it('getNotifyOnDecision / setNotifyOnDecision 转发到各自设置通道', async () => {
    const api = await loadApi()
    await api.getNotifyOnDecision()
    expect(invoke).toHaveBeenCalledWith(IPC.getNotifyOnDecision)
    await api.setNotifyOnDecision(false)
    expect(invoke).toHaveBeenCalledWith(IPC.setNotifyOnDecision, false)
  })

  it('focusWindow 转发到 window:focus 通道（点通知回到应用）', async () => {
    const api = await loadApi()
    await api.focusWindow()
    expect(invoke).toHaveBeenCalledWith(IPC.windowFocus)
  })

  it('onDecisionInboxChange 订阅 decisionInbox:changed，取消订阅时摘掉监听', async () => {
    const api = await loadApi()
    const handler = vi.fn()
    const off = api.onDecisionInboxChange(handler)
    const [channel, listener] = on.mock.calls.find((c) => c[0] === IPC.decisionInboxChanged)!
    expect(channel).toBe(IPC.decisionInboxChanged)
    listener(null, [{ runId: 'r1' }])
    expect(handler).toHaveBeenCalledWith([{ runId: 'r1' }])
    off()
    expect(removeListener).toHaveBeenCalledWith(IPC.decisionInboxChanged, listener)
  })

  it('onDecisionNotify 订阅 decisionInbox:notify', async () => {
    const api = await loadApi()
    const handler = vi.fn()
    api.onDecisionNotify(handler)
    const [, listener] = on.mock.calls.find((c) => c[0] === IPC.decisionInboxNotify)!
    listener(null, { runId: 'r1' })
    expect(handler).toHaveBeenCalledWith({ runId: 'r1' })
  })
})

describe('preload 定时巡检契约', () => {
