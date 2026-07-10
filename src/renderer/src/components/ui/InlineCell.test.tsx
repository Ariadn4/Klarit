import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineCell } from './InlineCell'

/** 受控包装：提交后由父更新 value，验证写回只读文本。 */
function Controlled({ onCommit }: { onCommit: (v: string) => void }): React.JSX.Element {
  const [v, setV] = useState('准备')
  return (
    <InlineCell
      value={v}
      ariaLabel="阶段名称"
      onCommit={(nv) => {
        setV(nv)
        onCommit(nv)
      }}
    />
  )
}

describe('InlineCell', () => {
  it('默认只读：显示文本、无输入框，只读块是带 aria-label 的 button', () => {
    render(<InlineCell value="准备" ariaLabel="阶段名称" onCommit={vi.fn()} />)
    expect(screen.getByText('准备')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: '阶段名称' })).toBeInTheDocument()
  })

  it('点击进入编辑并聚焦输入', async () => {
    const user = userEvent.setup()
    render(<InlineCell value="准备" ariaLabel="阶段名称" onCommit={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '阶段名称' }))
    const input = screen.getByRole('textbox')
    expect(input).toHaveFocus()
  })

  it('键盘 Enter / Space 进入编辑', async () => {
    const user = userEvent.setup()
    render(<InlineCell value="准备" ariaLabel="阶段名称" onCommit={vi.fn()} />)
    screen.getByRole('button', { name: '阶段名称' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('失焦提交并写回只读文本（受控）', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Controlled onCommit={onCommit} />)
    await user.click(screen.getByRole('button', { name: '阶段名称' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '实现A')
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('实现A')
    expect(screen.getByText('实现A')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('回车提交', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<InlineCell value="准备" ariaLabel="阶段名称" onCommit={onCommit} />)
    await user.click(screen.getByRole('button', { name: '阶段名称' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '交付X{Enter}')
    expect(onCommit).toHaveBeenCalledWith('交付X')
  })

  it('Esc 取消：不提交、恢复只读原值', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<InlineCell value="准备" ariaLabel="阶段名称" onCommit={onCommit} />)
    await user.click(screen.getByRole('button', { name: '阶段名称' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '乱改{Escape}')
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByText('准备')).toBeInTheDocument()
  })

  it('select 变体：只读显示 display，编辑选项后提交 value', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(
      <InlineCell
        variant="select"
        value="leaf"
        display="子叶"
        ariaLabel="类型"
        options={[
          { value: 'leaf', label: '子叶' },
          { value: 'container', label: '容器' }
        ]}
        onCommit={onCommit}
      />
    )
    expect(screen.getByText('子叶')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '类型' }))
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'container')
    fireEvent.blur(select)
    expect(onCommit).toHaveBeenCalledWith('container')
  })
})
