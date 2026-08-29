/**
 * 决策收件箱面板：列出当前项目所有**正等你拍板**的运行，点一条跳到该卡详情并聚焦决策面板。
 *
 * 职责边界很窄——**只导航、不回应**：这里不放选项、不放填空、不放人工门动作按钮。
 * 回应决策的唯一入口仍是卡详情里的 `RunDecisionPanel`（否则会出现两套能力不等价的决策 UI）。
 *
 * 条目文案复用既有决策 i18n key（`titleKey` + `titleParams`），收件箱不另立一套决策文案。
 */

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { waitedFor, type DecisionInboxEntry } from '@shared/decision-inbox'
import { useDecisionInboxStore } from '../stores/decisionInbox'
import { useCardsStore } from '../stores/cards'

/** 面板挂在顶栏（可拖动区）内，其内元素须显式取消拖拽区，否则点击会被窗口拖动吞掉。 */
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/** 已等待时长 → i18n key + 插值（「现在」在渲染时取一次，桶划分的纯函数在 shared 里）。 */
function waitedText(entry: DecisionInboxEntry, now: number): { key: string; params: { value: number } } {
  const { unit, value } = waitedFor(entry.pendingSince, now)
  const suffix = `${unit[0].toUpperCase()}${unit.slice(1)}`
  return { key: `decisionInbox.waited${suffix}`, params: { value } }
}

export function DecisionInbox(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useDecisionInboxStore((s) => s.open)
  const entries = useDecisionInboxStore((s) => s.entries)
  const close = useDecisionInboxStore((s) => s.close)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  const now = Date.now()

  return (
    <>
      {/* 点面板外收起：透明捕获层（不是模态蒙层，不压暗界面）。挂在顶栏内，故须显式取消拖拽区。 */}
      <div
        data-testid="decision-inbox-scrim"
        style={NO_DRAG}
        className="fixed inset-0 z-[70]"
        onClick={close}
      />
      <div
        role="dialog"
        aria-label={t('decisionInbox.title')}
        style={NO_DRAG}
        className="absolute left-0 top-full z-[71] mt-1 max-h-[60vh] w-80 overflow-auto rounded-card border border-stone-100 bg-paper"
      >
        <div className="border-b border-stone-100 px-3 py-2 text-[11px] font-medium tracking-wide text-stone-600">
          {t('decisionInbox.title')}
        </div>
        {entries.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-stone-600">{t('decisionInbox.empty')}</p>
        ) : (
          <ul className="flex flex-col p-1">
            {entries.map((entry) => {
              const waited = waitedText(entry, now)
              return (
              <li key={entry.runId}>
                <button
                  type="button"
                  onClick={() => {
                    // 只导航：打开该卡详情并定位到决策区，回应仍归卡详情里的决策面板。
                    useCardsStore.getState().openDetail(entry.cardId, 'decision')
                    close()
                  }}
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-stone-100"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                      {entry.cardName}
                    </span>
                    <span
                      className={`shrink-0 rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                        entry.gateKind === 'review'
                          ? 'bg-cobalt-50 text-cobalt-800'
                          : 'bg-warning/15 text-warning'
                      }`}
                    >
                      {t(entry.gateKind === 'review' ? 'decisionInbox.gateReview' : 'decisionInbox.gateFailure')}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-stone-600">
                    {t(entry.titleKey, entry.titleParams)}
                  </p>
                  <div className="mt-0.5 text-[10px] text-stone-600">{t(waited.key, waited.params)}</div>
                </button>
              </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
