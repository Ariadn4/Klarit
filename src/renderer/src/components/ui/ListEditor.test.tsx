import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListEditor, ListRow } from './ListEditor'

describe('ListEditor', () => {
  it('头显示标题与描述', () => {
    render(<ListEditor title="阶段" description="顺序即列序" count={3} />)
    expect(screen.getByText('阶段')).toBeInTheDocument()
    expect(screen.getByText('顺序即列序')).toBeInTheDocument()
  })

  it('计数仅 >0 显示', () => {
    const { rerender } = render(<ListEditor title="可写范围" count={0} />)
    expect(screen.queryByTestId('list-count')).toBeNull()
    rerender(<ListEditor title="可写范围" count={2} />)
    expect(screen.getByTestId('list-count')).toHaveTextContent('2')
  })

  it('「加」是末行小按钮、左对齐', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<ListEditor title="阶段" count={0} addLabel="加阶段" onAdd={onAdd} />)
    const add = screen.getByRole('button', { name: '加阶段' })
    expect(add.className).toContain('self-start')
    await user.click(add)
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('空列表 = 头 + 加末行，无数据行', () => {
    render(<ListEditor title="门" count={0} addLabel="加门" onAdd={vi.fn()} />)
    expect(screen.getByText('门')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加门' })).toBeInTheDocument()
    expect(screen.queryByTestId('list-count')).toBeNull()
  })

  it('行间用发丝线分隔（border-stone-100）', () => {
    render(
      <ListEditor title="阶段" count={2}>
        <ListRow ordinal={1}>
          <span>准备</span>
        </ListRow>
        <ListRow ordinal={2}>
          <span>实现</span>
        </ListRow>
      </ListEditor>
    )
    const row = screen.getByText('准备').closest('div')!
    expect(row.className).toContain('border-b')
    expect(row.className).toContain('border-stone-100')
  })

  it('二级标题更小、头无底线', () => {
    const { container } = render(<ListEditor title="可写范围" count={1} level={2} />)
    const title = screen.getByText('可写范围')
    expect(title.className).toContain('text-[12px]')
    // 头容器不含一级的 stone-300 底线
    const head = container.querySelector('.border-stone-300')
    expect(head).toBeNull()
  })
})
