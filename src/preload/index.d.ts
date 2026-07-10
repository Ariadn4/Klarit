import type { KlaritApi } from '../shared/types'

declare global {
  interface Window {
    klarit: KlaritApi
  }
}

export {}
