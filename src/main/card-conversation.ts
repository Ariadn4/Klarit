/**
 * 每卡会话（single-card-agent）：复用 `conversation-store`，但物理隔离——单独的存储桶（userData/card-conversations）
 * 由调用方注入的 store 承载。**一卡一会话、不可多开**＝会话 id 恒 = cardId：打开某卡永远 get-or-create 同一条会话。
 * 与全局对话（userData/conversations）各用各的桶，互不串扰。多轮经 sessionId 桥接原生续接。
 */

import type { ConversationStore } from './conversation-store'
import type { Conversation } from '../shared/types'
import type { CardSessionBridge } from './card-consult-producer'

/** 打开某卡的单需求 agent 会话：已存在续上，否则以 **id=cardId** 新建（保证一卡一个、不可多开）。 */
export function getOrCreateCardConversation(
  store: ConversationStore,
  projectId: string,
  cardId: string,
  now: number,
  title?: string
): Conversation {
  return store.get(projectId, cardId) ?? store.create(projectId, cardId, now, title)
}

/** 卡会话的 sessionId 桥接（供 producer 多轮原生续接）：conversationId 即 cardId。 */
export function cardSessionBridge(store: ConversationStore, projectId: string): CardSessionBridge {
  return {
    get: (cardId) => (cardId ? store.get(projectId, cardId)?.sessionId : undefined),
    set: (cardId, sessionId) => {
      if (cardId) store.setSessionId(projectId, cardId, sessionId)
    }
  }
}
