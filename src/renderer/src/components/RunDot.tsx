/**
 * 运行圆点：运行状态的可视投影（呼吸蓝/紫/黄、静止红）。颜色取语义令牌、呼吸为 CSS 动画。
 * 由纯逻辑 `runDot`（lib/board.ts）算出形态，本组件只负责渲染。
 */

import type { RunDot as RunDotValue, DotColor } from '../lib/board'

const COLOR_CLASS: Record<DotColor, string> = {
  blue: 'bg-cobalt-500',
  violet: 'bg-tag-violet',
  amber: 'bg-warning',
  red: 'bg-danger'
}

export function RunDot({ dot }: { dot: RunDotValue }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${COLOR_CLASS[dot.color]} ${
        dot.shape === 'breathing' ? 'dot-breathe' : ''
      }`}
    />
  )
}
