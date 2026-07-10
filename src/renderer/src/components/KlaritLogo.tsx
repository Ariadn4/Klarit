interface KlaritLogoProps {
  /** 方形边长（px） */
  size?: number
  className?: string
}

/**
 * Klarit 标记：7 条横线组成 K——每条代表一条 requirement，
 * 中间橙色那条是当前 focused 的需求。定义见 docs/brand/klarit-brand-system.html。
 */
export function KlaritLogo({ size = 24, className }: KlaritLogoProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={className}
      role="img"
      aria-label="Klarit"
    >
      <rect x="10" y="10" width="22" height="3.5" fill="var(--color-cobalt-500)" />
      <rect x="10" y="20" width="22" height="3.5" fill="var(--color-cobalt-500)" />
      <rect x="10" y="30" width="22" height="3.5" fill="var(--color-cobalt-500)" />
      <rect x="10" y="40" width="22" height="3.5" fill="var(--color-signal-500)" />
      <rect x="10" y="50" width="22" height="3.5" fill="var(--color-cobalt-500)" />
      <rect x="10" y="60" width="22" height="3.5" fill="var(--color-cobalt-500)" />
      <rect x="10" y="70" width="22" height="3.5" fill="var(--color-cobalt-500)" />
      <polygon points="35,41.75 65,10 75,10 45,41.75" fill="var(--color-cobalt-500)" />
      <polygon points="35,41.75 45,41.75 75,73.5 65,73.5" fill="var(--color-cobalt-500)" />
    </svg>
  )
}
