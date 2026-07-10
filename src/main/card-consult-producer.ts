/**
 * 真实 CardConsultProducer：以**只读姿态、脱 worktree** 驱动用户配置的默认 agent（复用 `agent/runner.ts` 流式
 * 续接那套——流式展示 + session 捕获 + `--resume` 续接），把回复解析为三岔输出（parseCardTurn）。
 * 单需求 agent 只咨询/提议、不写代码——即便它写了文件我们也**不消费**，只取其结构化三岔输出。
 * runner 注入式：测试用桩 runner（回吐 stdout + 退出码），不触真 CLI。
 */

import { parseCardTurn } from '../shared/card-agent'
import type { CardConsultProducer } from './card-consult-service'
import type { AgentRunner, AgentRunSpec } from './agent/runner'
import { launchContinuation } from './agent/continuation'

/** 会话 sessionId 存取（供多轮原生续接）；缺省即每轮全新起。 */
export interface CardSessionBridge {
  get: (conversationId?: string) => string | undefined
  set: (conversationId: string | undefined, sessionId: string) => void
}

export interface CardConsultProducerConfig {
  runner: AgentRunner
  /** 默认 agent 外壳 id；未配置为 null → 抛错让咨询核降级空态。 */
  toolId: string | null
  /** 只读工作目录（scratch）；不开 worktree。 */
  cwd: string
  model?: string
  timeoutMs?: number
  sessions?: CardSessionBridge
}

/** 构造真实 producer：一次咨询 = 一轮 agent 调用（有会话 sessionId 走原生续接，否则全新起）。 */
export function createCardConsultProducer(cfg: CardConsultProducerConfig): CardConsultProducer {
  return async (prompt, ctx) => {
    if (!cfg.toolId) throw new Error('未配置默认 agent')
    let out = ''
    const spec: AgentRunSpec = {
      toolId: cfg.toolId,
      cwd: cfg.cwd,
      model: cfg.model,
      onChunk: (stream, chunk) => {
        if (stream === 'stdout') out += chunk
      },
      sessionId: cfg.sessions?.get(ctx.conversationId),
      onSession: (id) => cfg.sessions?.set(ctx.conversationId, id)
    }
    // 续接阶梯：有 session 且支持 → resume（inject=本轮 prompt）；否则全新 start（prompt）。
    const launch = launchContinuation(cfg.runner, spec, { inject: prompt, rebuildPrompt: prompt })
    if (!launch) throw new Error(`无法拉起 agent「${cfg.toolId}」`)

    const timeoutMs = cfg.timeoutMs ?? 180_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        launch.kill()
        reject(new Error('agent 咨询调用超时'))
      }, timeoutMs)
    })
    try {
      await Promise.race([launch.done, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
    return parseCardTurn(out)
  }
}
