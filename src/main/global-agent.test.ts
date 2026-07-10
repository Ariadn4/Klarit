import { describe, it, expect, vi } from 'vitest'
import type { CandidateCard } from '../shared/types'
import { createDecomposeSeam } from './global-agent'
import type { ResolveDeps } from './decompose-service'
import { DEFAULT_CARD_TYPES } from '../shared/card-type'

function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    getActiveWorkflowId: () => null,
    getWorkflow: () => null,
    readWorkflowSkill: () => null,
    getTypes: () => [...DEFAULT_CARD_TYPES],
    readOverride: () => '【全局覆盖分解 skill】',
    ...over
  }
}

const card = (over: Partial<CandidateCard> = {}): CandidateCard => ({
  proposedName: 'add-dark-mode',
  title: '增加暗色模式',
  description: '给界面加暗色主题',
  typeId: 'feature',
  relations: [],
  ...over
})

describe('createDecomposeSeam', () => {
  it('未绑定项目：decompose 给空态、不调 producer、不报错', async () => {
    const produce = vi.fn(async () => [card()])
    const seam = createDecomposeSeam(deps(), produce)
    expect(await seam.decompose({ description: 'x' }, null)).toEqual({ unbound: true })
    expect(produce).not.toHaveBeenCalled()
  })

  it('已绑定项目：decompose 走解析→producer→候选', async () => {
    const produce = vi.fn(async () => [card()])
    const seam = createDecomposeSeam(deps(), produce)
    const res = await seam.decompose({ description: 'x' }, 'proj-1')
    expect('candidates' in res && res.candidates[0].proposedName).toBe('add-dark-mode')
    expect(produce).toHaveBeenCalled()
  })

  it('resolvePrompt：未绑定空态、已绑定返回生效 prompt', async () => {
    const seam = createDecomposeSeam(deps(), async () => [])
    expect(seam.resolvePrompt(null)).toEqual({ unbound: true })
    expect(seam.resolvePrompt('proj-1')).toEqual({ prompt: '【全局覆盖分解 skill】' })
  })

  it('submit（外部 AI 路径）：未绑定空态；已绑定规整+校验后返回，不旁路校验', async () => {
    const seam = createDecomposeSeam(deps(), async () => [])
    expect(await seam.submit([card()], null)).toEqual({ unbound: true })

    const ok = await seam.submit([card(), card({ title: 'B' })], 'proj-1')
    expect('candidates' in ok && ok.candidates.map((c) => c.proposedName)).toEqual([
      'add-dark-mode',
      'add-dark-mode-2'
    ])

    const bad = await seam.submit([card({ title: '' })], 'proj-1')
    expect('issues' in bad && bad.issues.length).toBeGreaterThan(0)
  })
})
