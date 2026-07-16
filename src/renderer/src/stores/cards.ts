/**
 * 需求卡的渲染层状态：卡列表 + 类型集（算 archetype）+ 各卡运行断点（按 runId 回灌）+ 命令输出缓冲
 * + 卡详情面板开合。卡数据落库在主进程（requirement-card-store），这里只读视图 + 触发动作。
 */

import { create } from 'zustand'
import type { CardTypeDef, RemoveCardOptions, RunBreakpoint, StoredCard } from '@shared/types'

/** 命令输出渲染缓冲上限：只留末段（长命令/测试不爆内存）。 */
const OUTPUT_CAP = 20000

/** 输出桶缓冲键。 */
export const outputKey = (runId: string, bucket: string): string => `${runId}::${bucket}`

/** 后台命令的终态：运行中 / 用户中止 / 自行退出 / 超时被杀。终态项保留到用户点「清除」才移除。 */
export type BgStatus = 'running' | 'stopped' | 'exited' | 'timeout'
export interface BgEntry {
  bgId: string
  nodeId: string
  label: string
  status: BgStatus
}

interface CardsState {
  cards: StoredCard[]
  cardTypes: CardTypeDef[]
  /** runId → 最新断点（运行态、当前节点/阶段、待决策、后台命令）。 */
  runs: Record<string, RunBreakpoint>
  /** `${runId}::${bucket}` → 命令输出累积。 */
  outputs: Record<string, string>
  /** runId → 后台命令条目（含已终止的，保留到用户清除）。 */
  backgrounds: Record<string, BgEntry[]>
  /** 打开的卡详情（预取名）；null=未打开。 */
  detailSlug: string | null
  /** 详情打开后定位到的区域（红点→decision、呼吸点→output）。 */
  detailFocus: 'decision' | 'output' | null
  load: () => Promise<void>
  setRun: (bp: RunBreakpoint) => void
  appendOutput: (runId: string, bucket: string, chunk: string) => void
  seedOutput: (runId: string, bucket: string, text: string) => void
  /** 后台命令事件（started/stopped/exited/timeout）→ upsert；终态项保留待清除。 */
  onBackground: (runId: string, entry: BgEntry) => void
  /** 用户点「清除」：移除一条（已终止的）后台命令条目。 */
  clearBackground: (runId: string, bgId: string) => void
  /** 进入新节点：清掉已终止（非运行中）的后台命令条目，运行中的（转后台命令）保留。 */
  pruneStoppedBackgrounds: (runId: string) => void
  /** 运行抵达终局：清掉该运行的全部后台命令窗口（引擎已把它们杀光）。 */
  clearRunBackgrounds: (runId: string) => void
  openDetail: (slug: string, focus?: 'decision' | 'output' | null) => void
  closeDetail: () => void
  runCard: (slug: string) => Promise<{ error?: string }>
  /** 删卡：经 IPC 删该卡（清悬挂边、级联中止运行，opts 可要求回收 worktree+分支），刷新看板；删的是当前详情卡则关面板。 */
  removeCard: (slug: string, opts?: RemoveCardOptions) => Promise<void>
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: [],
  cardTypes: [],
  runs: {},
  outputs: {},
  backgrounds: {},
  detailSlug: null,
  detailFocus: null,

  load: async () => {
    const [cards, cardTypes] = await Promise.all([
      window.klarit.listCards(),
      window.klarit.listCardTypes()
    ])
    // 回灌每张在运行卡的最新断点。
    const runs: Record<string, RunBreakpoint> = { ...get().runs }
    await Promise.all(
      cards
        .filter((c) => c.activeRunId)
        .map(async (c) => {
          const bp = await window.klarit.getRunState(c.activeRunId as string)
          if (bp) runs[bp.runId] = bp
        })
    )
    set({ cards, cardTypes, runs })
  },

  setRun: (bp) =>
    set((s) => {
      // 回灌断点时,把其中仍活着的后台命令补进 backgrounds(尚未见过的记为 running);已终止的历史条目保留不动。
      // **终局(done/aborted)不回灌**:此时后台正被引擎拆除,回灌会把刚清掉的条目又当成运行中加回,造成闪烁。
      const existing = s.backgrounds[bp.runId] ?? []
      const byId = new Map(existing.map((e) => [e.bgId, e]))
      if (bp.state !== 'done' && bp.state !== 'aborted') {
        for (const rec of bp.background ?? []) {
          if (!byId.has(rec.bgId)) {
            byId.set(rec.bgId, { bgId: rec.bgId, nodeId: rec.nodeId, label: rec.label, status: 'running' })
          }
        }
      }
      return {
        runs: { ...s.runs, [bp.runId]: bp },
        backgrounds: { ...s.backgrounds, [bp.runId]: [...byId.values()] }
      }
    }),

  onBackground: (runId, entry) =>
    set((s) => {
      const list = s.backgrounds[runId] ?? []
      const idx = list.findIndex((e) => e.bgId === entry.bgId)
      const next = idx >= 0 ? list.map((e, i) => (i === idx ? { ...e, ...entry } : e)) : [...list, entry]
      return { backgrounds: { ...s.backgrounds, [runId]: next } }
    }),

  clearBackground: (runId, bgId) =>
    set((s) => ({
      backgrounds: { ...s.backgrounds, [runId]: (s.backgrounds[runId] ?? []).filter((e) => e.bgId !== bgId) }
    })),

  pruneStoppedBackgrounds: (runId) =>
    set((s) => ({
      backgrounds: { ...s.backgrounds, [runId]: (s.backgrounds[runId] ?? []).filter((e) => e.status === 'running') }
    })),

  clearRunBackgrounds: (runId) =>
    set((s) => ({ backgrounds: { ...s.backgrounds, [runId]: [] } })),

  appendOutput: (runId, bucket, chunk) =>
    set((s) => {
      const key = outputKey(runId, bucket)
      const next = ((s.outputs[key] ?? '') + chunk).slice(-OUTPUT_CAP)
      return { outputs: { ...s.outputs, [key]: next } }
    }),

  seedOutput: (runId, bucket, text) =>
    set((s) => ({ outputs: { ...s.outputs, [outputKey(runId, bucket)]: text.slice(-OUTPUT_CAP) } })),

  openDetail: (slug, focus = null) => set({ detailSlug: slug, detailFocus: focus }),
  closeDetail: () => set({ detailSlug: null, detailFocus: null }),

  runCard: async (slug) => {
    const res = await window.klarit.runCard(slug)
    if ('error' in res) return { error: res.error }
    // 触发后回灌：卡获得 activeRunId + 首个断点。
    await get().load()
    const bp = await window.klarit.getRunState(res.runId)
    if (bp) get().setRun(bp)
    return {}
  },

  removeCard: async (slug, opts) => {
    await window.klarit.removeCard(slug, opts)
    // 若删的是当前打开详情的卡，先关面板（避免刷新后详情指向已删卡）。
    if (get().detailSlug === slug) get().closeDetail()
    await get().load()
  }
}))
