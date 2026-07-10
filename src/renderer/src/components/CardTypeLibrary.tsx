import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import type { CardArchetype, CardColorKey, CardTypeDef } from '@shared/types'
import { CARD_ARCHETYPES } from '@shared/card-type'
import { dedupeProposedName, toProposedName } from '@shared/requirement-card'
import { CardColorPicker } from './CardColorPicker'
import { Field } from './ui/Field'
import { ListEditor, ListRow } from './ui/ListEditor'
import { IconButton } from './ui/controls'
import { DetailHeader } from './ui/SettingsHeaderSlot'
import { inputClass } from './ui/styles'

// 品牌：只用语义令牌（canvas/paper/ink/stone/cobalt…），不用 bg-white 等不翻色死值。
const inputCls = inputClass

interface Draft {
  /** 已有类型的 id；新建为 null（保存时由名称派生）。 */
  id: string | null
  name: string
  description: string
  archetype: CardArchetype
  color: CardColorKey
}

const blankDraft = (): Draft => ({ id: null, name: '', description: '', archetype: 'leaf', color: 'violet' })

function TypeEditor({
  draft,
  existingIds,
  onCancel,
  onSaved
}: {
  draft: Draft
  existingIds: string[]
  onCancel: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(draft.name)
  const [description, setDescription] = useState(draft.description)
  const [archetype, setArchetype] = useState<CardArchetype>(draft.archetype)
  const [color, setColor] = useState<CardColorKey>(draft.color)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    // 新建：由名称派生 git 友好 id，与现有 id 去重；编辑：沿用原 id。
    const id = draft.id ?? dedupeProposedName(toProposedName(name) || 'type', existingIds)
    const result = await window.klarit.saveCardType({ id, name, description, archetype, color })
    if (result.ok) {
      setError(null)
      onSaved()
    } else {
      setError(result.reason)
    }
  }

  return (
    <div className="space-y-4">
      <DetailHeader
        backLabel={t('cardTypeLibrary.backToLibrary')}
        onBack={onCancel}
        onSave={save}
        saveLabel={t('common.save')}
      />

      {error && (
        <p role="alert" className="rounded border border-danger/30 bg-signal-50 px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      )}

      <Field label={t('cardTypeLibrary.nameLabel')}>
        <input
          className={inputCls}
          value={name}
          aria-label={t('cardTypeLibrary.nameAria')}
          placeholder={t('cardTypeLibrary.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label={t('cardTypeLibrary.archetypeLabel')} description={t(`cardTypeLibrary.archetypeHint_${archetype}`)}>
        <select
          className={inputCls}
          value={archetype}
          aria-label={t('cardTypeLibrary.archetypeAria')}
          onChange={(e) => setArchetype(e.target.value as CardArchetype)}
        >
          {CARD_ARCHETYPES.map((a) => (
            <option key={a} value={a}>
              {t(`cardTypeLibrary.archetype_${a}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('cardTypeLibrary.colorLabel')}>
        <CardColorPicker value={color} onChange={setColor} />
      </Field>

      <Field label={t('cardTypeLibrary.descLabel')} description={t('cardTypeLibrary.descHint')}>
        <textarea
          className={`${inputCls} min-h-20`}
          value={description}
          aria-label={t('cardTypeLibrary.descAria')}
          placeholder={t('cardTypeLibrary.descPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
    </div>
  )
}

/** 自动生成分解 skill 的只读预览子页面。 */
function PreviewPage({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  useEffect(() => {
    let alive = true
    window.klarit.readGeneratedDecomposeSkill().then((s) => {
      if (alive) setText(s)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="space-y-3">
      <DetailHeader backLabel={t('cardTypeLibrary.backToLibrary')} onBack={onBack} />
      <h3 className="text-[13px] font-semibold text-ink">{t('cardTypeLibrary.previewBtn')}</h3>
      <pre
        aria-label={t('cardTypeLibrary.previewAria')}
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-card border border-stone-100 bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink"
      >
        {text}
      </pre>
    </div>
  )
}

/**
 * 应用级「需求卡类型」库：管理全部自定义类型（新增/编辑/删除、选徽章颜色），并进入子页面预览自动生成的分解 skill。
 * 类型是全局应用数据；archetype（container/leaf）为引擎内置，决定流动与关系合法性。
 */
export function CardTypeLibrary(): React.JSX.Element {
  const { t } = useTranslation()
  const [list, setList] = useState<CardTypeDef[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setList(await window.klarit.listCardTypes())
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  if (previewing) return <PreviewPage onBack={() => setPreviewing(false)} />

  // 字段多的需求卡类型用独立详情视图（点行尾「编辑」进入；列表只读显示名称）。
  if (editing) {
    return (
      <TypeEditor
        draft={editing}
        existingIds={list.filter((tp) => tp.id !== editing.id).map((tp) => tp.id)}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await reload()
        }}
      />
    )
  }

  const remove = async (def: CardTypeDef): Promise<void> => {
    const r = await window.klarit.deleteCardType(def.id)
    if (r.ok) {
      setError(null)
      await reload()
    } else {
      setError(r.reason)
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="rounded border border-danger/30 bg-signal-50 px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      )}

      <ListEditor
        title={t('cardTypeLibrary.title')}
        description={t('cardTypeLibrary.description')}
        count={list.length}
        addLabel={t('common.add')}
        onAdd={() => {
          setError(null)
          setEditing(blankDraft())
        }}
        headAction={
          <IconButton label={t('cardTypeLibrary.previewBtn')} onClick={() => setPreviewing(true)}>
            <FileText size={15} />
          </IconButton>
        }
      >
        {list.map((tp) => (
          <ListRow key={tp.id}>
            {/* 只读显示名称；详情进编辑页改。 */}
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{tp.name}</span>
            <IconButton
              label={t('cardTypeLibrary.editAria', { name: tp.name })}
              onClick={() => {
                setError(null)
                setEditing({
                  id: tp.id,
                  name: tp.name,
                  description: tp.description,
                  archetype: tp.archetype,
                  color: tp.color ?? 'violet'
                })
              }}
            >
              <Pencil size={15} />
            </IconButton>
            <IconButton label={t('cardTypeLibrary.deleteAria', { name: tp.name })} danger onClick={() => remove(tp)}>
              <Trash2 size={15} />
            </IconButton>
          </ListRow>
        ))}
      </ListEditor>
    </div>
  )
}
