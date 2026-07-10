import { describe, it, expect } from 'vitest'
import { createMemoryConversationStore } from './conversation-store'
import { getOrCreateCardConversation, cardSessionBridge } from './card-conversation'

describe('getOrCreateCardConversation —— 一卡一会话、id=cardId', () => {
  it('同卡多次打开续上同一会话（不可多开）', () => {
    const store = createMemoryConversationStore()
    const a = getOrCreateCardConversation(store, 'proj', 'login', 100)
    expect(a.id).toBe('login')
    store.appendMessage('proj', 'login', { role: 'user', text: '进度？', at: 101 })
    const b = getOrCreateCardConversation(store, 'proj', 'login', 200)
    expect(b.id).toBe('login') // 同一 id
    expect(b.messages).toHaveLength(1) // 续上历史，不新开
  })

  it('不同卡各自独立会话', () => {
    const store = createMemoryConversationStore()
    getOrCreateCardConversation(store, 'proj', 'login', 100)
    getOrCreateCardConversation(store, 'proj', 'signup', 100)
    expect(store.get('proj', 'login')?.id).toBe('login')
    expect(store.get('proj', 'signup')?.id).toBe('signup')
  })
})

describe('cardSessionBridge —— 多轮原生续接的 sessionId 桥接', () => {
  it('set/get 经会话库往返（供 --resume）', () => {
    const store = createMemoryConversationStore()
    getOrCreateCardConversation(store, 'proj', 'login', 100)
    const bridge = cardSessionBridge(store, 'proj')
    expect(bridge.get('login')).toBeUndefined()
    bridge.set('login', 'sess-abc')
    expect(bridge.get('login')).toBe('sess-abc')
  })

  it('会话不存在时 get 为 undefined、set 为 no-op', () => {
    const store = createMemoryConversationStore()
    const bridge = cardSessionBridge(store, 'proj')
    expect(bridge.get('ghost')).toBeUndefined()
    bridge.set('ghost', 'x') // 不抛
    expect(bridge.get('ghost')).toBeUndefined()
  })
})
