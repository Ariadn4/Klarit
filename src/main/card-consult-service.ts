/**
 * 单需求 agent 咨询核：把「本卡意图 → 三岔（查进度回复 / 本卡干预提议 / 上抛塑造需求）」收敛到一条可注入、
 * 可测的链路。装配本卡只读读上下文 → 拼咨询 prompt → 注入的 producer 产三岔（真=脱 worktree 只读续接 runner，
 * 测试=假单卡 agent）→ 若 upshift 则转调 orchestrate 出 ops 提案。只读、只提议、scope 单卡；单卡**自身不产卡操作**。
 */

import type {
  CardAgentTurn,
  CardIntervention,
  ConversationMessage,
  OrchestrationOutcome,
  OrchestrationProposal
} from '../shared/types'
import { buildCardConsultPrompt } from '../shared/card-agent'

/** 咨询核依赖（注入以便测试，不绑 Electron）。 */
export interface CardConsultDeps {
  /** 装配某卡的只读读上下文（活现状 + 断点 + 溯源 + 分支 diff，已预算截断）。 */
  buildContext: (cardId: string) => string
  /** 上抛塑造需求：转调全局编排核（限本项目/可提议新建项目）。 */
  orchestrate: (intent: string) => Promise<OrchestrationOutcome>
  /** 某会话历史（供多轮续接的 producer 用）；缺省空。 */
  getHistory?: (conversationId?: string) => ConversationMessage[]
}

/** producer：拿装配好的咨询 prompt 与上下文产三岔输出。真实现驱动只读续接 runner；测试注入假单卡 agent。 */
export type CardConsultProducer = (
  prompt: string,
  ctx: { cardId: string; intent: string; conversationId?: string; history: ConversationMessage[] }
) => Promise<CardAgentTurn>

export interface CardConsultInput {
  cardId: string
  intent: string
  conversationId?: string
  /** 门自由输入分类前置用：反偏置——歧义留本地（当驳回），仅明确塑造需求才 upshift。见 content-driven-rollback。 */
  biasLocal?: boolean
}

/** 咨询核产物：自然语言回复 + （本卡干预提议 或 上抛得到的 ops 提案）。干预与提案互斥（塑造需求一律上抛）。 */
export interface CardConsultOutcome {
  reply: string
  /** 本卡干预提议（破坏性由 `isDestructiveIntervention` 派生，确认在渲染层）。 */
  interventions?: CardIntervention[]
  /** 上抛塑造需求经 orchestrate 得到的 ops 提案（供卡对话内审阅 applyOps）。 */
  proposal?: OrchestrationProposal
}

export interface CardConsultSeam {
  consult: (input: CardConsultInput) => Promise<CardConsultOutcome>
}

export function createCardConsultSeam(deps: CardConsultDeps, produce: CardConsultProducer): CardConsultSeam {
  return {
    async consult({ cardId, intent, conversationId, biasLocal }) {
      const context = deps.buildContext(cardId)
      const prompt = buildCardConsultPrompt(context, intent, { biasLocal })
      let turn: CardAgentTurn
      try {
        turn = await produce(prompt, {
          cardId,
          intent,
          conversationId,
          history: deps.getHistory?.(conversationId) ?? []
        })
      } catch {
        return { reply: '（未能作答：agent 调用失败或未配置默认 agent）' }
      }
      const reply = turn?.reply ?? ''
      // 塑造需求 → 上抛全局编排（单卡不裁决、不自产卡操作）。upshift 与 interventions 互斥。
      if (turn?.upshift?.intent) {
        const outcome = await deps.orchestrate(turn.upshift.intent)
        const proposal = outcome && !('unbound' in outcome) ? outcome : undefined
        return proposal ? { reply, proposal } : { reply }
      }
      const interventions = turn?.interventions ?? []
      return interventions.length ? { reply, interventions } : { reply }
    }
  }
}
