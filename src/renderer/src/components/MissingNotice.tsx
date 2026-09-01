import { useTranslation } from 'react-i18next'

interface MissingNoticeProps {
  onRemove: () => void
  /** 缺省则不显示「重新定位」（多仓项目目录暂不支持整体重定位）。 */
  onRelocate?: () => void
  message?: string
  removeLabel?: string
}

/** 目录在磁盘上找不到时的提示条：说明 + 可选「重新定位」+「移除」。文案可由调用方覆盖。 */
export function MissingNotice({
  onRemove,
  onRelocate,
  message,
  removeLabel
}: MissingNoticeProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mx-2 rounded-card border border-stone-100 bg-canvas px-2 py-2 text-xs text-stone-600">
      <p className="mb-1.5">{message ?? t('missingNotice.memberMissingMessage')}</p>
      <div className="flex gap-2">
        {onRelocate && (
          <button
            type="button"
            onClick={onRelocate}
            className="rounded px-2 py-1 text-cobalt-500 hover:bg-stone-100"
          >
            {t('missingNotice.relocate')}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="rounded px-2 py-1 text-stone-600 hover:bg-stone-100"
        >
          {removeLabel ?? t('missingNotice.removeFromProject')}
        </button>
      </div>
    </div>
  )
}
