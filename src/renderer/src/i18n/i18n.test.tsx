import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import i18n from './index'

function Probe(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div>
      <span>{t('common.cancel')}</span>
      <span>{t('common.confirm')}</span>
    </div>
  )
}

describe('i18n 切换渲染', () => {
  it('切到 en 后界面文案变英文，且不渲染裸键名', async () => {
    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    render(<Probe />)
    expect(screen.getByText('取消')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    // 任何语言都不应出现裸键名
    expect(screen.queryByText('common.cancel')).toBeNull()
  })

  it('缺失键回退到默认语言（zh）而非渲染裸键名', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    // 用一个仅在 zh 存在、en 缺失的临时键验证回退
    i18n.addResource('zh', 'translation', '__test.fallbackOnly', '仅中文')
    expect(i18n.t('__test.fallbackOnly')).toBe('仅中文')
    // 完全不存在的键不返回点分裸键之外的内容（i18next 默认返回 key，本测试确保我们配置了 fallback）
    expect(i18n.t('common.confirm')).toBe('Confirm')
  })
})
