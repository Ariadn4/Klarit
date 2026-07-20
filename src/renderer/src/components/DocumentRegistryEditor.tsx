import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, FileText, Folder, X } from 'lucide-react'
import type { DocKind, ManagedDoc } from '@shared/types'
import { useDocumentsStore } from '../stores/documents'
import { ExpandableRow, useSingleOpen } from './ui/ExpandableRow'
import { IconButton } from './ui/controls'
import { Field } from './ui/Field'
import { inputClass } from './ui/styles'

/** 可编辑路径：agent 分组不合意时手动收级（如 openspec/changes/add-x → openspec/changes）。 */
function PathField({ doc }: { doc: ManagedDoc }): React.JSX.Element {
  const { t } = useTranslation()
  const editLocation = useDocumentsStore((s) => s.editLocation)
  const [draft, setDraft] = useState(doc.location)

  useEffect(() => setDraft(doc.location), [doc.location])

  const apply = (): void => {
    const next = draft.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (next !== '' && next !== doc.location) editLocation(doc.id, next)
  }

  return (
    <Field label={t('documentRegistry.pathLabel')} htmlFor={`path-${doc.id}`}>
      <div className="flex items-center gap-2">
        <input
          id={`path-${doc.id}`}
          aria-label={t('documentRegistry.pathAria', { location: doc.location })}
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
          }}
        />
        <button
          type="button"
          aria-label={t('documentRegistry.pathApply', { location: doc.location })}
          onClick={apply}
          className="shrink-0 rounded border border-stone-300 px-2.5 py-1.5 text-[13px] text-ink hover:border-cobalt-500 hover:text-cobalt-500"
        >
          {t('documentRegistry.pathApplyText')}
        </button>
      </div>
    </Field>
  )
}

/** 一条登记条目（可展开：覆盖计数 + 可编辑路径 + 习惯 prompt）。审批由「确认并保存」整表承担。 */
function DocRow({
  doc,
  open,
  onToggle
}: {
  doc: ManagedDoc
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { reclassify, eject, editPrompt } = useDocumentsStore()
  const Icon = doc.isFolder ? Folder : FileText
  return (
    <ExpandableRow
      open={open}
      onToggle={onToggle}
      summaryLabel={t('documentRegistry.rowAria', { location: doc.location })}
      title={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon size={13} className="shrink-0 text-stone-600" />
          <span className="truncate">{doc.location}</span>
        </span>
      }
      trailing={
        <>
          <IconButton
            label={t('documentRegistry.reclassifyAria', { location: doc.location })}
            onClick={() => reclassify(doc.id)}
          >
            <ArrowLeftRight size={14} />
          </IconButton>
          <IconButton
            label={t('documentRegistry.ejectAria', { location: doc.location })}
            danger
            onClick={() => eject(doc.id)}
          >
            <X size={14} />
          </IconButton>
        </>
      }
    >
      {/* 文件夹条目只给覆盖计数，不列文件明细——展开区的重心是「这一类怎么写」的 prompt。 */}
      {doc.isFolder && (
        <p className="text-[12px] text-stone-600">
          {t('documentRegistry.coversFiles', { count: doc.coversFiles?.length ?? 0 })}
        </p>
      )}
      <PathField doc={doc} />
      <Field
        label={t('documentRegistry.habitPromptLabel')}
        description={t('documentRegistry.habitPromptDescription')}
        htmlFor={`habit-${doc.id}`}
      >
        <textarea
          id={`habit-${doc.id}`}
          aria-label={t('documentRegistry.habitPromptAria', { location: doc.location })}
          className={`${inputClass} min-h-20 resize-y`}
          value={doc.habitPrompt}
          onChange={(e) => editPrompt(doc.id, e.target.value)}
        />
      </Field>
    </ExpandableRow>
  )
}

/** 一栏（一个桶）：标题 + 计数 + 条目行。 */
function Column({
  kind,
  docs,
  isOpen,
  toggle
}: {
  kind: DocKind
  docs: ManagedDoc[]
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const title =
    kind === 'dynamic' ? t('documentRegistry.dynamicColumn') : t('documentRegistry.snapshotColumn')
  const description =
    kind === 'dynamic'
      ? t('documentRegistry.dynamicDescription')
      : t('documentRegistry.snapshotDescription')
  return (
    <section aria-label={title} data-doc-column={kind} className="min-w-0 flex-1">
      <div className="border-b border-stone-300 px-1 pb-[7px] pt-[5px]">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <span className="flex-1" />
          {docs.length > 0 && (
            <span className="rounded-pill bg-stone-100 px-1.5 py-px font-mono text-[10px] text-stone-600">
              {docs.length}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-normal text-stone-600">{description}</p>
      </div>
      {/* 条目区各栏**独立滚动**（滚动条在栏内，不滚整个弹窗/面板）。 */}
      <div className="max-h-[46vh] overflow-y-auto">
        {docs.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-stone-600">{t('documentRegistry.emptyColumn')}</p>
        ) : (
          docs.map((doc) => (
            <DocRow key={doc.id} doc={doc} open={isOpen(doc.id)} onToggle={() => toggle(doc.id)} />
          ))
        )}
      </div>
    </section>
  )
}

/** 「+ 添加文件/文件夹」：找回移出的 / 纳入没扫到的（输入相对路径 + 选桶）。 */
function AddEntry(): React.JSX.Element {
  const { t } = useTranslation()
  const add = useDocumentsStore((s) => s.add)
  const [editing, setEditing] = useState(false)
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<DocKind>('dynamic')

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={t('documentRegistry.addEntry')}
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 self-start rounded px-2 py-[3px] text-[13px] font-medium text-cobalt-500 hover:bg-cobalt-500/12"
      >
        + {t('documentRegistry.addEntry')}
      </button>
    )
  }
  const submit = (): void => {
    const trimmed = path.trim().replace(/\\/g, '/')
    if (trimmed !== '') {
      add(trimmed, kind)
      setPath('')
      setEditing(false)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={t('documentRegistry.addPathAria')}
        placeholder={t('documentRegistry.addPathPlaceholder')}
        className={inputClass}
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <select
        aria-label={t('documentRegistry.addKindAria')}
        className={`${inputClass} w-32 cursor-pointer`}
        value={kind}
        onChange={(e) => setKind(e.target.value as DocKind)}
      >
        <option value="dynamic">{t('documentRegistry.dynamicColumn')}</option>
        <option value="snapshot">{t('documentRegistry.snapshotColumn')}</option>
      </select>
      <button
        type="button"
        onClick={submit}
        className="shrink-0 rounded bg-cobalt-500 px-2.5 py-1.5 text-[13px] font-medium text-paper hover:bg-cobalt-800"
      >
        {t('documentRegistry.addConfirm')}
      </button>
    </div>
  )
}

/**
 * 文档登记表编辑器（document-registry-ui 核心）：两栏（动态/快照）+ 行展开
 * （覆盖计数 + 可编辑路径 + 习惯 prompt）+ `⇄` 改判 + `✕` 移出 + `+ 添加` + 文档公约区。
 * 「不纳管」无可见栏——移出即离表。**不设逐条审批控件**：审批由「确认并保存」整表承担。
 * 数据经 documents store，落盘由父层触发。
 */
export function DocumentRegistryEditor(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { registry, editConvention } = useDocumentsStore()
  const single = useSingleOpen()
  if (!registry) return null
  const dynamicDocs = registry.docs.filter((d) => d.kind === 'dynamic')
  const snapshotDocs = registry.docs.filter((d) => d.kind === 'snapshot')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <Column kind="dynamic" docs={dynamicDocs} isOpen={single.isOpen} toggle={single.toggle} />
        <Column kind="snapshot" docs={snapshotDocs} isOpen={single.isOpen} toggle={single.toggle} />
      </div>

      <AddEntry />

      <Field
        label={t('documentRegistry.convention')}
        description={t('documentRegistry.conventionDescription')}
        htmlFor="doc-convention"
      >
        <textarea
          id="doc-convention"
          aria-label={t('documentRegistry.convention')}
          className={`${inputClass} min-h-20 resize-y`}
          value={registry.conventionPreamble}
          onChange={(e) => editConvention(e.target.value)}
        />
      </Field>
    </div>
  )
}
