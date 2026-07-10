import { describe, it, expect } from 'vitest'
import { buildContinuationDelta } from './continuation'

describe('buildContinuationDelta — 修复前向注入段', () => {
  it('带 forwardFix → 告知已推进到最远节点 + 驳回意见 + 前向修复', () => {
    const d = buildContinuationDelta({ forwardFix: { furthestNode: '验收', feedback: 'UI 体验不对' } })
    expect(d).toContain('验收')
    expect(d).toContain('UI 体验不对')
    expect(d).toContain('前向修复')
    expect(d).toContain('别重置')
  })

  it('forwardFix 无最远节点 → 退化为不提最远节点，仍注入意见与前向修复', () => {
    const d = buildContinuationDelta({ forwardFix: { feedback: '换个实现方法' } })
    expect(d).toContain('换个实现方法')
    expect(d).toContain('前向修复')
  })

  it('无 forwardFix → 不含前向修复段（与既有失败/决策注入并列，互不影响）', () => {
    const d = buildContinuationDelta({ failure: '门没过' })
    expect(d).not.toContain('前向修复')
    expect(d).toContain('门没过')
  })
})
