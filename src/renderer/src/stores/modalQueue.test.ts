import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useModalQueue } from './modalQueue'

beforeEach(() => {
  // 全局单例 store，逐用例复位避免泄漏。
  useModalQueue.setState({ openIds: new Set(), queue: [] })
})

describe('modalQueue 全局模态协调器', () => {
  it('无模态在开 → requestPopup 立即执行', () => {
    const fn = vi.fn()
    useModalQueue.getState().requestPopup(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(useModalQueue.getState().queue).toHaveLength(0)
  })

  it('有模态在开 → requestPopup 入队，不立即执行；模态关闭后出队执行', () => {
    const { registerModalOpen, registerModalClose, requestPopup } = useModalQueue.getState()
    registerModalOpen('doc')
    const fn = vi.fn()
    requestPopup(fn)
    expect(fn).not.toHaveBeenCalled()
    expect(useModalQueue.getState().queue).toHaveLength(1)

    registerModalClose('doc')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(useModalQueue.getState().queue).toHaveLength(0)
  })

  it('多个待弹项：模态关闭时一次只出队一个，各自成为下一个模态后下一个才弹（按序）', () => {
    const { registerModalOpen, registerModalClose, requestPopup } = useModalQueue.getState()
    registerModalOpen('doc')
    const calls: number[] = []
    // 第一个弹出后自己成为一个新模态（模拟真实浮层登记 open）。
    requestPopup(() => {
      calls.push(1)
      useModalQueue.getState().registerModalOpen('preview-1')
    })
    requestPopup(() => {
      calls.push(2)
    })
    expect(calls).toEqual([])

    // 关掉初始模态 → 只出队第一个；它开了新模态，故第二个仍排队。
    registerModalClose('doc')
    expect(calls).toEqual([1])
    expect(useModalQueue.getState().queue).toHaveLength(1)

    // 关掉第一个弹出的模态 → 出队第二个。
    registerModalClose('preview-1')
    expect(calls).toEqual([1, 2])
    expect(useModalQueue.getState().queue).toHaveLength(0)
  })

  it('仍有其它模态在开时关闭一个不触发出队（只在最后一个关闭时排空）', () => {
    const { registerModalOpen, registerModalClose, requestPopup } = useModalQueue.getState()
    registerModalOpen('a')
    registerModalOpen('b')
    const fn = vi.fn()
    requestPopup(fn)
    registerModalClose('a')
    expect(fn).not.toHaveBeenCalled()
    registerModalClose('b')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('重复登记同 id 幂等；关闭未登记 id 不抛', () => {
    const { registerModalOpen, registerModalClose, requestPopup } = useModalQueue.getState()
    registerModalOpen('a')
    registerModalOpen('a')
    const fn = vi.fn()
    requestPopup(fn)
    registerModalClose('a')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(() => registerModalClose('nope')).not.toThrow()
  })
})
