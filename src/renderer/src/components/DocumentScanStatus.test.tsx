import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useDocumentsStore } from '../stores/documents'
import { DocumentScanStatus } from './DocumentScanStatus'

beforeEach(() => {
  useDocumentsStore.setState({ registry: null, analyzing: false, analyzeError: null })
})

describe('DocumentScanStatus · 底栏扫描状态（只告知、不可交互）', () => {
  it('不在扫描时什么也不渲染（底栏不占位）', () => {
    const { container } = render(<DocumentScanStatus />)
    expect(container).toBeEmptyDOMElement()
  })

  it('扫描中显示状态文案，且不含任何可交互元素', () => {
    useDocumentsStore.setState({ analyzing: true })
    render(<DocumentScanStatus />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/扫描/)
    // 只告知：不承载点击/跳过等任何操作入口。
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(status.querySelector('button, a, input, select, textarea')).toBeNull()
  })

  it('扫描结束后状态消失', () => {
    useDocumentsStore.setState({ analyzing: true })
    const { rerender } = render(<DocumentScanStatus />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    useDocumentsStore.setState({ analyzing: false })
    rerender(<DocumentScanStatus />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
