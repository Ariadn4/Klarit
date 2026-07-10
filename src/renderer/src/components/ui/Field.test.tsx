import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field'

describe('Field', () => {
  it('label 13/600/ink、description 12/400/stone-600，顺序 label → description → 控件', () => {
    render(
      <Field label="外观" description="决定深浅主题的来源">
        <input data-testid="ctrl" />
      </Field>
    )
    const label = screen.getByText('外观')
    expect(label.tagName).toBe('LABEL')
    expect(label.className).toContain('text-[13px]')
    expect(label.className).toContain('font-semibold')
    expect(label.className).toContain('text-ink')

    const desc = screen.getByText('决定深浅主题的来源')
    expect(desc.className).toContain('text-[12px]')
    expect(desc.className).toContain('text-stone-600')

    const ctrl = screen.getByTestId('ctrl')
    // label 在 description 之前，description 在控件之前
    expect(label.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(desc.compareDocumentPosition(ctrl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('必填在 label 后加 *（signal 色）', () => {
    render(
      <Field label="工作流名称" required>
        <input />
      </Field>
    )
    const label = screen.getByText(/工作流名称/)
    expect(label.textContent).toContain('*')
    const star = label.querySelector('span')
    expect(star?.className).toContain('text-signal-500')
  })

  it('选填默认不标注（无 * 无「选填」）', () => {
    const { container } = render(
      <Field label="显示名">
        <input />
      </Field>
    )
    expect(container.textContent).not.toContain('*')
    expect(container.textContent).not.toContain('选填')
  })

  it('错误就近显示：消息为 danger 且 role=alert', () => {
    render(
      <Field label="校验命令" required error="命令不能为空">
        <input data-testid="ctrl" />
      </Field>
    )
    const err = screen.getByRole('alert')
    expect(err).toHaveTextContent('命令不能为空')
    expect(err.className).toContain('text-danger')
  })

  it('htmlFor 关联控件，点 label 聚焦控件', () => {
    render(
      <Field label="语言" htmlFor="lang">
        <input id="lang" />
      </Field>
    )
    expect(screen.getByText('语言').getAttribute('for')).toBe('lang')
  })
})
