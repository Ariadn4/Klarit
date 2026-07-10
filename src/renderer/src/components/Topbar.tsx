import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WindowControls } from './WindowControls'

interface TopbarProps {
  collapsed: boolean
  onToggleSidebar: () => void
}

const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function Topbar({ collapsed, onToggleSidebar }: TopbarProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <header style={DRAG} className="flex h-11 items-center border-b border-stone-100 bg-canvas pl-2">
      <button
        type="button"
        style={NO_DRAG}
        onClick={onToggleSidebar}
        aria-label={collapsed ? t('topbar.expandSidebar') : t('topbar.collapseSidebar')}
        aria-pressed={collapsed}
        className="flex h-8 w-8 items-center justify-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <div className="flex-1" />
      <WindowControls />
    </header>
  )
}
