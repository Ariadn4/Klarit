import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { BoardColumn as BoardColumnModel } from '../lib/board'
import { BoardColumn } from './BoardColumn'

const TODO: BoardColumnModel = { key: '__todo__', title: '待办', kind: 'todo' }
const STAGE: BoardColumnModel = { key: 's1', title: '开发', kind: 'stage' }

describe('BoardColumn', () => {
  it('渲染列头列名', () => {
    render(<BoardColumn column={STAGE} />)
    expect(screen.getByRole('heading', { name: '开发' })).toBeInTheDocument()
  })

  it('列体底部渲染传入的 createSlot（如「待办」列的新建入口）', () => {
    render(<BoardColumn column={TODO} createSlot={<button>创建入口</button>} />)
    expect(screen.getByRole('button', { name: '创建入口' })).toBeInTheDocument()
  })

  it('未传 createSlot 时列体为空容器（无注入节点）', () => {
    render(<BoardColumn column={STAGE} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
