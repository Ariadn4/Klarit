import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ConstitutionGovernance, RulePack } from '@shared/rule-pack'
import { ConstitutionSettings } from './ConstitutionSettings'

const PACKS: RulePack[] = [
  {
    id: 'rp1',
    name: { zh: '默认包', en: 'Default pack' },
    items: [
      { kind: 'constitution-rule', id: 'test-first', name: { zh: '测试先行', en: 'Test-First' }, text: { zh: '先写测试', en: 'tests first' } },
      { kind: 'constitution-rule', id: 'decoupling', name: { zh: '解耦', en: 'Decoupling' }, text: { zh: '低耦合', en: 'loose' } },
      { kind: 'output-template', id: 'tpl', name: { zh: '模板', en: 'Template' }, content: { zh: '## x', en: '## x' } }
    ]
  }
]

let gov: ConstitutionGovernance

function install(): void {
  const setConstitution = vi.fn(async (g: ConstitutionGovernance) => {
    gov = g
  })
  const api = {
    allRulePacks: vi.fn(async () => PACKS),
    getConstitution: vi.fn(async () => gov),
    setConstitution,
    effectiveConstitution: vi.fn(async () =>
      gov.activePackIds.includes('rp1')
        ? PACKS[0].items
            .filter((i) => i.kind === 'constitution-rule')
            .filter((i) => !gov.disabledRules.some((d) => d.itemId === i.id))
            .map((i) => ({ packId: 'rp1', itemId: i.id, name: i.name.zh ?? '', text: '' }))
        : []
    )
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
}

beforeEach(() => {
  gov = { activePackIds: [], disabledRules: [] }
  install()
})

describe('ConstitutionSettings', () => {
  it('激活包后展示其宪法规则开关，且只列 constitution-rule', async () => {
    render(<ConstitutionSettings />)
    await userEvent.click(await screen.findByLabelText('激活规则包 默认包'))
    expect(window.klarit.setConstitution).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText('规则开关 测试先行')).toBeInTheDocument())
    expect(screen.getByLabelText('规则开关 解耦')).toBeInTheDocument()
    // output-template 不作为宪法规则出现
    expect(screen.queryByLabelText('规则开关 模板')).not.toBeInTheDocument()
  })

  it('关掉某条规则写入 disabledRules', async () => {
    gov = { activePackIds: ['rp1'], disabledRules: [] }
    render(<ConstitutionSettings />)
    const toggle = await screen.findByLabelText('规则开关 测试先行')
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await waitFor(() =>
      expect(window.klarit.setConstitution).toHaveBeenCalledWith(
        expect.objectContaining({ disabledRules: [{ packId: 'rp1', itemId: 'test-first' }] })
      )
    )
  })
})
