import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Pencil, Trash2, Upload } from 'lucide-react'
import type { DetectedAgent, WorkflowSummary } from '@shared/types'
import type { RulePack } from '@shared/rule-pack'
import { resolveLocalized } from '@shared/localized'
import { WorkflowEditor } from './WorkflowEditor'
import { IconButton } from './ui/controls'
import { ListEditor, ListRow } from './ui/ListEditor'

/**
 * 应用级「工作流库」：调整全部工作流（新建/克隆/删除/导入 + 进入编辑）。
 * 工作流是全局数据，与具体项目无关；项目只在 WorkflowPicker 里指定激活哪一个。
 */
export function WorkflowLibrary({
  detectedAgents = []
}: {
  /** 本机已检测到的 agent，透传给编辑器的 agent 工具/模型下拉。 */
  detectedAgents?: DetectedAgent[]
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [list, setList] = useState<WorkflowSummary[]>([])
  const [rulePacks, setRulePacks] = useState<RulePack[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setList(await window.klarit.listWorkflows())
  }, [])

  useEffect(() => {
    reload()
    // 规则库条目供编辑器「从规则库引用」选择器用；进入库即拉一次。
    window.klarit.allRulePacks?.().then(setRulePacks)
  }, [reload])

  const onNew = useCallback(async () => {
    await window.klarit.createWorkflow()
    await reload()
  }, [reload])

  const onClone = useCallback(
    async (id: string) => {
      await window.klarit.cloneWorkflow(id)
      await reload()
    },
    [reload]
  )

  const onDelete = useCallback(
    async (id: string) => {
      const next = await window.klarit.deleteWorkflow(id)
      setList(next)
    },
    []
  )

  const onImport = useCallback(async () => {
    const result = await window.klarit.importWorkflow()
    if (result?.ok) await reload()
  }, [reload])

  if (editingId) {
    return (
      <WorkflowEditor
        workflowId={editingId}
        others={list.filter((w) => w.id !== editingId)}
        detectedAgents={detectedAgents}
        rulePacks={rulePacks}
        onClose={() => setEditingId(null)}
        onSaved={reload}
      />
    )
  }

  return (
    <ListEditor
      title={t('workflowLibrary.title')}
      count={list.length}
      addLabel={t('common.add')}
      onAdd={onNew}
      headAction={
        <button
          type="button"
          onClick={onImport}
          aria-label={t('workflowLibrary.importAria')}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-stone-600 hover:bg-stone-100 hover:text-ink"
        >
          <Upload size={12} /> {t('common.import')}
        </button>
      }
    >
      {list.map((w) => {
        const name = resolveLocalized(w.name, i18n.language)
        return (
        <ListRow key={w.id}>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
          {w.invalidReason && (
            <span className="shrink-0 text-[12px] text-danger" title={w.invalidReason}>
              {t('workflowLibrary.invalid')}
            </span>
          )}
          <IconButton label={t('workflowLibrary.editAria', { name })} onClick={() => setEditingId(w.id)}>
            <Pencil size={15} />
          </IconButton>
          <IconButton label={t('workflowLibrary.cloneAria', { name })} onClick={() => onClone(w.id)}>
            <Copy size={15} />
          </IconButton>
          <IconButton label={t('workflowLibrary.deleteAria', { name })} danger onClick={() => onDelete(w.id)}>
            <Trash2 size={15} />
          </IconButton>
        </ListRow>
        )
      })}
    </ListEditor>
  )
}
