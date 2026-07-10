import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RulePack, RulePackValidation } from '@shared/rule-pack'
import { RuleLibrary } from './RuleLibrary'

function pack(over: Partial<RulePack> = {}): RulePack {
  return {
    id: 'rp1',
    name: { zh: '默认包', en: 'Default pack' },
    items: [{ kind: 'constitution-rule', id: 'r1', name: { zh: '测试先行', en: 'Test-First' }, text: { zh: '先写测试', en: 'tests first' } }],
    ...over
  }
}

let saveResult: RulePackValidation
let saved: RulePack | null

function install(over: Record<string, unknown> = {}): void {
  saved = null
  const api = {
    listRulePacks: vi.fn(async () => [{ id: 'rp1', name: { zh: '默认包', en: 'Default pack' } }]),
    getRulePack: vi.fn(async () => pack()),
    createRulePack: vi.fn(async () => pack()),
    cloneRulePack: vi.fn(async () => pack()),
    saveRulePack: vi.fn(async (p: RulePack) => {
      saved = p
      return saveResult
    }),
    deleteRulePack: vi.fn(async () => []),
    importRulePack: vi.fn(async () => ({ ok: true })),
    exportRulePack: vi.fn(async () => {}),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
}

beforeEach(() => {
  saveResult = { ok: true }
  install()
})

describe('RuleLibrary', () => {
  it('列出规则包（按当前语言解析名）；新建调用 createRulePack', async () => {
    render(<RuleLibrary />)
    expect(await screen.findByText('默认包')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '新建' }))
    expect(window.klarit.createRulePack).toHaveBeenCalled()
  })

  it('编辑：三类分区展示，加客观门校验条目落到对应分区（命令单框、名称单框），保存调用 saveRulePack', async () => {
    render(<RuleLibrary />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑 默认包' }))
    // 折叠摘要按当前语言（zh）显示只读名称
    expect(await screen.findByText('测试先行')).toBeInTheDocument()
    expect(screen.queryByLabelText('客观门校验命令 1')).not.toBeInTheDocument()
    // 加一条客观门校验 → 名称/命令各一个输入框（单栏，随所选语言）
    await userEvent.click(screen.getByRole('button', { name: '加客观门校验' }))
    expect(screen.getByLabelText('客观门校验名称 1')).toBeInTheDocument()
    expect(screen.getByLabelText('客观门校验命令 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(window.klarit.saveRulePack).toHaveBeenCalled()
  })

  it('顶栏语言下拉切换编辑语言，字段值随之切换（单栏、不并排）', async () => {
    render(<RuleLibrary />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑 默认包' }))
    const nameInput = (await screen.findByLabelText('规则包名')) as HTMLInputElement
    // 默认按界面语言 zh 编辑 → 显示中文包名
    expect(nameInput.value).toBe('默认包')
    // 切到 English → 同一个输入框显示英文值（不是新增一栏）
    await userEvent.selectOptions(screen.getByLabelText('选择要编辑的语言'), 'English')
    expect((screen.getByLabelText('规则包名') as HTMLInputElement).value).toBe('Default pack')
  })

  it('某语言留空 → 保存时不写入该语言键（不写空串）', async () => {
    install({ getRulePack: vi.fn(async () => pack({ items: [] })) })
    render(<RuleLibrary />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑 默认包' }))
    await userEvent.click(await screen.findByRole('button', { name: '加宪法规则' }))
    // 切到 English，只填英文名称与正文，中文留空
    await userEvent.selectOptions(screen.getByLabelText('选择要编辑的语言'), 'English')
    await userEvent.type(screen.getByLabelText('宪法规则名称 1'), 'Only EN')
    await userEvent.type(screen.getByLabelText('宪法规则内容 1'), 'body en')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(saved).not.toBeNull())
    const rule = saved!.items[0]
    expect(rule.kind === 'constitution-rule' && rule.name).toEqual({ en: 'Only EN' })
    expect(rule.kind === 'constitution-rule' && rule.text).toEqual({ en: 'body en' })
  })

  it('保存非法返回原因时提示', async () => {
    saveResult = { ok: false, reason: '条目内容为空' }
    render(<RuleLibrary />)
    await userEvent.click(await screen.findByRole('button', { name: '编辑 默认包' }))
    await screen.findByText('测试先行')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
