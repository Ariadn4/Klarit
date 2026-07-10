import { describe, it, expect } from 'vitest'
import { resolveFreeBranch, memberWorktreePath, nextSuffixed, type BranchProbe } from './branch-naming'

const NONE: BranchProbe = { branchExists: () => false, pathExists: () => false }
const A = { repoPath: '/w/a' }
const B = { repoPath: '/w/b' }

describe('nextSuffixed', () => {
  it('无尾号 → -2；有尾号 → +1', () => {
    expect(nextSuffixed('x')).toBe('x-2')
    expect(nextSuffixed('x-2')).toBe('x-3')
    expect(nextSuffixed('feat/add-thing')).toBe('feat/add-thing-2')
  })
})

describe('resolveFreeBranch — 统一递增避撞', () => {
  it('单仓、分支不存在且 worktree 路径空闲 → 返回原名', () => {
    expect(resolveFreeBranch('x', [A], NONE)).toBe('x')
  })

  it('单仓、分支已存在 → x-2', () => {
    const probe: BranchProbe = { branchExists: (_r, b) => b === 'x', pathExists: () => false }
    expect(resolveFreeBranch('x', [A], probe)).toBe('x-2')
  })

  it('单仓、分支不存在但派生 worktree 路径已占用 → x-2（两维都判）', () => {
    const takenPath = memberWorktreePath('/w/a', 'x')
    const probe: BranchProbe = { branchExists: () => false, pathExists: (p) => p === takenPath }
    expect(resolveFreeBranch('x', [A], probe)).toBe('x-2')
  })

  it('多仓、任一仓撞名 → 全仓统一取同一下一档（未真撞的仓也随之改名）', () => {
    const probe: BranchProbe = {
      branchExists: (r, b) => r === '/w/b' && b === 'x',
      pathExists: () => false
    }
    expect(resolveFreeBranch('x', [A, B], probe)).toBe('x-2')
  })

  it('多仓、x 与 x-2 各在不同仓撞名 → 逐档全仓复检、递增到 x-3', () => {
    const probe: BranchProbe = {
      branchExists: (r, b) => (r === '/w/b' && b === 'x') || (r === '/w/a' && b === 'x-2'),
      pathExists: () => false
    }
    expect(resolveFreeBranch('x', [A, B], probe)).toBe('x-3')
  })

  it('冲突可跨两维：某仓分支占 x、另一仓路径占 x-2 → x-3', () => {
    const p2 = memberWorktreePath('/w/b', 'x-2')
    const probe: BranchProbe = {
      branchExists: (r, b) => r === '/w/a' && b === 'x',
      pathExists: (p) => p === p2
    }
    expect(resolveFreeBranch('x', [A, B], probe)).toBe('x-3')
  })
})
