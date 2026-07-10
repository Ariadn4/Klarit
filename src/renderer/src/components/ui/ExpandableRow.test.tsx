import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExpandableRow, useSingleOpen } from './ExpandableRow'

function Harness(): React.JSX.Element {
  const acc = useSingleOpen()
  return (
    <>
      <ExpandableRow open={acc.isOpen('a')} onToggle={() => acc.toggle('a')} summaryLabel="节点 建分支" title="建分支">
        <div>详情A</div>
      </ExpandableRow>
      <ExpandableRow open={acc.isOpen('b')} onToggle={() => acc.toggle('b')} summaryLabel="节点 写代码" title="写代码">
        <div>详情B</div>
      </ExpandableRow>
      <button onClick={acc.close}>外部收起</button>
    </>
  )
}

describe('ExpandableRow', () => {
  it('收起时不显示详情，点摘要展开', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByText('详情A')).toBeNull()
    await user.click(screen.getByRole('button', { name: '节点 建分支' }))
    expect(screen.getByText('详情A')).toBeInTheDocument()
  })

  it('手风琴：同列表最多展开一行', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '节点 建分支' }))
    expect(screen.getByText('详情A')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '节点 写代码' }))
    expect(screen.getByText('详情B')).toBeInTheDocument()
    expect(screen.queryByText('详情A')).toBeNull()
  })

  it('close() 收起（拖拽前收起场景）', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '节点 写代码' }))
    expect(screen.getByText('详情B')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '外部收起' }))
    expect(screen.queryByText('详情B')).toBeNull()
  })

  it('展开时 chevron 旋转、详情缩进且字段间留间距', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '节点 建分支' }))
    const detail = screen.getByText('详情A').parentElement!
    expect(detail.className).toContain('pl-7')
    expect(detail.className).toContain('space-y-4')
    const toggle = screen.getByRole('button', { name: '节点 建分支' })
    expect(toggle.querySelector('.rotate-90')).not.toBeNull()
  })

  it('整块（摘要+详情）共用 hover 底色、底线在外层', async () => {
    render(<Harness />)
    const toggle = screen.getByRole('button', { name: '节点 建分支' })
    const outer = toggle.parentElement!.parentElement!
    expect(outer.className).toContain('hover:bg-stone-100/45')
    expect(outer.className).toContain('border-b')
  })
})
