import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@shared/types'
import { ProjectSwitcher } from './ProjectSwitcher'

function entry(over: Partial<Project>): Project {
  return {
    id: 'id',
    displayName: 'name',
    derivedName: 'name',
    members: [],
    createdAt: '',
    updatedAt: '',
    ...over
  }
}

const A = entry({ id: 'a', displayName: '反刍' })
const B = entry({ id: 'b', displayName: 'klarit' })

describe('ProjectSwitcher', () => {
  it('无任何项目时显示「导入新项目」', async () => {
    const onImport = vi.fn()
    render(<ProjectSwitcher current={null} projects={[]} onSelect={() => {}} onImport={onImport} />)
    const btn = screen.getByRole('button', { name: /导入新项目/ })
    await userEvent.click(btn)
    expect(onImport).toHaveBeenCalledOnce()
  })

  it('有项目时显示当前项目名', () => {
    render(<ProjectSwitcher current={A} projects={[A, B]} onSelect={() => {}} onImport={() => {}} />)
    expect(screen.getByRole('button', { name: /反刍/ })).toBeInTheDocument()
  })

  it('点击弹出子菜单，列出全部项目、当前项勾选、含「管理项目…」', async () => {
    render(<ProjectSwitcher current={A} projects={[A, B]} onSelect={() => {}} onImport={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /反刍/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    const items = screen.getAllByRole('menuitemradio')
    expect(items).toHaveLength(2)
    const currentItem = screen.getByRole('menuitemradio', { name: /反刍/ })
    expect(currentItem).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /klarit/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByRole('menuitem', { name: /管理项目/ })).toBeInTheDocument()
  })

  it('点击「管理项目…」触发 onManage', async () => {
    const onManage = vi.fn()
    render(
      <ProjectSwitcher
        current={A}
        projects={[A, B]}
        onSelect={() => {}}
        onImport={() => {}}
        onManage={onManage}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /反刍/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /管理项目/ }))
    expect(onManage).toHaveBeenCalledOnce()
  })

  it('选择某项目触发 onSelect', async () => {
    const onSelect = vi.fn()
    render(<ProjectSwitcher current={A} projects={[A, B]} onSelect={onSelect} onImport={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /反刍/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /klarit/ }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })
})
