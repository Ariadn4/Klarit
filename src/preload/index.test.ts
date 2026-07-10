import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '../shared/ipc'
import type { KlaritApi } from '../shared/types'

// 捕获 contextBridge 暴露的 api 与 ipcRenderer.invoke 调用，验证 preload→IPC 通道契约。
const { invoke, exposeInMainWorld } = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  exposeInMainWorld: vi.fn()
}))

vi.mock('electron', () => ({
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() },
  contextBridge: { exposeInMainWorld }
}))

async function loadApi(): Promise<KlaritApi> {
  await import('./index')
  return exposeInMainWorld.mock.calls[0][1] as KlaritApi
}

beforeEach(() => {
  invoke.mockClear()
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
