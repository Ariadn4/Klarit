/**
 * 文档登记表的渲染层状态（documents store）：当前成员仓的登记表 + 编辑动作
 * （改判/移出/添加/编辑 prompt/逐条审批/公约编辑审批）。落库在主进程 document-store，
 * 这里持编辑中副本，save() 时整表持久化。编辑 prompt/公约会把对应审批打回 false——
 * 审批的是**当时那份文本**，改了就得重批。
 *
 * 分析（agent 分组+分类+起草一体）是慢路径：analyze() 期间 UI 只显示加载指示、
 * 完成后**统一推出**结果；无 agent / 失败时主进程回落启发式结果并带如实的 analyzeError。
 */

import { create } from 'zustand'
import type { DocKind, DocRegistry, ManagedDoc } from '@shared/types'

interface DocumentsState {
  /** 当前编辑中的登记表；null=未载入。 */
  registry: DocRegistry | null
  /** agent 分析进行中（可达数分钟；期间 UI 只给加载指示，完成后统一呈现）。 */
  analyzing: boolean
  /** 最近一次分析的失败态：null=成功；'no-agent'=确未配置默认 agent；其它=具体错误摘要（如实显示）。 */
  analyzeError: string | null
  /** 触发某成员仓的 agent 语义分析（并入既有表）；完成后载入结果与失败态。 */
  analyze: (memberId: string) => Promise<void>
  /** 读某成员仓既有表。 */
  load: (memberId: string) => Promise<void>
  /** 改判：在 dynamic/snapshot 间切换某条 kind。 */
  reclassify: (id: string) => void
  /** 移出：从表删除该条（隐式不纳管）。 */
  eject: (id: string) => void
  /** 添加：把一个文件/文件夹路径以指定 kind 入表（已在表则无操作）。 */
  add: (path: string, kind: DocKind) => void
  /** 改路径（agent 分组不合意时手动收级）：更新 id/location、打回未审批；撞既有路径不应用。 */
  editLocation: (id: string, path: string) => void
  /** 编辑某条 habitPrompt（打回未审批）。 */
  editPrompt: (id: string, text: string) => void
  /** 编辑项目级公约（打回未审批）。 */
  editConvention: (text: string) => void
  /** 整表审批（「确认并保存」的语义核）：全部条目 approved + 公约 conventionApproved 置 true。 */
  approveAll: () => void
  /** 把当前表整表持久化。 */
  save: () => Promise<void>
}

/** 对当前表做一次不可变更新（未载入时无操作）。 */
const patchRegistry = (
  s: DocumentsState,
  fn: (reg: DocRegistry) => DocRegistry
): Partial<DocumentsState> => (s.registry ? { registry: fn(s.registry) } : {})

const patchDoc = (reg: DocRegistry, id: string, fn: (d: ManagedDoc) => ManagedDoc): DocRegistry => ({
  ...reg,
  docs: reg.docs.map((d) => (d.id === id ? fn(d) : d))
})

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  registry: null,
  analyzing: false,
  analyzeError: null,

  analyze: async (memberId) => {
    set({ analyzing: true, analyzeError: null })
    try {
      const result = await window.klarit.analyzeDocuments(memberId)
      if (!result) {
        set({ registry: null })
        return
      }
      set({ registry: result.registry, analyzeError: result.error })
    } finally {
      set({ analyzing: false })
    }
  },

  load: async (memberId) => {
    set({ registry: await window.klarit.getDocuments(memberId) })
  },

  reclassify: (id) =>
    set((s) =>
      patchRegistry(s, (reg) =>
        patchDoc(reg, id, (d) => ({ ...d, kind: d.kind === 'dynamic' ? 'snapshot' : 'dynamic' }))
      )
    ),

  eject: (id) =>
    set((s) => patchRegistry(s, (reg) => ({ ...reg, docs: reg.docs.filter((d) => d.id !== id) }))),

  add: (path, kind) =>
    set((s) =>
      patchRegistry(s, (reg) =>
        reg.docs.some((d) => d.location === path)
          ? reg
          : {
              ...reg,
              docs: [...reg.docs, { id: path, location: path, kind, habitPrompt: '', approved: false }]
            }
      )
    ),

  editLocation: (id, path) =>
    set((s) =>
      patchRegistry(s, (reg) => {
        // 撞既有路径不应用（避免两条同 location 的脏表）。
        if (reg.docs.some((d) => d.location === path && d.id !== id)) return reg
        return {
          ...reg,
          docs: reg.docs.map((d) =>
            d.id === id ? { ...d, id: path, location: path, approved: false } : d
          )
        }
      })
    ),

  editPrompt: (id, text) =>
    set((s) =>
      patchRegistry(s, (reg) => patchDoc(reg, id, (d) => ({ ...d, habitPrompt: text, approved: false })))
    ),

  editConvention: (text) =>
    set((s) =>
      patchRegistry(s, (reg) => ({ ...reg, conventionPreamble: text, conventionApproved: false }))
    ),

  approveAll: () =>
    set((s) =>
      patchRegistry(s, (reg) => ({
        ...reg,
        docs: reg.docs.map((d) => ({ ...d, approved: true })),
        conventionApproved: true
      }))
    ),

  save: async () => {
    const reg = get().registry
    if (reg) await window.klarit.saveDocuments(reg)
  }
}))
