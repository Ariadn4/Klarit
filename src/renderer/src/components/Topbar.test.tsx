import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Topbar } from './Topbar'

describe('Topbar 侧边栏开关', () => {
  it('展开态显示「折叠侧边栏」按钮', () => {
    render(<Topbar collapsed={false} onToggleSidebar={() => {}} />)
    expect(screen.getByRole('button', { name: '折叠侧边栏' })).toBeInTheDocument()
  })

  it('折叠态显示「展开侧边栏」按钮且 aria-pressed=true', () => {
    render(<Topbar collapsed={true} onToggleSidebar={() => {}} />)
    const btn = screen.getByRole('button', { name: '展开侧边栏' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('点击触发切换回调', async () => {
    const onToggle = vi.fn()
    render(<Topbar collapsed={false} onToggleSidebar={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
