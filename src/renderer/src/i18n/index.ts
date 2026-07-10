/**
 * i18n 运行时单例——渲染层文案的「渲染」层,消费已有的 language 偏好。
 * 类比 theme-rendering 中 data-theme 驱动令牌翻色:这里由 language 驱动文案选择。
 * 在 main.tsx 顶层 import 以确保单例先于首帧渲染就绪;切换语言用 i18n.changeLanguage()。
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE } from '@shared/language'
import { zh } from './locales/zh'
import { en } from './locales/en'

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en }
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  // 缺键时回退默认语言文案;React 已防 XSS,无需 i18next 再转义。
  interpolation: { escapeValue: false },
  returnNull: false
})

export default i18n
