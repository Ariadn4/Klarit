/**
 * 决策收件箱的渲染层状态：条目快照 + 面板开合。
 *
 * 条目的真相在主进程（它自己是 `pendingDecision` 的投影），这里只是**镜像**：
 * 挂载时 `load()` 拉一次，之后由主进程推来的全量快照 `setEntries` 覆盖。渲染层不自行增删条目。
 */

import { create } from 'zustand'
import type { DecisionInboxEntry } from '@shared/decision-inbox'

interface DecisionInboxState {
  /** 当前待决策条目（主进程已按等最久在前排好序）。 */
  entries: DecisionInboxEntry[]
  /** 收件箱面板是否展开。 */
  open: boolean
  /** 拉取当前收件箱（挂载 / 重新绑定项目时）。 */
  load: () => Promise<void>
  /** 用主进程推来的全量快照替换条目；清空时顺带收起面板。 */
  setEntries: (entries: DecisionInboxEntry[]) => void
  toggle: () => void
  close: () => void
}

export const useDecisionInboxStore = create<DecisionInboxState>((set) => ({
  entries: [],
  open: false,

  load: async () => {
    const entries = await window.klarit.listDecisionInbox()
    set((s) => ({ entries, open: entries.length === 0 ? false : s.open }))
  },

  setEntries: (entries) => set((s) => ({ entries, open: entries.length === 0 ? false : s.open })),

  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}))
