import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardTypeDef, CardValidation } from '@shared/types'
import { CardTypeLibrary } from './CardTypeLibrary'

let types: CardTypeDef[]
let saveResult: CardValidation
let deleteResult: CardValidation
let saveCardType: ReturnType<typeof vi.fn>
let deleteCardType: ReturnType<typeof vi.fn>

function install(over: Record<string, unknown> = {}): void {
  saveCardType = vi.fn(async (def: CardTypeDef) => {
    if (saveResult.ok) types = [...types.filter((t) => t.id !== def.id), def]
    return saveResult
  })
  deleteCardType = vi.fn(async (id: string) => {
    if (deleteResult.ok) types = types.filter((t) => t.id !== id)
    return deleteResult
  })
  const api = {
    listCardTypes: vi.fn(async () => types),
    saveCardType,
    deleteCardType,
    readGeneratedDecomposeSkill: vi.fn(async () => `可用类型\n- feature\n- ${types.map((t) => t.id).join('/')}`),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
}

beforeEach(() => {
  types = [
    { id: 'epic', name: 'Epic', description: '大目标', archetype: 'container' },
    { id: 'feature', name: 'Feature', description: '功能', archetype: 'leaf' }
  ]
  saveResult = { ok: true }
  deleteResult = { ok: true }
  install()
})

describe('CardTypeLibrary', () => {
  it('列出在册类型（含原型徽章）', async () => {
    render(<CardTypeLibrary />)
    expect(await screen.findByText('Epic')).toBeInTheDocument()
    expect(screen.getByText('Feature')).toBeInTheDocument()
  })

  it('新增类型：填名称/原型/描述并保存 → 调 saveCardType', async () => {
    render(<CardTypeLibrary />)
    await screen.findByText('Epic')
    await userEvent.click(screen.getByRole('button', { name: '新建' }))
    await userEvent.type(screen.getByLabelText('类型名称'), '探路')
    await userEvent.type(screen.getByLabelText('类型描述'), '不确定性高先探路')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(saveCardType).toHaveBeenCalled())
    const arg = saveCardType.mock.calls[0][0]
    expect(arg.name).toBe('探路')
    expect(arg.archetype).toBe('leaf')
    expect(arg.id).toBeTruthy() // 由名称派生 id
  })

  it('删除被引用类型 → 显示可读原因、不消失', async () => {
    deleteResult = { ok: false, reason: '类型「feature」仍被需求卡引用' }
    render(<CardTypeLibrary />)
    await screen.findByText('Feature')
    await userEvent.click(screen.getByRole('button', { name: '删除 Feature' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('仍被需求卡引用')
    expect(screen.getByText('Feature')).toBeInTheDocument()
  })

  it('预览：点头部按钮进入子页面显示自动生成的分解 skill，可返回', async () => {
    render(<CardTypeLibrary />)
    await screen.findByText('Epic')
    await userEvent.click(screen.getByRole('button', { name: '预览分解 skill' }))
    expect(await screen.findByLabelText('自动生成的分解 skill 文本')).toHaveTextContent('可用类型')
    expect(window.klarit.readGeneratedDecomposeSkill).toHaveBeenCalled()
    // 子页面：列表不再可见；返回后恢复
    expect(screen.queryByText('Epic')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '返回类型列表' }))
    expect(await screen.findByText('Epic')).toBeInTheDocument()
  })

  it('新增类型可选徽章颜色（专门的选色器）：保存带 color', async () => {
    render(<CardTypeLibrary />)
    await screen.findByText('Epic')
    await userEvent.click(screen.getByRole('button', { name: '新建' }))
    await userEvent.type(screen.getByLabelText('类型名称'), '杂务')
    // 打开选色器 → 选 amber（深色档）
    await userEvent.click(screen.getByRole('button', { name: '标签颜色' }))
    await userEvent.click(screen.getByRole('option', { name: '颜色 amber' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(saveCardType).toHaveBeenCalled())
    expect(saveCardType.mock.calls[0][0].color).toBe('amber')
  })
})
