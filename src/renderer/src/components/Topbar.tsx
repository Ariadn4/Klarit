import { Inbox, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WindowControls } from './WindowControls'
import { DecisionInbox } from './DecisionInbox'
import { useDecisionInboxStore } from '../stores/decisionInbox'

interface TopbarProps {
  collapsed: boolean
  onToggleSidebar: () => void
  /** 本窗口是否绑定了项目；未绑定不渲染收件箱入口（无项目即无运行、无决策）。 */
  hasProject: boolean
}

const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function Topbar({ collapsed, onToggleSidebar, hasProject }: TopbarProps): React.JSX.Element {
  const { t } = useTranslation()
  const count = useDecisionInboxStore((s) => s.entries.length)
  const inboxOpen = useDecisionInboxStore((s) => s.open)
  const toggleInbox = useDecisionInboxStore((s) => s.toggle)

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

      {/* 决策收件箱入口：与侧边栏折叠开关并列；徽标仅在 >0 时出现（不显示「0」占位）。 */}
      {hasProject && (
        <div className="relative">
          <button
            type="button"
            style={NO_DRAG}
            onClick={toggleInbox}
            aria-label={
              count > 0
                ? `${t('topbar.decisionInbox')}（${t('decisionInbox.pendingCount', { n: count })}）`
                : t('topbar.decisionInbox')
            }
            aria-expanded={inboxOpen}
            aria-haspopup="dialog"
            className={`relative flex h-8 w-8 items-center justify-center rounded ${
              inboxOpen ? 'bg-cobalt-50 text-cobalt-800' : 'text-stone-600 hover:bg-stone-100 hover:text-ink'
            }`}
          >
            <Inbox size={18} />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-pill bg-signal-500 px-1 text-center text-[10px] font-medium leading-4 text-white">
                {count}
              </span>
            )}
          </button>
          <DecisionInbox />
        </div>
      )}

      <div className="flex-1" />
      <WindowControls />
    </header>
  )
}
