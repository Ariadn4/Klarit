/**
 * 全局对话持久化（global-agent-chat）：会话存 userData、按项目隔离、可多开（各持独立 conversationId
 * 与历史）、多轮经最近 sessionId 续接。一会话一文件（`<baseDir>/<projectId>/<id>.json`，不入 git，
 * 随云同步走）。双后端（内存/文件）注入式，同 card-store 模式，便于测试。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Conversation, ConversationMessage } from '../shared/types'

export interface ConversationStore {
  /** 列某项目全部会话（按 updatedAt 倒序，最近的在前）。 */
  list(projectId: string): Conversation[]
  get(projectId: string, id: string): Conversation | null
  /** 新建一条空会话（稳定 id 由调用方注入，便于测试确定性）。 */
  create(projectId: string, id: string, now: number, title?: string): Conversation
  /** 追加一条消息并刷新 updatedAt；会话不存在返回 null。 */
  appendMessage(projectId: string, id: string, message: ConversationMessage): Conversation | null
  /** 记录最近一次 agent 会话 id（供原生续接）；会话不存在为 no-op。 */
  setSessionId(projectId: string, id: string, sessionId: string): void
  /** 设本会话选用的 agent/模型（覆盖全局默认）；传 undefined 清除该项、回落默认。会话不存在为 no-op。 */
  setAgentModel(projectId: string, id: string, agentId?: string, model?: string): void
  /** 只保留前 keepCount 条消息（供编辑/重试截断末轮）；返回更新后会话，会话不存在返回 null。 */
  truncateMessages(projectId: string, id: string, keepCount: number): Conversation | null
  /** 标记某消息（按 at 定位）的第 index 个干预已执行（持久化，供重开后显「已执行」）。会话/消息不存在为 no-op。 */
  markInterventionApplied(projectId: string, id: string, messageAt: number, index: number): void
  remove(projectId: string, id: string): void
}

interface Backend {
  read(projectId: string, id: string): Conversation | null
  write(c: Conversation): void
  listProject(projectId: string): Conversation[]
  del(projectId: string, id: string): void
}

const DEFAULT_TITLE = '新对话'

function makeStore(b: Backend): ConversationStore {
  function create(projectId: string, id: string, now: number, title?: string): Conversation {
    const conv: Conversation = {
      id,
      projectId,
      title: title?.trim() ? title.trim() : DEFAULT_TITLE,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    b.write(conv)
    return conv
  }

  function appendMessage(projectId: string, id: string, message: ConversationMessage): Conversation | null {
    const cur = b.read(projectId, id)
    if (!cur) return null
    const next: Conversation = { ...cur, messages: [...cur.messages, message], updatedAt: message.at }
    b.write(next)
    return next
  }

  function setSessionId(projectId: string, id: string, sessionId: string): void {
    const cur = b.read(projectId, id)
    if (!cur) return
    b.write({ ...cur, sessionId })
  }

  function setAgentModel(projectId: string, id: string, agentId?: string, model?: string): void {
    const cur = b.read(projectId, id)
    if (!cur) return
    b.write({ ...cur, agentId, model })
  }

  function truncateMessages(projectId: string, id: string, keepCount: number): Conversation | null {
    const cur = b.read(projectId, id)
    if (!cur) return null
    const next: Conversation = { ...cur, messages: cur.messages.slice(0, Math.max(0, keepCount)) }
    b.write(next)
    return next
  }

  function markInterventionApplied(projectId: string, id: string, messageAt: number, index: number): void {
    const cur = b.read(projectId, id)
    if (!cur) return
    const messages = cur.messages.map((m) => {
      if (m.at !== messageAt) return m
      const applied = new Set(m.appliedInterventions ?? [])
      applied.add(index)
      return { ...m, appliedInterventions: [...applied].sort((a, c) => a - c) }
    })
    b.write({ ...cur, messages })
  }

  return {
    list: (projectId) => b.listProject(projectId).sort((a, c) => c.updatedAt - a.updatedAt),
    get: (projectId, id) => b.read(projectId, id),
    create,
    appendMessage,
    setSessionId,
    setAgentModel,
    truncateMessages,
    markInterventionApplied,
    remove: (projectId, id) => b.del(projectId, id)
  }
}

/** 文件后端（userData/conversations/<projectId>/<id>.json）。 */
function fileBackend(baseDir: string): Backend {
  const file = (p: string, id: string): string => join(baseDir, p, `${id}.json`)
  return {
    read(p, id) {
      try {
        const f = file(p, id)
        return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Conversation) : null
      } catch {
        return null
      }
    },
    write(c) {
      mkdirSync(join(baseDir, c.projectId), { recursive: true })
      writeFileSync(file(c.projectId, c.id), JSON.stringify(c, null, 2), 'utf8')
    },
    listProject(p) {
      const dir = join(baseDir, p)
      if (!existsSync(dir)) return []
      const out: Conversation[] = []
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue
        try {
          out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as Conversation)
        } catch {
          /* 跳过损坏单会话文件 */
        }
      }
      return out
    },
    del(p, id) {
      rmSync(file(p, id), { force: true })
    }
  }
}

/** 内存后端（测试/无盘），深拷贝隔离。 */
function memoryBackend(): Backend {
  const map = new Map<string, Conversation>()
  const key = (p: string, id: string): string => `${p}/${id}`
  const clone = (c: Conversation): Conversation => JSON.parse(JSON.stringify(c)) as Conversation
  return {
    read: (p, id) => {
      const c = map.get(key(p, id))
      return c ? clone(c) : null
    },
    write: (c) => {
      map.set(key(c.projectId, c.id), clone(c))
    },
    listProject: (p) => [...map.values()].filter((c) => c.projectId === p).map(clone),
    del: (p, id) => {
      map.delete(key(p, id))
    }
  }
}

export function createConversationStore(baseDir: string): ConversationStore {
  return makeStore(fileBackend(baseDir))
}

export function createMemoryConversationStore(): ConversationStore {
  return makeStore(memoryBackend())
}
