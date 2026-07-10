import { create } from 'zustand'

/** 查看器中一个已打开文件的标签。 */
export interface OpenFile {
  /** 文件绝对路径（唯一标识一个标签）。 */
  path: string
  /** 展示用文件名（路径末段）。 */
  name: string
}

interface FileViewerState {
  tabs: OpenFile[]
  /** 当前激活标签路径；无打开文件时为 null。 */
  activePath: string | null
  /**
   * 浮层弹窗是否展开。底栏（任务栏）始终常驻、与浮层不互斥；
   * 此布尔只控制蒙层 + 浮层的开合，不影响底栏与已开文件。
   */
  popupOpen: boolean
  /** 通用打开入口：已开则聚焦、未开则新增；总是展开浮层。 */
  open: (path: string) => void
  /** 关闭一个标签；若关的是激活标签则激活相邻；关到空则收起浮层。 */
  closeTab: (path: string) => void
  /** 切换激活标签。 */
  setActive: (path: string) => void
  /** 收起浮层（蒙层+弹窗消失，底栏与标签保留）。 */
  minimize: () => void
  /** 展开浮层。 */
  restore: () => void
  /** 底栏入口点击：在展开/收起间切换（无打开文件时无操作）。 */
  toggle: () => void
  /** 整体关闭：清空所有标签并收起浮层。 */
  closeAll: () => void
}

/** 取路径末段作为展示文件名（兼容 / 与 \\）。 */
function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

/**
 * 应用级文件查看器状态：承载已开文件、激活项与浮层开合。
 * 底栏（任务栏）由组件常驻渲染，不在此用状态控制——它一直显示、与浮层共存。
 * 设计为可被任意入口（文件树、未来的 agent 提及/需求卡附件）通过 open() 调用，
 * 不经组件 props 透传——非组件代码可用 useFileViewerStore.getState().open(path)。
 */
export const useFileViewerStore = create<FileViewerState>((set) => ({
  tabs: [],
  activePath: null,
  popupOpen: false,

  open: (path) =>
    set((st) => {
      const exists = st.tabs.some((t) => t.path === path)
      const tabs = exists ? st.tabs : [...st.tabs, { path, name: baseName(path) }]
      return { tabs, activePath: path, popupOpen: true }
    }),

  closeTab: (path) =>
    set((st) => {
      const idx = st.tabs.findIndex((t) => t.path === path)
      if (idx === -1) return st
      const tabs = st.tabs.filter((t) => t.path !== path)
      if (tabs.length === 0) return { tabs, activePath: null, popupOpen: false }
      let activePath = st.activePath
      if (st.activePath === path) {
        // 激活相邻：优先前一个，否则后一个。
        const neighbor = tabs[idx - 1] ?? tabs[idx] ?? tabs[0]
        activePath = neighbor.path
      }
      return { tabs, activePath }
    }),

  setActive: (path) => set({ activePath: path }),

  minimize: () => set({ popupOpen: false }),

  restore: () => set({ popupOpen: true }),

  toggle: () => set((st) => (st.tabs.length === 0 ? st : { popupOpen: !st.popupOpen })),

  closeAll: () => set({ tabs: [], activePath: null, popupOpen: false })
}))
