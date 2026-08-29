/**
 * 全局模态协调器（modalQueue store）：让「后台任务就绪后主动弹出的浮层」不叠加在用户正开着的全局模态上。
 *
 * 机制——
 * - 每个全局模态挂载/打开时 `registerModalOpen(id)`、关闭/卸载时 `registerModalClose(id)`（用 Set 计数，多模态并存也稳）。
 * - 主动弹出走 `requestPopup(fn)`：此刻无模态在开则立即执行；否则入队，待最后一个模态关闭再顺次出队。
 * - 出队**一次只放一个**：每个待弹项自身会开出一个新模态（登记 open），故其后的项保持排队，待它关闭再放下一个。
 *
 * 通用可扩展：任何未来的主动弹出（不只工作流提案）都能复用 `requestPopup`。
 */

import { create } from 'zustand'

interface ModalQueueState {
  /** 当前在开的全局模态 id 集合；空 = 无模态在开。 */
  openIds: Set<string>
  /** 待弹队列（无模态在开时排空，一次一个）。 */
  queue: Array<() => void>
  /** 某全局模态打开/挂载：登记占位（幂等）。 */
  registerModalOpen: (id: string) => void
  /** 某全局模态关闭/卸载：撤销占位；若这是最后一个 → 出队一个待弹项执行。 */
  registerModalClose: (id: string) => void
  /** 请求主动弹出：无模态在开则立即执行，否则入队。 */
  requestPopup: (fn: () => void) => void
}

export const useModalQueue = create<ModalQueueState>((set, get) => ({
  openIds: new Set(),
  queue: [],

  registerModalOpen: (id) =>
    set((s) => {
      const openIds = new Set(s.openIds)
      openIds.add(id)
      return { openIds }
    }),

  registerModalClose: (id) => {
    set((s) => {
      const openIds = new Set(s.openIds)
      openIds.delete(id)
      return { openIds }
    })
    // 最后一个模态关闭 → 顺次放行一个待弹项（它自身会开出下一个模态，故其后的仍排队）。
    const { openIds, queue } = get()
    if (openIds.size === 0 && queue.length > 0) {
      const [next, ...rest] = queue
      set({ queue: rest })
      next()
    }
  },

  requestPopup: (fn) => {
    if (get().openIds.size === 0) {
      fn()
      return
    }
    set((s) => ({ queue: [...s.queue, fn] }))
  }
}))
