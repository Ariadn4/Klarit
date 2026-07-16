import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardTypeDef, RunBreakpoint, StoredCard } from '@shared/types'
import { RequirementCardDetail } from './RequirementCardDetail'
import { useCardsStore } from '../stores/cards'

const TYPES: CardTypeDef[] = [{ id: 'feat', name: 'Feat', description: '', archetype: 'leaf' }]

function card(over: Partial<StoredCard> = {}): StoredCard {
  return {
    proposedName: 'add-thing',
    title: 'Add thing',
    description: '描述',
    typeId: 'feat',
    relations: [],
    status: '未开始',
    createdAt: 0,
    updatedAt: 0,
    projectId: 'p1',
    repos: [],
    ...over
  }
}

function bp(over: Partial<RunBreakpoint> = {}): RunBreakpoint {
  return {
    runId: 'r1',
    request: { workflowId: 'w', repoPath: '/repo' },
    state: 'running',
    currentNodeId: 'n1',
    phase: { kind: 'executing' },
    pendingDecision: null,
    ...over
  }
}

function installKlarit(extra: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    getWorkflow: vi.fn(async () => null),
    getCardConversation: vi.fn(async () => null),
    getRunState: vi.fn(async () => null),
    pauseRun: vi.fn(async () => bp({ state: 'paused' })),
    resumeRun: vi.fn(async () => bp({ state: 'running' })),
    runCard: vi.fn(async () => ({ runId: 'r1' })),
    removeCard: vi.fn(async () => {}),
    cardBranchCleanupInfo: vi.fn(async () => []),
    listCards: vi.fn(async () => []),
    listCardTypes: vi.fn(async () => TYPES),
    copyText: vi.fn(async () => {}),
    ...extra
  }
  ;(window as unknown as { klarit: unknown }).klarit = api
  return api as Record<string, ReturnType<typeof vi.fn>>
}

function seed(c: StoredCard, runs: Record<string, RunBreakpoint> = {}): void {
  useCardsStore.setState({ cards: [c], cardTypes: TYPES, runs, detailSlug: c.proposedName, detailFocus: null })
}

beforeEach(() => {
  vi.restoreAllMocks()
  useCardsStore.setState({ cards: [], cardTypes: [], runs: {}, detailSlug: null, detailFocus: null })
})

describe('RequirementCardDetail · header 运行主控图标化', () => {
  it('无运行卡 → header 显示运行(play)主控，点击触发 runCard', async () => {
    const api = installKlarit()
    seed(card())
    render(<RequirementCardDetail />)
    const runBtn = screen.getByLabelText('运行')
    await userEvent.click(runBtn)
    expect(api.runCard).toHaveBeenCalledWith('add-thing')
  })

  it('运行中卡 → header 显示暂停主控，点击触发 pauseRun', async () => {
    const api = installKlarit()
    seed(card({ activeRunId: 'r1' }), { r1: bp({ state: 'running' }) })
    render(<RequirementCardDetail />)
    const pauseBtn = screen.getByLabelText('暂停')
    await userEvent.click(pauseBtn)
    expect(api.pauseRun).toHaveBeenCalledWith('r1')
  })

  it('已暂停卡 → header 显示恢复(play)主控，点击触发 resumeRun', async () => {
    const api = installKlarit()
    seed(card({ activeRunId: 'r1' }), { r1: bp({ state: 'paused' }) })
    render(<RequirementCardDetail />)
    const resumeBtn = screen.getByLabelText('恢复')
    await userEvent.click(resumeBtn)
    expect(api.resumeRun).toHaveBeenCalledWith('r1')
  })
})

describe('RequirementCardDetail · 删除按钮', () => {
  it('无运行卡：删除按钮可用，二次确认后调 removeCard', async () => {
    const api = installKlarit()
    seed(card())
    render(<RequirementCardDetail />)
    const delBtn = screen.getByLabelText('删除')
    expect(delBtn).not.toBeDisabled()
    await userEvent.click(delBtn)
    // 二次确认弹窗出现
    const dialog = await screen.findByRole('dialog', { name: '删除这张需求卡？' })
    expect(dialog).toBeInTheDocument()
    // 确认（弹窗内的删除按钮，避开 header 同名图标）
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(api.removeCard).toHaveBeenCalledWith('add-thing', { recycleBranches: false, allowUnmerged: false })
  })

  it('二次确认取消 → 不调 removeCard、弹窗关闭', async () => {
    const api = installKlarit()
    seed(card())
    render(<RequirementCardDetail />)
    await userEvent.click(screen.getByLabelText('删除'))
    await screen.findByRole('dialog', { name: '删除这张需求卡？' })
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(api.removeCard).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('暂停中的卡：删除按钮可用（不再禁用），确认提示含「会一并中止其运行」', async () => {
    const api = installKlarit()
    seed(card({ activeRunId: 'r1' }), { r1: bp({ state: 'paused' }) })
    render(<RequirementCardDetail />)
    const delBtn = screen.getByLabelText('删除')
    expect(delBtn).not.toBeDisabled()
    await userEvent.click(delBtn)
    const dialog = await screen.findByRole('dialog', { name: '删除这张需求卡？' })
    expect(dialog).toHaveTextContent('删除会一并中止其运行')
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(api.removeCard).toHaveBeenCalledWith('add-thing', { recycleBranches: false, allowUnmerged: false })
  })

  it('进行中的卡：删除按钮同样可用', async () => {
    installKlarit()
    seed(card({ activeRunId: 'r1' }), { r1: bp({ state: 'running' }) })
    render(<RequirementCardDetail />)
    expect(screen.getByLabelText('删除')).not.toBeDisabled()
  })

  it('运行已终局(done)：删除可用且确认提示不含中止运行一句', async () => {
    installKlarit()
    seed(card({ activeRunId: 'r1' }), { r1: bp({ state: 'done' }) })
    render(<RequirementCardDetail />)
    await userEvent.click(screen.getByLabelText('删除'))
    const dialog = await screen.findByRole('dialog', { name: '删除这张需求卡？' })
    expect(dialog).not.toHaveTextContent('中止其运行')
  })

  it('有分支的卡：确认框列出合并状态，勾选回收后 removeCard 带 recycleBranches', async () => {
    const api = installKlarit({
      cardBranchCleanupInfo: vi.fn(async () => [
        { memberId: 'web', name: 'web', branch: 'add-thing', worktreePath: '/wt/web', branchExists: true, worktreeExists: true, merged: false },
        { memberId: 'api', name: 'api', branch: 'add-thing', worktreePath: '/wt/api', branchExists: true, worktreeExists: true, merged: true }
      ])
    })
    seed(card({ activeRunId: 'r1' }), { r1: bp({ state: 'done' }) })
    render(<RequirementCardDetail />)
    await userEvent.click(screen.getByLabelText('删除'))
    const dialog = await screen.findByRole('dialog', { name: '删除这张需求卡？' })
    // 合并状态逐条显示
    await within(dialog).findByText('web/add-thing')
    expect(within(dialog).getByText('未合并')).toBeInTheDocument()
    expect(within(dialog).getByText('已合并')).toBeInTheDocument()
    // 勾选「一并回收」
    await userEvent.click(within(dialog).getByRole('checkbox'))
    // 含未合并分支 → 显示强删警告
    expect(dialog).toHaveTextContent('未合并提交将丢失')
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(api.removeCard).toHaveBeenCalledWith('add-thing', { recycleBranches: true, allowUnmerged: true })
  })
})
