import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardBranch, StoredCard } from '@shared/types'
import { RequirementCardView } from './RequirementCardView'

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

function renderCard(c: StoredCard) {
  return render(<RequirementCardView card={c} cardTypes={[]} breakpoint={null} workflow={null} />)
}

const br = (memberId: string, name: string, branch = 'feat/x'): CardBranch => ({ memberId, name, branch })

describe('RequirementCardView 逐成员仓已建分支条目', () => {
  it('分支未建出时不展示条目', async () => {
    installKlarit([])
    renderCard(card())
    await waitFor(() => expect(window.klarit.cardBranches).toHaveBeenCalled())
    expect(screen.queryByText('web/feat/x')).toBeNull()
  })

  it('无 activeRunId 时不探测、不展示', async () => {
    const api = installKlarit([br('A', 'web')])
    renderCard(card({ activeRunId: undefined }))
    expect(api.cardBranches).not.toHaveBeenCalled()
    expect(screen.queryByText('web/feat/x')).toBeNull()
  })

  it('多仓分支建出 → 每成员一个「成员仓名/分支名」内联条目', async () => {
    installKlarit([br('A', 'web'), br('B', 'api')])
    renderCard(card())
    await screen.findByText('web/feat/x')
    expect(screen.getByText('api/feat/x')).toBeInTheDocument()
  })

  it('点某成员仓条目 → 聚焦到该成员仓（传其 memberId，而非首仓）', async () => {
    const api = installKlarit([br('A', 'web'), br('B', 'api')])
    renderCard(card())
    await userEvent.click(await screen.findByText('api/feat/x'))
    expect(api.focusCardGitView).toHaveBeenCalledWith('add-thing', 'B')
  })

  it('某成员仓分支被删（cardBranches 不再返回它）→ 其条目消失', async () => {
    installKlarit([br('A', 'web')]) // B 的分支已删，只剩 A
    renderCard(card())
    await screen.findByText('web/feat/x')
    expect(screen.queryByText('api/feat/x')).toBeNull()
  })

  it('单仓退化 → 只展示一个条目', async () => {
    installKlarit([br('A', 'web')])
    renderCard(card({ repos: ['A'] }))
    await screen.findByText('web/feat/x')
    expect(screen.queryByText('api/feat/x')).toBeNull()
  })
})
