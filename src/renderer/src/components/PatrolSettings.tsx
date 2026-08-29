import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import type { WorkflowSummary } from '@shared/types'
import { resolveLocalized } from '@shared/localized'
import { describeTrigger, type Patrol, type PatrolAction, type PatrolTrigger } from '@shared/patrol'
import { Field } from './ui/Field'
import { ListEditor, ListRow } from './ui/ListEditor'
import { IconButton } from './ui/controls'
import { inputClass } from './ui/styles'

/** 只用语义令牌（canvas/paper/ink/stone/cobalt…），深浅两套靠令牌覆盖，不写死值。 */
const selectCls = `${inputClass} cursor-pointer`

/** 「每 n 小时」的可选档位——下拉而非自由输入，用户不必琢磨填几合适。 */
const HOUR_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24]
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

const blank = (): Patrol => ({
  id: '',
  name: '',
  trigger: { kind: 'daily', time: '03:00' },
  action: { kind: 'docScan' },
  enabled: true
})

/** 触发的人话（i18n key + 参数由 shared 纯函数给，周几名在此翻译）。 */
function useTriggerText(): (trigger: PatrolTrigger) => string {
  const { t } = useTranslation()
  return (trigger) => {
    const { key, params } = describeTrigger(trigger)
    return t(key, {
      ...params,
      weekday: params.weekday === undefined ? undefined : t(`patrol.weekday.${params.weekday}`)
    })
  }
}

/** 动作的人话。 */
function useActionText(workflows: WorkflowSummary[]): (action: PatrolAction) => string {
  const { t, i18n } = useTranslation()
  return (action) => {
    if (action.kind === 'workflow') {
      const hit = workflows.find((w) => w.id === action.workflowId)
      const name = hit ? resolveLocalized(hit.name, i18n.language) : action.workflowId
      return t('patrol.actionWorkflow', { name })
    }
    if (action.kind === 'command') return t('patrol.actionCommand', { command: action.command })
    return t('patrol.actionDocScan')
  }
}

/** 一条巡检的编辑表单：触发与动作全是下拉/选择器，**不出现任何表达式输入框**。 */
function PatrolEditor({
  draft,
  workflows,
  onCancel,
  onSave
}: {
  draft: Patrol
  workflows: WorkflowSummary[]
  onCancel: () => void
  onSave: (patrol: Patrol) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [name, setName] = useState(draft.name)
  const [trigger, setTrigger] = useState<PatrolTrigger>(draft.trigger)
  const [action, setAction] = useState<PatrolAction>(draft.action)

  const time = trigger.kind === 'daily' || trigger.kind === 'weekly' ? trigger.time : '03:00'
  const setTriggerKind = (kind: PatrolTrigger['kind']): void => {
    if (kind === 'everyHours') setTrigger({ kind, hours: 6 })
    else if (kind === 'daily') setTrigger({ kind, time })
    else setTrigger({ kind, weekday: 1, time })
  }
  const setActionKind = (kind: PatrolAction['kind']): void => {
    if (kind === 'workflow') setAction({ kind, workflowId: workflows[0]?.id ?? '' })
    else if (kind === 'command') setAction({ kind, command: '' })
    else setAction({ kind: 'docScan' })
  }

  return (
    <div className="space-y-4 border-b border-stone-100 px-1 py-3">
      <Field label={t('patrol.nameLabel')} htmlFor="patrol-name">
        <input
          id="patrol-name"
          className={inputClass}
          value={name}
          placeholder={t('patrol.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label={t('patrol.triggerLabel')} htmlFor="patrol-trigger">
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="patrol-trigger"
            className={`${selectCls} w-auto`}
            value={trigger.kind}
            onChange={(e) => setTriggerKind(e.target.value as PatrolTrigger['kind'])}
          >
            <option value="everyHours">{t('patrol.triggerKind.everyHours')}</option>
            <option value="daily">{t('patrol.triggerKind.daily')}</option>
            <option value="weekly">{t('patrol.triggerKind.weekly')}</option>
          </select>

          {trigger.kind === 'everyHours' && (
            <select
              aria-label={t('patrol.hoursLabel')}
              className={`${selectCls} w-auto`}
              value={trigger.hours}
              onChange={(e) => setTrigger({ kind: 'everyHours', hours: Number(e.target.value) })}
            >
              {HOUR_CHOICES.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}

          {trigger.kind === 'weekly' && (
            <select
              aria-label={t('patrol.weekdayLabel')}
              className={`${selectCls} w-auto`}
              value={trigger.weekday}
              onChange={(e) => setTrigger({ ...trigger, weekday: Number(e.target.value) })}
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {t(`patrol.weekday.${d}`)}
                </option>
              ))}
            </select>
          )}

          {trigger.kind !== 'everyHours' && (
            <input
              type="time"
              aria-label={t('patrol.timeLabel')}
              className={`${inputClass} w-auto`}
              value={time}
              onChange={(e) =>
                setTrigger(
                  trigger.kind === 'daily'
                    ? { kind: 'daily', time: e.target.value }
                    : { ...trigger, time: e.target.value }
                )
              }
            />
          )}
        </div>
      </Field>

      <Field label={t('patrol.actionLabel')} htmlFor="patrol-action">
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="patrol-action"
            className={`${selectCls} w-auto`}
            value={action.kind}
            onChange={(e) => setActionKind(e.target.value as PatrolAction['kind'])}
          >
            <option value="workflow">{t('patrol.actionKind.workflow')}</option>
            <option value="command">{t('patrol.actionKind.command')}</option>
            <option value="docScan">{t('patrol.actionKind.docScan')}</option>
          </select>

          {action.kind === 'workflow' &&
            (workflows.length === 0 ? (
              <span className="text-[12px] text-stone-600">{t('patrol.noWorkflows')}</span>
            ) : (
              <select
                aria-label={t('patrol.workflowLabel')}
                className={`${selectCls} w-auto`}
                value={action.workflowId}
                onChange={(e) => setAction({ kind: 'workflow', workflowId: e.target.value })}
              >
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {resolveLocalized(w.name, i18n.language)}
                  </option>
                ))}
              </select>
            ))}

          {action.kind === 'command' && (
            <input
              aria-label={t('patrol.commandLabel')}
              className={`${inputClass} flex-1`}
              value={action.command}
              placeholder={t('patrol.commandPlaceholder')}
              onChange={(e) => setAction({ kind: 'command', command: e.target.value })}
            />
          )}
        </div>
      </Field>

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-2 text-[13px] text-stone-600 hover:text-ink">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onSave({ ...draft, name, trigger, action })}
          className="rounded bg-cobalt-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}

/**
 * 项目设置·定时巡检：列出本项目全部巡检（名字 / 触发人话 / 动作 / 开关 / 上次运行），可增删改启停。
 * 触发一律用下拉 + 时刻选择器表达，**不提供 cron 表达式输入**——面向的是不读代码的用户。
 * 默认零条，空态给说明与新建入口。
 */
export function PatrolSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [patrols, setPatrols] = useState<Patrol[]>([])
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  /** 正在编辑的草稿；null＝不在编辑。新建时 id 为空串。 */
  const [draft, setDraft] = useState<Patrol | null>(null)
  const triggerText = useTriggerText()
  const actionText = useActionText(workflows)

  const load = useCallback(async (): Promise<void> => {
    setPatrols(await window.klarit.listPatrols())
  }, [])

  useEffect(() => {
    void load()
    void window.klarit.listWorkflows().then(setWorkflows)
  }, [load])

  const save = async (patrol: Patrol): Promise<void> => {
    const id = patrol.id || `patrol-${Date.now().toString(36)}`
    setPatrols(await window.klarit.savePatrol({ ...patrol, id }))
    setDraft(null)
  }

  return (
    <ListEditor
      title={t('patrol.title')}
      description={t('patrol.description')}
      count={patrols.length}
      addLabel={draft ? undefined : t('patrol.add')}
      onAdd={draft ? undefined : () => setDraft(blank())}
    >
      {patrols.length === 0 && !draft && (
        <p className="px-1 py-2 text-[13px] text-stone-600">{t('patrol.empty')}</p>
      )}

      {patrols.map((p) =>
        draft?.id === p.id ? (
          <PatrolEditor
            key={p.id}
            draft={draft}
            workflows={workflows}
            onCancel={() => setDraft(null)}
            onSave={save}
          />
        ) : (
          <ListRow key={p.id}>
            {/* 停用视觉：整行压暗 + 明确的「已停用」标记（不靠颜色单独传意）。 */}
            <div className={`flex min-w-0 flex-1 items-center gap-2 ${p.enabled ? '' : 'opacity-55'}`}>
              <input
                type="checkbox"
                checked={p.enabled}
                aria-label={t('patrol.enableAriaLabel', { name: p.name || t('patrol.untitled') })}
                onChange={async (e) => setPatrols(await window.klarit.setPatrolEnabled(p.id, e.target.checked))}
                className="h-4 w-4 shrink-0 accent-cobalt-500"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {p.name || t('patrol.untitled')}
              </span>
              {!p.enabled && (
                <span className="shrink-0 rounded-pill bg-stone-100 px-1.5 py-px text-[10px] text-stone-600">
                  {t('patrol.disabledBadge')}
                </span>
              )}
              <span className="shrink-0 text-[12px] text-stone-600">{triggerText(p.trigger)}</span>
              <span className="min-w-0 truncate text-[12px] text-stone-600">{actionText(p.action)}</span>
              <span className="shrink-0 font-mono text-[11px] text-stone-600">
                {p.lastRunAt === undefined ? t('patrol.lastRunNever') : new Date(p.lastRunAt).toLocaleString()}
              </span>
            </div>
            <IconButton
              label={t('patrol.editAriaLabel', { name: p.name || t('patrol.untitled') })}
              onClick={() => setDraft(p)}
            >
              <Pencil size={14} />
            </IconButton>
            <IconButton
              label={t('patrol.deleteAriaLabel', { name: p.name || t('patrol.untitled') })}
              danger
              onClick={async () => setPatrols(await window.klarit.removePatrol(p.id))}
            >
              <Trash2 size={14} />
            </IconButton>
          </ListRow>
        )
      )}

      {draft && draft.id === '' && (
        <PatrolEditor draft={draft} workflows={workflows} onCancel={() => setDraft(null)} onSave={save} />
      )}

      <p className="px-1 pt-2 text-[12px] text-stone-600">{t('patrol.concurrencyHint')}</p>
    </ListEditor>
  )
}
