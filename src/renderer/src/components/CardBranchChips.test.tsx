import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardBranch, StoredCard } from '@shared/types'
import { CardBranchChips } from './CardBranchChips'

interface KlaritStub {
  cardBranches: ReturnType<typeof vi.fn>
  focusCardGitView: ReturnType<typeof vi.fn>
}

function installKlarit(branches: CardBranch[]): KlaritStub {
  const api: KlaritStub = {
    cardBranches: vi.fn(async () => branches),
    focusCardGitView: vi.fn(async () => {})
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
  return api
}

beforeEach(() => {
  installKlarit([])
})

function card(over: Partial<StoredCard> = {}): StoredCard {
  return {
    proposedName: 'add-thing',
    title: 'Add thing',
    description: '',
    typeId: 'feat',
    relations: [],
    status: '进行中',
    createdAt: 0,
    updatedAt: 0,
    projectId: 'p1',
    repos: ['A', 'B'],
    activeRunId: 'run-1',
    ...over
  }
}

const br = (memberId: string, name: string, branch = 'feat/x'): CardBranch => ({ memberId, name, branch })

describe('CardBranchChips', () => {
  it('无 activeRunId → 不探测、不渲染', () => {
    const api = installKlarit([br('A', 'web')])
    const { container } = render(<CardBranchChips card={card({ activeRunId: undefined })} breakpoint={null} />)
    expect(api.cardBranches).not.toHaveBeenCalled()
    expect(container.firstChild).toBeNull()
  })

  it('无已建分支 → 探测后仍不渲染', async () => {
    installKlarit([])
    const { container } = render(<CardBranchChips card={card()} breakpoint={null} />)
    await waitFor(() => expect(window.klarit.cardBranches).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('多仓分支建出 → 每成员一个「成员仓名/分支名」内联条目', async () => {
    installKlarit([br('A', 'web'), br('B', 'api')])
    render(<CardBranchChips card={card()} breakpoint={null} />)
    await screen.findByText('web/feat/x')
    expect(screen.getByText('api/feat/x')).toBeInTheDocument()
  })

  it('点某成员仓条目 → focusCardGitView 传其 memberId', async () => {
    const api = installKlarit([br('A', 'web'), br('B', 'api')])
    render(<CardBranchChips card={card()} breakpoint={null} />)
    await userEvent.click(await screen.findByText('api/feat/x'))
    expect(api.focusCardGitView).toHaveBeenCalledWith('add-thing', 'B')
  })
})
