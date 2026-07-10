import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import i18n from './src/renderer/src/i18n'

afterEach(async () => {
  cleanup()
  // 复位到默认语言,避免某个改了语言的测试影响后续按中文断言的测试。
  await i18n.changeLanguage('zh')
})
