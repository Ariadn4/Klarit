import { describe, it, expect } from 'vitest'
import { buildManualGateDecision, buildRollbackConfirmDecision } from './decisions'

describe('buildManualGateDecision — 开放驳回入口', () => {
  it('仅「通过」选项 + 驳回自由输入框（框即驳回入口，不另设驳回按钮）', () => {
    const d = buildManualGateDecision('n', '评审')
    expect(d.source).toBe('n:manual-gate')
    expect(d.options.map((o) => o.id)).toEqual(['pass'])
    expect(d.options.find((o) => o.id === 'pass')?.recommended).toBe(true)
    expect(d.input?.labelKey).toBe('engineDecision.rejectReason')
  })

  it('仍透传动作按钮与可打开产出', () => {
    const d = buildManualGateDecision('n', '评审', [{ label: '启动 app', index: 0 }], [{ name: 'PLAN.md', path: '/abs/PLAN.md' }])
    expect(d.actions).toEqual([{ label: '启动 app', index: 0 }])
    expect(d.outputs).toEqual([{ name: 'PLAN.md', path: '/abs/PLAN.md' }])
  })
})

describe('buildRollbackConfirmDecision — 主选+备选节点', () => {
  it('候选节点渲染为 options（id=节点 id、label=名、detail=理由），主选标推荐', () => {
    const d = buildRollbackConfirmDecision(
      'gate',
      '根因在架构',
      [
        { nodeId: 'arch', nodeName: '架构设计', reason: '数据模型在此定型', recommended: true },
        { nodeId: 'plan', nodeName: '详细规划', reason: '更靠前' }
      ],
      '数据模型不对'
    )
    expect(d.source).toBe('gate:rollback-confirm')
    const arch = d.options.find((o) => o.id === 'arch')
    expect(arch?.label).toBe('架构设计')
    expect(arch?.detail).toBe('数据模型在此定型')
    expect(arch?.recommended).toBe(true)
    // 末尾附「取消回退」选项
    expect(d.options[d.options.length - 1].id).toBe('cancel-rollback')
    // 保留自由输入（重唤判定）
    expect(d.input?.labelKey).toBe('engineDecision.rollbackRejudge')
    // raw 暂存驳回意见（供确认后注入，非渲染）
    expect(d.raw).toBe('数据模型不对')
    expect(d.reason).toBe('根因在架构')
  })
})
