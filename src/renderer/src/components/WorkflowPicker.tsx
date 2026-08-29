import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { WorkflowSummary } from '@shared/types'
import { resolveLocalized } from '@shared/localized'
import { ListEditor } from './ui/ListEditor'

interface WorkflowPickerProps {
  /** 激活某工作流成功后回调其 id（供主面板看板列实时重算）。 */
  onActiveChange?: (workflowId: string) => void
}

/**
 * 项目级「工作流」设置：从全局工作流库里为当前项目指定激活哪一个（仅选择，不编辑）。
 * 编辑/新建工作流在「应用设置 → 工作流」里做。
 */
export function WorkflowPicker({ onActiveChange }: WorkflowPickerProps = {}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [list, setList] = useState<WorkflowSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.klarit.listWorkflows(), window.klarit.getActiveWorkflow()]).then(
      ([items, active]) => {
        setList(items)
        setActiveId(active)
      }
    )
  }, [])

  const onActivate = useCallback(
    async (id: string) => {
      setActiveId(id)
      await window.klarit.setActiveWorkflow(id)
      // 通知上层（→ App）激活变更，驱动主面板看板中间阶段列重算。
      onActiveChange?.(id)
    },
    [onActiveChange]
  )

  return (
    <ListEditor title={t('workflowPicker.title')} description={t('workflowPicker.description')} count={list.length}>
      {list.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-stone-600">{t('workflowPicker.empty')}</p>
      ) : (
        <ul role="radiogroup" aria-label={t('workflowPicker.title')}>
          {list.map((w) => {
            const invalid = !!w.invalidReason
            const checked = activeId === w.id
            return (
              <li key={w.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={invalid}
                  aria-disabled={invalid}
                  title={invalid ? w.invalidReason : undefined}
                  onClick={() => {
                    if (!invalid) onActivate(w.id)
                  }}
                  className="flex w-full items-center gap-2 border-b border-stone-100 px-1 py-1.5 text-left text-[13px] text-ink hover:bg-stone-100/45 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-pill border ${checked ? 'border-cobalt-500 bg-cobalt-500 text-white' : 'border-stone-300'}`}
                  >
                    {checked && <Check size={10} />}
                  </span>
                  <span className="truncate">{resolveLocalized(w.name, i18n.language)}</span>
                  {invalid && <span className="shrink-0 text-[12px] text-danger">{t('workflowPicker.invalid')}</span>}
                  {/* 软校验告警：非阻断，工作流仍可选中激活（warning 令牌，区别于 danger 无效）。 */}
                  {!invalid && w.warnings && w.warnings.length > 0 && (
                    <span className="shrink-0 text-[12px] text-warning" title={w.warnings.join('\n')}>
                      {t('workflowPicker.advisory')}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </ListEditor>
  )
}
