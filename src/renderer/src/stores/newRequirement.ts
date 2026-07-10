import { create } from 'zustand'
import type { CandidateCard, CandidateIssue } from '@shared/types'
import { useCardsStore } from './cards'

/** 新建需求流程的阶段：空闲 → 描述想法 → 建卡中（处理）→ 审阅候选。全程状态由「待办」列「+ 创建」按钮承载（见 CreateRequirementEntry）。 */
export type DecomposePhase = 'idle' | 'describing' | 'processing' | 'reviewing'

interface NewRequirementState {
  phase: DecomposePhase
  /** 浮窗是否可见——非空闲态可收起、再点「+ 创建」按钮重开（收起时按钮反映当前相位状态）。 */
  windowOpen: boolean
  /** 描述想法文本（可一次写多条；粘贴图片/拖入文件/选附件的路径都插入此正文）。 */
  description: string
  /** 审阅期可编辑的候选卡副本（仅标题与描述可改）。 */
  reviewCards: CandidateCard[]
  /** 候选卡校验问题（不合卡模型/重名/悬挂关系）。 */
  issues: CandidateIssue[]
  /** 空态/提示（如未绑定项目无处归属需求）。 */
  notice: string | null

  /** 入口点击：idle→先查项目绑定，未绑定给空态不开窗；已绑定开描述窗。processing/reviewing→重开浮窗。 */
  openEntry: () => Promise<void>
  /** 关闭空态/提示。 */
  dismissNotice: () => void
  setDescription: (text: string) => void
  /** 把一段文本（如附件/截图路径）追加进正文，自动换行分隔。 */
  appendToDescription: (text: string) => void
  /** 提交分解：收起窗→处理态→产出候选→审阅；未绑定项目给空态回 idle。 */
  submit: () => Promise<void>
  /** 收起浮窗（处理态仍在建卡，状态由「+ 创建」按钮反映）。 */
  minimize: () => void
  /** 取消/关闭整个流程并清空。 */
  cancel: () => void
  setReviewTitle: (index: number, title: string) => void
  setReviewDescription: (index: number, description: string) => void
  /** 创建任务：把（含编辑的）候选经统一创建接缝落库到当前项目（手动新建路），再刷新看板。 */
  createTasks: () => Promise<void>
}

const CLEARED = {
  description: '',
  reviewCards: [] as CandidateCard[],
  issues: [] as CandidateIssue[],
  notice: null as string | null
}

/**
 * 新建需求流程状态：描述想法 → 分解 → 审阅候选。可被任意入口经 .getState().openEntry() 调起。
 * 三窗无蒙层（可最小化浮窗）；全程状态由「待办」列「+ 创建」按钮承载（处理态「建卡中」、审阅收起可重开）。落库归下一个 change。
 */
export const useNewRequirementStore = create<NewRequirementState>((set, get) => ({
  phase: 'idle',
  windowOpen: false,
  ...CLEARED,

  openEntry: async () => {
    // 非 idle（处理中/审阅中）：只重开浮窗，不重查绑定、不重启分解。
    if (get().phase !== 'idle') {
      set({ windowOpen: true })
      return
    }
    // idle：先查当前窗口是否绑定项目——未绑定给空态、不开描述窗。
    const outcome = await window.klarit.getDecomposePrompt()
    if ('unbound' in outcome) {
      set({ notice: 'unbound', windowOpen: false })
      return
    }
    set({ phase: 'describing', windowOpen: true, notice: null })
  },

  dismissNotice: () => set({ notice: null }),

  setDescription: (text) => set({ description: text }),

  appendToDescription: (text) =>
    set((st) => ({ description: st.description ? `${st.description}\n${text}` : text })),

  submit: async () => {
    const { description } = get()
    // 收起描述窗，进入处理态（「待办」列「+ 创建」按钮显示「建卡中」）。
    set({ phase: 'processing', windowOpen: false, notice: null })
    const outcome = await window.klarit.decomposeRequirement({ description })
    // 守卫：处理期间若已被取消/重置（phase 变了），丢弃这次结果，不强行弹审阅。
    if (get().phase !== 'processing') return
    if ('unbound' in outcome) {
      set({ phase: 'idle', windowOpen: false, notice: 'unbound' })
      return
    }
    set({ phase: 'reviewing', windowOpen: true, reviewCards: outcome.candidates, issues: outcome.issues })
  },

  minimize: () => set({ windowOpen: false }),

  cancel: () => set({ phase: 'idle', windowOpen: false, ...CLEARED }),

  setReviewTitle: (index, title) =>
    set((st) => ({ reviewCards: st.reviewCards.map((c, i) => (i === index ? { ...c, title } : c)) })),

  setReviewDescription: (index, description) =>
    set((st) => ({ reviewCards: st.reviewCards.map((c, i) => (i === index ? { ...c, description } : c)) })),

  // 统一创建接缝：把审阅通过的候选落库到当前项目（与外部分解路共用 cards:create），再刷新看板、收起流程。
  createTasks: async () => {
    const { reviewCards } = get()
    if (reviewCards.length > 0) {
      await window.klarit.createCards(reviewCards)
      await useCardsStore.getState().load()
    }
    set({ phase: 'idle', windowOpen: false, ...CLEARED })
  }
}))
