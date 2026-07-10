import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ConversationMessage } from '../shared/types'
import { createConversationStore, createMemoryConversationStore, type ConversationStore } from './conversation-store'

const NOW = 1_700_000_000_000

function userMsg(text: string, at: number): ConversationMessage {
  return { role: 'user', text, at }
}

function contract(name: string, make: () => ConversationStore): void {
  describe(name, () => {
    let store: ConversationStore
    beforeEach(() => {
      store = make()
    })

    it('create → 可 get、默认空历史', () => {
      const c = store.create('p1', 'conv-1', NOW, '聊 X')
      expect(c).toMatchObject({ id: 'conv-1', projectId: 'p1', title: '聊 X', messages: [] })
      expect(store.get('p1', 'conv-1')?.title).toBe('聊 X')
    })

    it('appendMessage 追加并刷新 updatedAt', () => {
      store.create('p1', 'c', NOW)
      store.appendMessage('p1', 'c', userMsg('嗨', NOW + 5))
      const got = store.get('p1', 'c')
      expect(got?.messages).toHaveLength(1)
      expect(got?.updatedAt).toBe(NOW + 5)
    })

    it('setSessionId 记录最近会话 id（供续接）', () => {
      store.create('p1', 'c', NOW)
      store.setSessionId('p1', 'c', 'sess-9')
      expect(store.get('p1', 'c')?.sessionId).toBe('sess-9')
    })

    it('setAgentModel 记录本会话选用 agent/模型，可清除回落', () => {
      store.create('p1', 'c', NOW)
      store.setAgentModel('p1', 'c', 'codex', 'gpt-x')
      expect(store.get('p1', 'c')).toMatchObject({ agentId: 'codex', model: 'gpt-x' })
      store.setAgentModel('p1', 'c', undefined, undefined)
      expect(store.get('p1', 'c')?.agentId).toBeUndefined()
      expect(store.get('p1', 'c')?.model).toBeUndefined()
    })

    it('多条会话独立、按项目隔离', () => {
      store.create('p1', 'a', NOW)
      store.create('p1', 'b', NOW + 1)
      store.create('p2', 'c', NOW)
      store.appendMessage('p1', 'a', userMsg('A', NOW + 10))
      expect(store.get('p1', 'b')?.messages).toEqual([])
      expect(store.list('p1').map((c) => c.id).sort()).toEqual(['a', 'b'])
      expect(store.list('p2').map((c) => c.id)).toEqual(['c'])
    })

    it('list 按 updatedAt 倒序（最近在前）', () => {
      store.create('p1', 'old', NOW)
      store.create('p1', 'new', NOW)
      store.appendMessage('p1', 'new', userMsg('x', NOW + 100))
      expect(store.list('p1')[0].id).toBe('new')
    })

    it('未绑定作用域(__unbound__)与项目作用域独立、不串', () => {
      store.create('__unbound__', 'u1', NOW)
      store.create('proj-a', 'a1', NOW)
      expect(store.list('__unbound__').map((c) => c.id)).toEqual(['u1'])
      expect(store.list('proj-a').map((c) => c.id)).toEqual(['a1'])
      expect(store.get('proj-a', 'u1')).toBeNull()
    })

    it('truncateMessages 只保留前 N 条', () => {
      store.create('p1', 'c', NOW)
      store.appendMessage('p1', 'c', { role: 'user', text: 'u1', at: NOW + 1 })
      store.appendMessage('p1', 'c', { role: 'agent', text: 'a1', at: NOW + 2 })
      store.appendMessage('p1', 'c', { role: 'user', text: 'u2', at: NOW + 3 })
      const trimmed = store.truncateMessages('p1', 'c', 2)
      expect(trimmed?.messages.map((m) => m.text)).toEqual(['u1', 'a1'])
      expect(store.get('p1', 'c')?.messages).toHaveLength(2)
    })

    it('remove 删会话', () => {
      store.create('p1', 'c', NOW)
      store.remove('p1', 'c')
      expect(store.get('p1', 'c')).toBeNull()
    })

    it('appendMessage 到不存在会话 → null', () => {
      expect(store.appendMessage('p1', 'ghost', userMsg('x', NOW))).toBeNull()
    })
  })
}

contract('createMemoryConversationStore', () => createMemoryConversationStore())

describe('createConversationStore（文件持久化）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'klarit-conv-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('落盘后另起实例可读回（重开续接）', () => {
    const s1 = createConversationStore(dir)
    s1.create('p1', 'c', NOW, '标题')
    s1.appendMessage('p1', 'c', userMsg('第一轮', NOW + 1))
    s1.setSessionId('p1', 'c', 'sess-1')
    const s2 = createConversationStore(dir)
    const got = s2.get('p1', 'c')
    expect(got?.messages).toHaveLength(1)
    expect(got?.sessionId).toBe('sess-1')
  })

  contract('file-backed 契约', () => createConversationStore(mkdtempSync(join(tmpdir(), 'klarit-conv-c-'))))
})
