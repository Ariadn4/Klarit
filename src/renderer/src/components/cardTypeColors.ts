import type { CardColorKey } from '@shared/types'

/**
 * 类型徽章颜色 → Tailwind 类。住在渲染层(而非 shared)——Tailwind v4 只扫描 renderer 源，
 * 类字符串放 shared 不会被生成 CSS。装饰性分类色、与品牌/语义色分离(见 index.css `--color-tag-*`)。
 * 彩色背景配文字：多数白字，过亮的黄/青蓝配深字(tag-ink，固定不翻)。自成一体，深浅主题通用。
 */

/** 徽章整体类（彩色背景 + 文字）。 */
export const CARD_TYPE_BADGE: Record<CardColorKey, string> = {
  red: 'bg-tag-red text-white',
  amber: 'bg-tag-amber text-white',
  yellow: 'bg-tag-yellow text-white',
  green: 'bg-tag-green text-white',
  cyan: 'bg-tag-cyan text-white',
  blue: 'bg-tag-blue text-white',
  violet: 'bg-tag-violet text-white',
  pink: 'bg-tag-pink text-white'
}

/** 选色圆点背景类（饱和彩色，无需描边）。 */
export const CARD_TYPE_DOT: Record<CardColorKey, string> = {
  red: 'bg-tag-red',
  amber: 'bg-tag-amber',
  yellow: 'bg-tag-yellow',
  green: 'bg-tag-green',
  cyan: 'bg-tag-cyan',
  blue: 'bg-tag-blue',
  violet: 'bg-tag-violet',
  pink: 'bg-tag-pink'
}

const FALLBACK: CardColorKey = 'violet'

/** 取徽章类（背景+文字）：有 color 用之，否则（含旧数据未知色）回落默认色。 */
export function cardBadgeClass(color: CardColorKey | undefined): string {
  return (color && CARD_TYPE_BADGE[color]) || CARD_TYPE_BADGE[FALLBACK]
}

/** 取选色圆点背景类：有 color 用之，否则回落默认色。 */
export function cardDotClass(color: CardColorKey | undefined): string {
  return (color && CARD_TYPE_DOT[color]) || CARD_TYPE_DOT[FALLBACK]
}
