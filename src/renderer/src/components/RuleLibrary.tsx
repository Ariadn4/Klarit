import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Copy, Download, Pencil, Trash2, Upload } from 'lucide-react'
import type { Localized, RulePack, RulePackItem, RulePackItemKind, RulePackSummary } from '@shared/rule-pack'
import { resolveLocalized } from '@shared/rule-pack'
import { coerceLanguage, LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@shared/language'
import { ListEditor, ListRow } from './ui/ListEditor'
import { ExpandableRow, useSingleOpen } from './ui/ExpandableRow'
import { IconButton } from './ui/controls'
import { DetailHeader } from './ui/SettingsHeaderSlot'
import { Field } from './ui/Field'
import { LocalizedTextInput } from './ui/LocalizedTextInput'
import { inputClass } from './ui/styles'

// 品牌：语义令牌（canvas/paper/ink/stone…），不用 bg-white 等不翻色死值。
const inputCls = inputClass
// 字段标签：标题式（品牌规范第 12 章）。
const labelCls = 'mb-1 block text-[13px] font-semibold text-ink'

/** 语言码 → 展示名（受支持语言有本地化名，开放语言键回落显示码本身）。 */
function langLabel(code: string): string {
  return (LANGUAGE_LABELS as Record<string, string>)[code] ?? code
}

/** 收集某规则包里所有出现过的语言键（外部导入的包可能带受支持语言之外的语言，也让它可被选中编辑）。 */
function presentLangs(pack: RulePack): string[] {
  const set = new Set<string>()
  const eat = (f: Localized | undefined): void => {
    if (f) for (const k of Object.keys(f)) set.add(k)
  }
  eat(pack.name)
  eat(pack.description)
  for (const it of pack.items) {
    eat(it.name)
    if (it.kind === 'constitution-rule') eat(it.text)
    if (it.kind === 'output-template') eat(it.content)
  }
  return [...set]
}

/**
 * 顶栏「编辑语言」下拉：列出软件支持的所有语言（+ 包已带的开放语言），选中哪个就编辑哪个语言。
 * 用下拉而非并排多栏——语言再多也只占一个下拉，不横向膨胀。
 */
function EditLanguageSelect({
  langs,
  value,
  onChange
}: {
  langs: string[]
  value: string
  onChange: (lang: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[12px] text-stone-600">{t('ruleLibrary.editLanguage')}</span>
      <select
        className="rounded border border-stone-300 bg-canvas px-1.5 py-0.5 text-[12px] text-ink"
        aria-label={t('ruleLibrary.editLanguageAria')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {langs.map((l) => (
          <option key={l} value={l}>
            {langLabel(l)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** 条目类型 → 词典键；类型标识本身（带连字符）保持不变，仅展示名走 i18n。 */
const KIND_LABEL_KEY: Record<RulePackItemKind, string> = {
  'constitution-rule': 'kindConstitutionRule',
  'output-template': 'kindOutputTemplate',
  'objective-check': 'kindObjectiveCheck'
}
const KINDS = Object.keys(KIND_LABEL_KEY) as RulePackItemKind[]

/** 取某条目类型的本地化展示名。 */
function kindLabel(t: TFunction, kind: RulePackItemKind): string {
  return t(`ruleLibrary.${KIND_LABEL_KEY[kind]}`)
}

function newItem(kind: RulePackItemKind): RulePackItem {
  const id = crypto.randomUUID()
  if (kind === 'constitution-rule') return { kind, id, name: {}, text: {} }
  if (kind === 'output-template') return { kind, id, name: {}, content: {} }
  return { kind, id, name: {}, command: '' }
}

function RulePackEditor({
  id,
  onClose,
  onSaved
}: {
  id: string
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const uiLang = i18n.language
  const [pack, setPack] = useState<RulePack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // 当前编辑的语言（默认＝界面语言）。
  const [editLang, setEditLang] = useState<string>(() => coerceLanguage(uiLang))
  // 规则条目手风琴：同时最多展开一条。
  const acc = useSingleOpen()

  useEffect(() => {
    let alive = true
    window.klarit.getRulePack(id).then((p) => {
      if (alive) setPack(p)
    })
    return () => {
      alive = false
    }
  }, [id])

  // 可选语言 = 受支持语言 ∪ 包已带语言（去重、稳定顺序）。
  const langs = useMemo(() => {
    return [...new Set<string>([...SUPPORTED_LANGUAGES, ...(pack ? presentLangs(pack) : [])])]
  }, [pack])

  if (!pack) return <p className="px-1 py-2 text-[13px] text-stone-600">{t('common.loading')}</p>

  const update = (fn: (p: RulePack) => RulePack): void => {
    setPack((p) => (p ? fn(p) : p))
    setSaved(false)
  }
  const patchItem = (i: number, item: RulePackItem): void =>
    update((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? item : it)) }))

  const save = async (): Promise<void> => {
    const result = await window.klarit.saveRulePack(pack)
    if (result.ok) {
      setError(null)
      setSaved(true)
      onSaved()
    } else {
      setError(result.reason)
    }
  }

  return (
    <div className="space-y-4">
      <DetailHeader
        backLabel={t('ruleLibrary.backToLibrary')}
        onBack={onClose}
        onSave={save}
        saved={saved}
        saveLabel={t('common.save')}
        savedLabel={t('ruleLibrary.saved')}
        extraActions={<EditLanguageSelect langs={langs} value={editLang} onChange={setEditLang} />}
      />

      {error && (
        <p role="alert" className="rounded border border-danger/30 bg-signal-50 px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      )}

      <label className="block">
        <span className={labelCls}>{t('ruleLibrary.nameLabel')}</span>
        <LocalizedTextInput
          value={pack.name}
          lang={editLang}
          multiline={false}
          ariaLabel={t('ruleLibrary.packNameAria')}
          placeholder={t('ruleLibrary.itemNamePlaceholder')}
          onChange={(next) => update((p) => ({ ...p, name: next }))}
        />
      </label>
      <label className="block">
        <span className={labelCls}>{t('ruleLibrary.descLabel')}</span>
        <LocalizedTextInput
          value={pack.description ?? {}}
          lang={editLang}
          multiline
          ariaLabel={t('ruleLibrary.packDescAria')}
          placeholder={t('ruleLibrary.descLabel')}
          onChange={(next) => update((p) => ({ ...p, description: next }))}
        />
      </label>

      <div className="space-y-3.5">
        {KINDS.map((kind) => {
          const label = kindLabel(t, kind)
          const entries = pack.items.map((item, i) => ({ item, i })).filter((e) => e.item.kind === kind)
          return (
            <ListEditor
              key={kind}
              title={label}
              count={entries.length}
              addLabel={t('ruleLibrary.addItem', { kind: label })}
              onAdd={() => {
                const it = newItem(kind)
                update((p) => ({ ...p, items: [...p.items, it] }))
                acc.toggle(it.id) // 加完即展开新条目
              }}
            >
              {entries.length > 0 && (
                <div>
                  {entries.map(({ item, i }, ord) => (
                    // 可展开：折叠只显只读名称作摘要（按界面语言解析）；展开后编辑当前所选语言。
                    <ExpandableRow
                      key={item.id}
                      open={acc.isOpen(item.id)}
                      onToggle={() => acc.toggle(item.id)}
                      summaryLabel={`${label} ${ord + 1}`}
                      title={resolveLocalized(item.name, uiLang) || t('ruleLibrary.itemNamePlaceholder')}
                      trailing={
                        <IconButton
                          label={t('ruleLibrary.deleteItemAria', { kind: label, ord: ord + 1 })}
                          danger
                          onClick={() => update((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      }
                    >
                      <Field label={t('ruleLibrary.itemNameField')}>
                        <LocalizedTextInput
                          value={item.name}
                          lang={editLang}
                          multiline={false}
                          ariaLabel={t('ruleLibrary.itemNameAria', { kind: label, ord: ord + 1 })}
                          placeholder={t('ruleLibrary.itemNamePlaceholder')}
                          onChange={(next) => patchItem(i, { ...item, name: next })}
                        />
                      </Field>
                      {item.kind === 'objective-check' ? (
                        <Field label={t('ruleLibrary.itemCommandField')}>
                          <input
                            className={`${inputCls} font-mono`}
                            value={item.command}
                            aria-label={t('ruleLibrary.commandAria', { kind: label, ord: ord + 1 })}
                            placeholder={t('ruleLibrary.commandPlaceholder')}
                            onChange={(e) => patchItem(i, { ...item, command: e.target.value })}
                          />
                        </Field>
                      ) : (
                        <Field label={t('ruleLibrary.itemContentField')}>
                          <LocalizedTextInput
                            value={item.kind === 'constitution-rule' ? item.text : item.content}
                            lang={editLang}
                            multiline
                            ariaLabel={t('ruleLibrary.contentAria', { kind: label, ord: ord + 1 })}
                            placeholder={
                              item.kind === 'constitution-rule'
                                ? t('ruleLibrary.ruleContentPlaceholder')
                                : t('ruleLibrary.templateContentPlaceholder')
                            }
                            onChange={(next) =>
                              patchItem(
                                i,
                                item.kind === 'constitution-rule'
                                  ? { ...item, text: next }
                                  : { ...item, content: next }
                              )
                            }
                          />
                        </Field>
                      )}
                    </ExpandableRow>
                  ))}
                </div>
              )}
            </ListEditor>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 应用级「规则库」：管理全部规则包（新建/克隆/删除/导入/导出 + 进入编辑）。
 * 规则包是全局应用数据；项目只在「项目设置·宪法」里激活并逐条开关。
 */
export function RuleLibrary(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const uiLang = i18n.language
  const [list, setList] = useState<RulePackSummary[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setList(await window.klarit.listRulePacks())
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  if (editingId) {
    return <RulePackEditor id={editingId} onClose={() => setEditingId(null)} onSaved={reload} />
  }

  return (
    <ListEditor
      title={t('ruleLibrary.title')}
      count={list.length}
      addLabel={t('common.add')}
      onAdd={async () => {
        await window.klarit.createRulePack()
        await reload()
      }}
      headAction={
        <button
          type="button"
          aria-label={t('ruleLibrary.importAria')}
          onClick={async () => {
            const r = await window.klarit.importRulePack()
            if (r?.ok) await reload()
          }}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-stone-600 hover:bg-stone-100 hover:text-ink"
        >
          <Upload size={12} /> {t('common.import')}
        </button>
      }
    >
      {list.map((p) => {
        const name = resolveLocalized(p.name, uiLang)
        return (
          <ListRow key={p.id}>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
            <IconButton label={t('ruleLibrary.editAria', { name })} onClick={() => setEditingId(p.id)}>
              <Pencil size={15} />
            </IconButton>
            <IconButton
              label={t('ruleLibrary.cloneAria', { name })}
              onClick={async () => {
                await window.klarit.cloneRulePack(p.id)
                await reload()
              }}
            >
              <Copy size={15} />
            </IconButton>
            <IconButton label={t('ruleLibrary.exportAria', { name })} onClick={() => window.klarit.exportRulePack(p.id)}>
              <Download size={15} />
            </IconButton>
            <IconButton
              label={t('ruleLibrary.deleteAria', { name })}
              danger
              onClick={async () => setList(await window.klarit.deleteRulePack(p.id))}
            >
              <Trash2 size={15} />
            </IconButton>
          </ListRow>
        )
      })}
    </ListEditor>
  )
}
