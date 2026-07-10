import { describe, it, expect } from 'vitest'
import type { MemberDerived } from '../shared/types'
import { cardBranchesView } from './card-branches'

const md = (memberId: string, branch: string, repoPath: string): MemberDerived => ({
  memberId,
  repoPath,
  branch,
  worktreePath: `${repoPath}--wt--${branch}`,
  baseBranch: 'main'
})

const nameOf = (id: string): string => ({ A: 'web', B: 'api' })[id] ?? id

describe('cardBranchesView', () => {
  it('分支已建出的成员各映射一条:memberId/name/branch', () => {
    const members = { A: md('A', 'feat/x', '/r/web'), B: md('B', 'feat/x', '/r/api') }
    const built = new Set(['/r/web|feat/x', '/r/api|feat/x'])
    const branchExists = (repoPath: string, branch: string): boolean => built.has(`${repoPath}|${branch}`)
    expect(cardBranchesView(members, nameOf, branchExists)).toEqual([
      { memberId: 'A', name: 'web', branch: 'feat/x' },
      { memberId: 'B', name: 'api', branch: 'feat/x' }
    ])
  })

  it('分支未建出的成员不出现(门控=分支存在,非 worktree)', () => {
    const members = { A: md('A', 'feat/x', '/r/web'), B: md('B', 'feat/x', '/r/api') }
    // 只有 web 建了分支,api 还没
    const branchExists = (repoPath: string): boolean => repoPath === '/r/web'
    expect(cardBranchesView(members, nameOf, branchExists)).toEqual([
      { memberId: 'A', name: 'web', branch: 'feat/x' }
    ])
  })

  it('name 解析不到成员时回落 memberId', () => {
    const members = { Z: md('Z', 'feat/x', '/r/z') }
    expect(cardBranchesView(members, nameOf, () => true)[0].name).toBe('Z')
  })

  it('空成员 → 空数组', () => {
    expect(cardBranchesView({}, nameOf, () => true)).toEqual([])
  })
})
