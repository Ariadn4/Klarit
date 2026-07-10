/**
 * agent↔引擎握手文件读取：agent 在主目标仓 worktree 写 `.klarit/handshake.json`，引擎在其退出时读。
 * 握手是**结构化控制状态的唯一真相源**（stdout 只作展示）。**缺失/读失败/解析失败/未知 status → 乐观 `done`**
 * ——容忍第三方 CLI 不完美遵守协议，真正的未完成由客观门与越界检测兜底触发自愈。
 */

import { readFileSync } from 'node:fs'
import type { AgentHandshake, AgentHandshakeOption } from '../../shared/types'

const DONE: AgentHandshake = { status: 'done' }

function coerceOption(raw: unknown): AgentHandshakeOption | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  const label = typeof o.label === 'string' ? o.label : ''
  if (id === '' || label === '') return null
  const opt: AgentHandshakeOption = { id, label }
  if (typeof o.detail === 'string') opt.detail = o.detail
  if (o.recommended === true) opt.recommended = true
  return opt
}

function coerceDecision(raw: unknown): AgentHandshake['decision'] {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const options = Array.isArray(o.options)
    ? o.options.map(coerceOption).filter((x): x is AgentHandshakeOption => x !== null)
    : undefined
  const d: NonNullable<AgentHandshake['decision']> = {}
  if (typeof o.title === 'string') d.title = o.title
  if (options && options.length) d.options = options
  if (o.multi === true) d.multi = true
  if (o.freeInput === true) d.freeInput = true
  return d
}

/** 纯解析：把握手文件原文（或 null）收敛为 `AgentHandshake`；任何异常/未知 status 归乐观 `done`。 */
export function parseHandshake(raw: string | null): AgentHandshake {
  if (!raw || !raw.trim()) return DONE
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return DONE
  }
  if (!obj || typeof obj !== 'object') return DONE
  const o = obj as Record<string, unknown>
  const status = o.status === 'need-decision' || o.status === 'failed' ? o.status : 'done'
  const h: AgentHandshake = { status }
  if (Array.isArray(o.repos)) h.repos = o.repos.filter((r): r is string => typeof r === 'string')
  if (typeof o.note === 'string') h.note = o.note
  if (typeof o.detail === 'string') h.detail = o.detail
  if (status === 'need-decision') {
    const d = coerceDecision(o.decision)
    if (d) h.decision = d
  }
  return h
}

/** 读引擎指定绝对路径的握手文件并解析（在 C 盘 userData 下、worktree 之外）；不存在/读失败 → 乐观 `done`。 */
export function readHandshake(handshakePath: string): AgentHandshake {
  let raw: string | null = null
  try {
    raw = readFileSync(handshakePath, 'utf8')
  } catch {
    raw = null
  }
  return parseHandshake(raw)
}
