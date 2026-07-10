import { describe, it, expect, vi } from 'vitest'
import { createCardConsultSeam, type CardConsultDeps } from './card-consult-service'
import type { CardAgentTurn, OrchestrationOutcome } from '../shared/types'

function seamWith(turn: CardAgentTurn | (() => Promise<CardAgentTurn>), deps: Partial<CardConsultDeps> = {}) {
  const produce = typeof turn === 'function' ? turn : async () => turn
  const base: CardConsultDeps = {
    buildContext: () => '（本卡读上下文）',
    orchestrate: async (): Promise<OrchestrationOutcome> => ({ ops: [], issues: [] }),
    getHistory: () => [],
    ...deps
  }
  return createCardConsultSeam(base, async (_p, _c) => produce())
}

describe('createCardConsultSeam —— 三岔收敛', () => {
  it('纯咨询轮：只回复', async () => {
    const seam = seamWith({ reply: '当前跑到写测试这步' })
    const out = await seam.consult({ cardId: 'login', intent: '跑到哪了' })
    expect(out.reply).toBe('当前跑到写测试这步')
    expect(out.interventions).toBeUndefined()
    expect(out.proposal).toBeUndefined()
  })

  it('本卡干预轮：带 interventions', async () => {
    const seam = seamWith({ reply: '好的，暂停', interventions: [{ kind: 'pause' }] })
    const out = await seam.consult({ cardId: 'login', intent: '先暂停' })
    expect(out.interventions).toEqual([{ kind: 'pause' }])
    expect(out.proposal).toBeUndefined()
  })

  it('喂给 producer 的 prompt 含本卡读上下文', async () => {
    const buildContext = vi.fn(() => '（登录卡上下文）')
    let seenPrompt = ''
    const seam = createCardConsultSeam(
      { buildContext, orchestrate: async () => ({ ops: [], issues: [] }), getHistory: () => [] },
      async (p) => {
        seenPrompt = p
        return { reply: 'ok' }
      }
    )
    await seam.consult({ cardId: 'login', intent: '进度？' })
    expect(buildContext).toHaveBeenCalledWith('login')
    expect(seenPrompt).toContain('（登录卡上下文）')
    expect(seenPrompt).toContain('进度？')
  })
})

describe('上抛塑造需求 → orchestrate', () => {
  it('upshift → 调 orchestrate(intent)，回带 ops 提案；单卡自身不产卡操作', async () => {
    const orchestrate = vi.fn(async (): Promise<OrchestrationOutcome> => ({
      ops: [{ kind: 'create', card: { proposedName: 'export', title: '导出', description: '', typeId: 'feature', relations: [] } }],
      issues: [],
      reply: '给你拟了一张导出卡'
    }))
    const seam = seamWith({ reply: '这像是新需求', upshift: { intent: '加个导出功能' } }, { orchestrate })
    const out = await seam.consult({ cardId: 'login', intent: '还要能导出' })
    expect(orchestrate).toHaveBeenCalledWith('加个导出功能')
    expect(out.proposal?.ops).toHaveLength(1)
    expect(out.interventions).toBeUndefined() // 单卡不自产卡操作/干预
    expect(out.reply).toBe('这像是新需求')
  })

  it('orchestrate 返未绑定空态 → 无提案、仍回复', async () => {
    const seam = seamWith({ reply: '试试新建', upshift: { intent: 'X' } }, { orchestrate: async () => ({ unbound: true }) })
    const out = await seam.consult({ cardId: 'login', intent: 'X' })
    expect(out.proposal).toBeUndefined()
    expect(out.reply).toBe('试试新建')
  })
})

describe('门自由输入分类前置（反偏置）', () => {
  it('biasLocal → prompt 含门语境反偏置说明', async () => {
    let seenPrompt = ''
    const seam = createCardConsultSeam(
      { buildContext: () => 'ctx', orchestrate: async () => ({ ops: [], issues: [] }), getHistory: () => [] },
      async (p) => {
        seenPrompt = p
        return { reply: 'ok' }
      }
    )
    await seam.consult({ cardId: 'login', intent: '这段不满意', biasLocal: true })
    expect(seenPrompt).toMatch(/评审本卡|不要.*upshift|塑造需求/)
  })

  it('门语境明确塑造需求 → 仍上抛出提案（分类=shaped）', async () => {
    const orchestrate = vi.fn(async (): Promise<OrchestrationOutcome> => ({
      ops: [{ kind: 'create', card: { proposedName: 'x', title: 'X', description: '', typeId: 'feature', relations: [] } }],
      issues: []
    }))
    const seam = seamWith({ reply: '这是新需求', upshift: { intent: '加个新需求 X' } }, { orchestrate })
    const out = await seam.consult({ cardId: 'login', intent: '顺便加个需求 X', biasLocal: true })
    expect(out.proposal?.ops).toHaveLength(1) // 明确塑造需求仍引流
  })

  it('门语境驳回意见 → 只回复（分类=非 shaped，交由既有回退路径）', async () => {
    const orchestrate = vi.fn(async (): Promise<OrchestrationOutcome> => ({ ops: [], issues: [] }))
    const seam = seamWith({ reply: '收到，这段确实要改' }, { orchestrate })
    const out = await seam.consult({ cardId: 'login', intent: 'UI 太丑重做', biasLocal: true })
    expect(out.proposal).toBeUndefined()
    expect(orchestrate).not.toHaveBeenCalled() // 未上抛，交既有回退判定
  })
})

describe('优雅降级', () => {
  it('producer 抛错 → 只回复 + 可读提示，无干预无上抛', async () => {
    const seam = createCardConsultSeam(
      { buildContext: () => 'ctx', orchestrate: async () => ({ ops: [], issues: [] }), getHistory: () => [] },
      async () => {
        throw new Error('未配置默认 agent')
      }
    )
    const out = await seam.consult({ cardId: 'login', intent: '进度？' })
    expect(out.reply).toMatch(/未能作答|失败|未配置/)
    expect(out.interventions).toBeUndefined()
    expect(out.proposal).toBeUndefined()
  })
})
