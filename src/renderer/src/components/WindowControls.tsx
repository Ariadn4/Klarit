import { Minus, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * 自绘窗口控制按钮（最小化/最大化/关闭）。替代原生 titleBarOverlay——
 * 原生按钮是 OS 合成在网页之上的，DOM 蒙层无法覆盖；改为自绘后设置面板等浮层才能完全盖住。
 */
export function WindowControls(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div style={NO_DRAG} className="flex items-center">
      <button
        type="button"
        aria-label={t('windowControls.minimize')}
        onClick={() => window.klarit.minimizeWindow()}
        className="flex h-11 w-12 items-center justify-center text-stone-600 hover:bg-stone-100 hover:text-ink"
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        aria-label={t('windowControls.maximize')}
        onClick={() => window.klarit.toggleMaximizeWindow()}
        className="flex h-11 w-12 items-center justify-center text-stone-600 hover:bg-stone-100 hover:text-ink"
      >
        <Square size={13} />
      </button>
      <button
        type="button"
        aria-label={t('windowControls.close')}
        onClick={() => window.klarit.closeWindow()}
        className="flex h-11 w-12 items-center justify-center text-stone-600 hover:bg-danger hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  )
}
