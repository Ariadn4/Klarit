import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Conversation } from '@shared/types'
import { useGlobalChatStore } from './globalChat'

function conv(id: string): Conversation {
  return { id, projectId: 'p1', title: id, messages: [], createdAt: 1, updatedAt: 1 }
}

function stubApi(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listConversations: vi.fn(async () => [conv('c1'), conv('c2')]),
    getConversation: vi.fn(async (id: string) => conv(id)),
    getDefaultAgent: vi.fn(async () => null),
    getDefaultModel: vi.fn(async () => null),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api as Record<string, ReturnType<typeof vi.fn>>
}

beforeEach(() => {
  useGlobalChatStore.setState({
    open: false,
    conversations: [],
    activeId: null,
    active: null,
    notice: null
  })
})

describe('globalChat store openConversation（主进程推送驱动打开并选中承载提案的会话）', () => {
  it('打开面板、加载会话列表、选中并拉取指定会话', async () => {
    const api = stubApi()
    await useGlobalChatStore.getState().openConversation('c2')

    const st = useGlobalChatStore.getState()
    // 面板被打开。
    expect(st.open).toBe(true)
    // 会话列表被重取（主进程后台追加了消息，渲染层无自动刷新）。
    expect(api.listConversations).toHaveBeenCalled()
    expect(st.conversations.map((c) => c.id)).toEqual(['c1', 'c2'])
    // 选中并拉取指定会话（而非最近一条）。
    expect(api.getConversation).toHaveBeenCalledWith('c2')
    expect(st.activeId).toBe('c2')
    expect(st.active?.id).toBe('c2')
  })
})
