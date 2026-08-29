import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CandidateCard, DecomposeOutcome, DecomposePromptOutcome, StoredCard } from '@shared/types'
import { NewRequirementFlow } from './NewRequirementFlow'
import { useNewRequirementStore } from '../stores/newRequirement'
import { useCardsStore } from '../stores/cards'
import { DEFAULT_CARD_TYPES } from '@shared/card-type'

const stored = (over: Partial<StoredCard> = {}): StoredCard => ({
  proposedName: 'running',
  title: '在跑卡',
  description: '',
  typeId: 'feature',
  relations: [],
  status: '进行中',
  activeRunId: 'r1',
  createdAt: 1,
  updatedAt: 1,
  projectId: 'p1',
  repos: [],
  ...over
})

const card = (over: Partial<CandidateCard> = {}): CandidateCard => ({
  proposedName: 'add-dark-mode',
  title: '增加暗色模式',
  description: '## goals\n给界面加暗色主题',
  typeId: 'feature',
  relations: [],
  ...over
})

let promptOutcome: DecomposePromptOutcome
let decomposeOutcome: DecomposeOutcome

function installKlarit(over: Record<string, unknown> = {}): void {
  const api = {
    getDecomposePrompt: vi.fn(async () => promptOutcome),
    decomposeRequirement: vi.fn(async () => decomposeOutcome),
    pickAttachments: vi.fn(async () => [] as string[]),
    saveClipboardImage: vi.fn(async () => null),
    getDroppedFilePath: vi.fn(() => ''),
    createCards: vi.fn(async () => ({ created: [], issues: [] })),
    listCards: vi.fn(async () => []),
    listCardTypes: vi.fn(async () => []),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
}

const openEntry = (): Promise<void> => act(async () => {
  await useNewRequirementStore.getState().openEntry()
})

beforeEach(() => {
  promptOutcome = { prompt: 'P' }
  decomposeOutcome = { candidates: [card()], issues: [] }
  installKlarit()
  useNewRequirementStore.setState({
    phase: 'idle',
    windowOpen: false,
    description: '',
    reviewCards: [],
    issues: [],
    notice: null
  })
})

describe('描述想法窗', () => {
  it('openEntry 已绑定 → 打开描述想法窗（附件/描述/提示，无蒙层）', async () => {
    render(<NewRequirementFlow />)
    await openEntry()
    expect(screen.getByRole('dialog', { name: '描述想法' })).toBeInTheDocument()
    expect(screen.getByText('附件')).toBeInTheDocument()
    expect(screen.getByLabelText('描述内容')).toBeInTheDocument()
    expect(screen.getByText(/Ctrl\+V 粘贴截图/)).toBeInTheDocument()
    // 无蒙层：不存在 bg-black/50 scrim
    expect(document.querySelector('.bg-black\\/50')).toBeNull()
  })

  it('openEntry 未绑定 → 空态提示、不开描述窗', async () => {
    promptOutcome = { unbound: true }
    render(<NewRequirementFlow />)
    await openEntry()
    expect(screen.queryByRole('dialog', { name: '描述想法' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('未绑定项目')
  })

  it('取消 → 不发起分解、收起', async () => {
    const decomposeRequirement = vi.fn()
    installKlarit({ decomposeRequirement })
    render(<NewRequirementFlow />)
    await openEntry()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(decomposeRequirement).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('附件按钮 → 系统文件选择器选中的路径插入正文', async () => {
    installKlarit({ pickAttachments: vi.fn(async () => ['C:\\a\\spec.md', 'C:\\b\\img.png']) })
    render(<NewRequirementFlow />)
    await openEntry()
    await userEvent.click(screen.getByRole('button', { name: '附件' }))
    await waitFor(() => {
      const desc = useNewRequirementStore.getState().description
      expect(desc).toContain('C:\\a\\spec.md')
      expect(desc).toContain('C:\\b\\img.png')
    })
  })

  it('粘贴图片 → 落盘路径插入正文', async () => {
    installKlarit({ saveClipboardImage: vi.fn(async () => 'C:\\att\\paste-1.png') })
    render(<NewRequirementFlow />)
    await openEntry()
    fireEvent.paste(screen.getByLabelText('描述内容'), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png' }] }
    })
    await waitFor(() =>
      expect(useNewRequirementStore.getState().description).toContain('paste-1.png')
    )
  })

  it('拖入文件 → 路径插入正文', async () => {
    installKlarit({ getDroppedFilePath: vi.fn(() => 'C:\\drop\\design.pdf') })
    render(<NewRequirementFlow />)
    await openEntry()
    fireEvent.drop(screen.getByLabelText('描述内容'), {
      dataTransfer: { files: [new File(['x'], 'design.pdf')] }
    })
    await waitFor(() =>
      expect(useNewRequirementStore.getState().description).toContain('design.pdf')
    )
  })
})

describe('处理态与重弹（状态由「待办」列按钮承载，此处不再渲染底栏指示）', () => {
  it('提交 → 处理态隐藏描述窗（无独立底栏「建卡中」）→ 完成弹审阅窗', async () => {
    let resolveDecompose!: (v: DecomposeOutcome) => void
    installKlarit({
      decomposeRequirement: vi.fn(() => new Promise<DecomposeOutcome>((r) => (resolveDecompose = r)))
    })
    render(<NewRequirementFlow />)
    await openEntry()
    await userEvent.type(screen.getByLabelText('描述内容'), '一大段想法')
    await userEvent.click(screen.getByRole('button', { name: '提交' }))
    // 处理态：描述窗隐藏、phase=processing；本组件不再渲染独立「建卡中」指示（改由 CreateRequirementEntry 承载）
    expect(screen.queryByRole('dialog', { name: '描述想法' })).not.toBeInTheDocument()
    expect(useNewRequirementStore.getState().phase).toBe('processing')
    expect(screen.queryByRole('button', { name: '建卡中' })).not.toBeInTheDocument()
    // 完成 → 弹审阅窗
    await act(async () => {
      resolveDecompose({ candidates: [card()], issues: [] })
    })
    expect(screen.getByRole('dialog', { name: '审阅候选任务' })).toBeInTheDocument()
    expect(useNewRequirementStore.getState().phase).toBe('reviewing')
  })

  it('处理中再 openEntry → 重弹显示「正在处理」、不二次分解', async () => {
    const decomposeRequirement = vi.fn(() => new Promise<DecomposeOutcome>(() => {}))
    installKlarit({ decomposeRequirement })
    render(<NewRequirementFlow />)
    await openEntry()
    await userEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await openEntry() // 模拟点底栏「建卡中」
    expect(screen.getByText('正在处理需求…')).toBeInTheDocument()
    expect(decomposeRequirement).toHaveBeenCalledTimes(1)
  })

  it('处理窗只留「收起」一个按钮：无关闭(×)，收起后 phase 仍 processing、建卡中仍在', async () => {
    installKlarit({ decomposeRequirement: vi.fn(() => new Promise<DecomposeOutcome>(() => {})) })
    render(<NewRequirementFlow />)
    await openEntry()
    await userEvent.click(screen.getByRole('button', { name: '提交' }))
    await openEntry() // 重开处理窗
    const dialog = screen.getByRole('dialog', { name: '描述想法' })
    expect(screen.getByText('正在处理需求…')).toBeInTheDocument()
    // 处理窗无「关闭」按钮，只有「收起」
    expect(within(dialog).queryByRole('button', { name: '关闭' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: '收起' }))
    // 收起后仍 processing、不中断；处理窗消失（「建卡中」态由「待办」列按钮承载，见 CreateRequirementEntry）
    expect(useNewRequirementStore.getState().phase).toBe('processing')
    expect(useNewRequirementStore.getState().windowOpen).toBe(false)
    expect(screen.queryByText('正在处理需求…')).not.toBeInTheDocument()
  })
})

describe('审阅候选任务窗', () => {
  it('类型徽章 + markdown 渲染描述（非源码）', async () => {
    useNewRequirementStore.setState({ phase: 'reviewing', windowOpen: true, reviewCards: [card()] })
    render(<NewRequirementFlow />)
    const dialog = screen.getByRole('dialog', { name: '审阅候选任务' })
    expect(within(dialog).getByText('feature')).toBeInTheDocument()
    // markdown：'## goals' 渲染为 goals 标题，不出现 '##' 源码
    expect(within(dialog).getByText('goals')).toBeInTheDocument()
    expect(within(dialog).queryByText(/##/)).toBeNull()
  })

  it('点卡进详情：仅标题与描述可改，分类/预取名/关系只读', async () => {
    useNewRequirementStore.setState({
      phase: 'reviewing',
      windowOpen: true,
      reviewCards: [card({ relations: [{ kind: 'parent', target: 'theme-epic' }] })]
    })
    render(<NewRequirementFlow />)
    await userEvent.click(screen.getByText('增加暗色模式'))
    expect(screen.getByLabelText('标题')).toHaveValue('增加暗色模式')
    expect(screen.getByLabelText('描述')).toHaveValue('## goals\n给界面加暗色主题')
    // 分类无输入控件（只读徽章）
    expect(screen.queryByLabelText('分类')).toBeNull()
    // 改标题写回 store
    await userEvent.clear(screen.getByLabelText('标题'))
    await userEvent.type(screen.getByLabelText('标题'), '暗色模式v2')
    expect(useNewRequirementStore.getState().reviewCards[0].title).toBe('暗色模式v2')
    // 预取名/关系只读展示
    expect(screen.getByText('add-dark-mode')).toBeInTheDocument()
    expect(screen.getByText(/parent→theme-epic/)).toBeInTheDocument()
  })

  it('无候选 → 空态提示', () => {
    useNewRequirementStore.setState({ phase: 'reviewing', windowOpen: true, reviewCards: [] })
    render(<NewRequirementFlow />)
    expect(screen.getByText(/未产出候选任务/)).toBeInTheDocument()
  })

  it('详情视图不显示「取消/创建任务」；标题栏 chevron 返回候选列表后才可创建', async () => {
    useNewRequirementStore.setState({ phase: 'reviewing', windowOpen: true, reviewCards: [card()] })
    render(<NewRequirementFlow />)
    // 列表页有「创建任务」
    expect(screen.getByRole('button', { name: '创建任务' })).toBeInTheDocument()
    // 进详情：「取消/创建任务」消失
    await userEvent.click(screen.getByText('增加暗色模式'))
    expect(screen.queryByRole('button', { name: '创建任务' })).toBeNull()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
    // 标题栏出现返回按钮（其可点文案为返回目的地「审阅候选任务」）
    const back = screen.getByRole('button', { name: '审阅候选任务' })
    await userEvent.click(back)
    // 返回列表：「创建任务」重现
    expect(screen.getByRole('button', { name: '创建任务' })).toBeInTheDocument()
  })

  it('点创建任务 → 经统一接缝落库候选、流程收起', async () => {
    const createCards = vi.fn(async () => ({ created: [], issues: [] }))
    installKlarit({ createCards })
    useNewRequirementStore.setState({ phase: 'reviewing', windowOpen: true, reviewCards: [card()] })
    render(<NewRequirementFlow />)
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }))
    expect(createCards).toHaveBeenCalledOnce()
    expect(useNewRequirementStore.getState().phase).toBe('idle')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('取消 → 丢弃候选、收起', async () => {
    useNewRequirementStore.setState({ phase: 'reviewing', windowOpen: true, reviewCards: [card()] })
    render(<NewRequirementFlow />)
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(useNewRequirementStore.getState().phase).toBe('idle')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('审阅窗跨卡依赖门（呈现 / 删除 / 加边校验）', () => {
  beforeEach(() => {
    useCardsStore.setState({ cards: [stored()], cardTypes: [...DEFAULT_CARD_TYPES] })
  })

  it('详情呈现跨卡依赖门与被指向卡的当前状态', async () => {
    useNewRequirementStore.setState({
      phase: 'reviewing',
      windowOpen: true,
      reviewCards: [card({ relations: [{ kind: 'blocked_by', target: 'running' }] })]
    })
    render(<NewRequirementFlow />)
    await userEvent.click(screen.getByText('增加暗色模式'))
    expect(screen.getByText('跨卡依赖门')).toBeInTheDocument()
    // '被阻塞于' 既在依赖门行、也作加边下拉选项，故用 getAllByText。
    expect(screen.getAllByText('被阻塞于').length).toBeGreaterThan(0)
    expect(screen.getByText('running')).toBeInTheDocument()
    // 目标当前状态徽章
    expect(screen.getByText('进行中')).toBeInTheDocument()
  })

  it('删除一条依赖门 → 候选卡关系被移除', async () => {
    useNewRequirementStore.setState({
      phase: 'reviewing',
      windowOpen: true,
      reviewCards: [card({ relations: [{ kind: 'blocked_by', target: 'running' }] })]
    })
    render(<NewRequirementFlow />)
    await userEvent.click(screen.getByText('增加暗色模式'))
    await userEvent.click(screen.getByRole('button', { name: '删除依赖' }))
    expect(useNewRequirementStore.getState().reviewCards[0].relations).toEqual([])
  })

  it('加 blocked_by 指向现有卡 → 写入候选关系', async () => {
    useCardsStore.setState({ cards: [stored({ proposedName: 'idle-card', title: '空闲卡', status: '未开始', activeRunId: undefined })], cardTypes: [...DEFAULT_CARD_TYPES] })
    useNewRequirementStore.setState({ phase: 'reviewing', windowOpen: true, reviewCards: [card()] })
    render(<NewRequirementFlow />)
    await userEvent.click(screen.getByText('增加暗色模式'))
    await userEvent.selectOptions(screen.getByLabelText('依赖类型'), 'blocked_by')
    await userEvent.selectOptions(screen.getByLabelText('依赖目标'), 'idle-card')
    await userEvent.click(screen.getByRole('button', { name: '添加依赖' }))
    expect(useNewRequirementStore.getState().reviewCards[0].relations).toEqual([
      { kind: 'blocked_by', target: 'idle-card' }
    ])
  })

  it('加 blocks 指向在跑卡 → 被拒、给出原因、不写入', async () => {
    useNewRequirementStore.setState({ phase: 'reviewing', windowOpen: true, reviewCards: [card()] })
    render(<NewRequirementFlow />)
    await userEvent.click(screen.getByText('增加暗色模式'))
    await userEvent.selectOptions(screen.getByLabelText('依赖类型'), 'blocks')
    await userEvent.selectOptions(screen.getByLabelText('依赖目标'), 'running')
    await userEvent.click(screen.getByRole('button', { name: '添加依赖' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(useNewRequirementStore.getState().reviewCards[0].relations).toEqual([])
  })
})

describe('巡检推来的候选 —— 复用同一审阅窗，止于审阅', () => {
  /** 装一份带 onPatrolCandidates 订阅口的 api，并把推送函数交出来。 */
  function installWithPatrol(): { push: (outcome: { candidates: CandidateCard[]; issues: [] }) => void; off: ReturnType<typeof vi.fn> } {
    const off = vi.fn()
    let handler: ((o: { candidates: CandidateCard[]; issues: [] }) => void) | null = null
    installKlarit({
      onPatrolCandidates: vi.fn((h: (o: { candidates: CandidateCard[]; issues: [] }) => void) => {
        handler = h
        return off
      })
    })
    return { push: (o) => act(() => handler?.(o)), off }
  }

  it('空闲时收到巡检候选 → 直接进审阅窗，卡片可见', () => {
    const { push } = installWithPatrol()
    render(<NewRequirementFlow />)
    push({ candidates: [card({ title: '文档漂移：web' })], issues: [] })
    expect(screen.getByRole('dialog', { name: '审阅候选任务' })).toBeInTheDocument()
    expect(screen.getByText('文档漂移：web')).toBeInTheDocument()
    // 止于审阅：未落库（createCards 没被调）
    expect((window.klarit as unknown as { createCards: ReturnType<typeof vi.fn> }).createCards).not.toHaveBeenCalled()
  })

  it('用户正在描述/审阅时不打断（丢弃本次推送，下个周期问题还在还会再来）', async () => {
    const { push } = installWithPatrol()
    render(<NewRequirementFlow />)
    await openEntry()
    push({ candidates: [card({ title: '文档漂移：web' })], issues: [] })
    expect(screen.getByRole('dialog', { name: '描述想法' })).toBeInTheDocument()
    expect(screen.queryByText('文档漂移：web')).toBeNull()
  })

  it('卸载时取消订阅', () => {
    const { off } = installWithPatrol()
    const view = render(<NewRequirementFlow />)
    view.unmount()
    expect(off).toHaveBeenCalled()
  })
})
