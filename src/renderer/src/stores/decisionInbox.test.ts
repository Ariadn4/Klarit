import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DecisionInboxEntry } from '@shared/decision-inbox'
import { useDecisionInboxStore } from './decisionInbox'

const entry = (runId: string, over: Partial<DecisionInboxEntry> = {}): DecisionInboxEntry => ({
  runId,
  cardId: `card-${runId}`,
  cardName: `卡 ${runId}`,
  source: 'impl:manual-gate',
  titleKey: 'engineDecision.manualGate',
  titleParams: { node: '实现' },
  pendingSince: 1_000,
  gateKind: 'review',
  ...over
})

function stubApi(entries: DecisionInboxEntry[]): { listDecisionInbox: ReturnType<typeof vi.fn> } {
  const api = { listDecisionInbox: vi.fn(async () => entries) }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api
}

beforeEach(() => {
  useDecisionInboxStore.setState({ entries: [], open: false })
})

describe('decisionInbox store', () => {
  it('load() 经 IPC 拉取当前收件箱并载入', async () => {
    const api = stubApi([entry('r1'), entry('r2')])
    await useDecisionInboxStore.getState().load()
    expect(api.listDecisionInbox).toHaveBeenCalledOnce()
    expect(useDecisionInboxStore.getState().entries.map((e) => e.runId)).toEqual(['r1', 'r2'])
  })

  it('setEntries 实时替换（主进程推来的增/删都是全量快照）', () => {
    useDecisionInboxStore.getState().setEntries([entry('r1')])
    expect(useDecisionInboxStore.getState().entries).toHaveLength(1)
    useDecisionInboxStore.getState().setEntries([entry('r1'), entry('r2')])
    expect(useDecisionInboxStore.getState().entries.map((e) => e.runId)).toEqual(['r1', 'r2'])
    useDecisionInboxStore.getState().setEntries([])
    expect(useDecisionInboxStore.getState().entries).toEqual([])
  })

  it('toggle 开合面板，close 收起', () => {
    useDecisionInboxStore.getState().toggle()
    expect(useDecisionInboxStore.getState().open).toBe(true)
    useDecisionInboxStore.getState().toggle()
    expect(useDecisionInboxStore.getState().open).toBe(false)
    useDecisionInboxStore.getState().toggle()
    useDecisionInboxStore.getState().close()
    expect(useDecisionInboxStore.getState().open).toBe(false)
  })

  it('条目清空时自动收起面板（没东西可看就别占着屏）', () => {
    useDecisionInboxStore.getState().setEntries([entry('r1')])
    useDecisionInboxStore.getState().toggle()
    expect(useDecisionInboxStore.getState().open).toBe(true)
    useDecisionInboxStore.getState().setEntries([])
    expect(useDecisionInboxStore.getState().open).toBe(false)
  })
})
