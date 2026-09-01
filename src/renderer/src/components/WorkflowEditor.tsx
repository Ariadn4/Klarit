import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Pencil, Trash2, X } from 'lucide-react'
import type {
  AgentExecConfig,
  ArchiveDocEntry,
  CardColorKey,
  CardTypeDef,
  DetectedAgent,
  ExecutorKind,
  NodeExecutor,
  OutputTemplate,
  WorkflowDefinition,
  WorkflowGateItem,
  WorkflowNode,
  WorkflowOutput,
  WorkflowStage,
  WorkflowSummary
} from '@shared/types'
import type { Localized, RulePack, RulePackItem, RulePackItemRef } from '@shared/rule-pack'
import { listItemsByKind, resolveLocalized } from '@shared/rule-pack'
import { checkBranchPairing, ENGINE_OPERATIONS, engineOpCapabilities, isSafeRelativePath, lintWorkflow, validateWorkflow } from '@shared/workflow'
import { coerceEffort, EFFORT_LEVELS } from '@shared/agents'
import { ModelCombobox } from './ui/ModelCombobox'
import { dedupeProposedName, toProposedName } from '@shared/requirement-card'
import { CARD_ARCHETYPES } from '@shared/card-type'
import { setLocalized } from '@shared/localized'
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, coerceLanguage } from '@shared/language'
import { reorder } from '../lib/reorder'
import { CardColorPicker } from './CardColorPicker'
import { ListEditor, ListRow } from './ui/ListEditor'
import { InlineCell } from './ui/InlineCell'
import { IconButton, DragHandle } from './ui/controls'
import { DetailHeader } from './ui/SettingsHeaderSlot'
import { Field } from './ui/Field'
import { LocalizedTextInput } from './ui/LocalizedTextInput'

interface WorkflowEditorProps {
  workflowId: string
  /**
   * 草稿态：给了就用它种子、**不按 id 从库读**（承载全局 agent 未落库的工作流提案，见 workflow-authoring）。
   * 保存仍走 `saveWorkflow`（按 `def.id` 建/覆盖）；缺省 = 从库按 workflowId 读（设置里的编辑态）。
   */
  initialDef?: WorkflowDefinition
  /**
   * 无边框（浮层预览）模式：主视图**不显顶栏返回/保存**，改为底部固定横栏（关闭 + 保存/更新）。
   * 缺省 = 设置里的常规态（顶栏返回+保存，渲染进设置头部插槽）。
   */
  chromeless?: boolean
  /** chromeless 底部横栏的文案（关闭 / 首次保存 / 已存后更新 / 保存并设为本项目工作流一键）；仅 chromeless 用。 */
  footerLabels?: { close: string; update: string; saveAndActive: string }
  /**
   * 优先从库读：为真时先按 id 从库读（含上次编辑），读不到（如已被删）**回落到 `initialDef` 草稿**——
   * 避免已删工作流再次预览时卡「加载中」。缺省 = 有 initialDef 就用它、否则从库读。
   */
  libraryFirst?: boolean
  /** chromeless：激活到当前项目——「保存并设为本项目工作流」一键里调用（先保存入库，再由此激活）。缺省则主按钮退化为仅保存。 */
  onSetActive?: (workflowId: string) => Promise<void> | void
  /** chromeless：这份工作流是否已是当前项目的激活工作流（是则主按钮显「更新工作流」仅保存，否则显「保存并设为本项目工作流」一键保存并激活）。 */
  isActive?: boolean
  /** 库内其它工作流（subworkflow 选择用，不含自己）。 */
  others: WorkflowSummary[]
  /** 本机已检测到的 agent（工具/模型下拉的数据源）；缺省为空，下拉降级为只有「跟随全局」。 */
  detectedAgents?: DetectedAgent[]
  /** 规则库全部规则包（产出模板/客观门校验的「从规则库引用」选择器数据源）；缺省为空。 */
  rulePacks?: RulePack[]
  onClose: () => void
  /** 保存成功后回调（刷新列表/选择器）。 */
  onSaved: () => void
}

/** 语言码 → 展示名（受支持语言有本地化名，开放语言键回落显示码）。 */
function wfLangLabel(code: string): string {
  return (LANGUAGE_LABELS as Record<string, string>)[code] ?? code
}

/** 工作流里出现过的语言键（把包已带语言并入可选语言集合）。 */
function presentWfLangs(def: WorkflowDefinition): string[] {
  const set = new Set<string>()
  const eat = (f?: Localized): void => {
    if (f) for (const k of Object.keys(f)) set.add(k)
  }
  eat(def.name)
  eat(def.description)
  for (const s of def.stages) eat(s.name)
  for (const n of def.nodes) eat(n.name)
  return [...set]
}

/** 顶栏「编辑语言」下拉：列出软件受支持语言 ∪ 包已带的开放语言键；选中哪个就编辑哪个语言（单栏）。 */
function WfLangSelect({
  langs,
  value,
  onChange
}: {
  langs: string[]
  value: string
  onChange: (l: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[12px] text-stone-600">{t('workflowEditor.editLanguage')}</span>
      <select
        className="rounded border border-stone-300 bg-canvas px-1.5 py-0.5 text-[12px] text-ink"
        aria-label={t('workflowEditor.editLanguageAria')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {langs.map((l) => (
          <option key={l} value={l}>
            {wfLangLabel(l)}
          </option>
        ))}
      </select>
    </label>
  )
}

function executorLabels(t: TFunction): Record<ExecutorKind, string> {
  return {
    agent: 'Agent',
    engine: t('workflowEditor.executorEngine'),
    command: t('workflowEditor.executorCommand'),
    subworkflow: t('workflowEditor.executorSubworkflow')
  }
}

/**
 * 节点详情「可写范围 / 产出 / 检查」三块的显隐：由当前执行者的能力驱动（见 workflow-definition「引擎内置操作的能力声明」）。
 * agent 三块全显（会写代码/交付文档/受门约束）；engine 按所选操作的能力逐块决定，未选操作三项皆否 → 全隐；
 * subworkflow 三块全隐——只是委派给另一条工作流，三件事由被调工作流内部各节点承担；command 全显（任意命令可能写盘/产出/受门）。
 */
function nodeSectionVisibility(executor: NodeExecutor): {
  writableScope: boolean
  outputs: boolean
  gate: boolean
} {
  if (executor.kind === 'engine') {
    const cap = engineOpCapabilities(executor.operation)
    return { writableScope: cap.supportsWritableScope, outputs: cap.producesOutputs, gate: cap.supportsGate }
  }
  if (executor.kind === 'subworkflow') {
    return { writableScope: false, outputs: false, gate: false }
  }
  return { writableScope: true, outputs: true, gate: true }
}

function defaultExecutor(kind: ExecutorKind, others: WorkflowSummary[]): NodeExecutor {
  switch (kind) {
    case 'agent':
      return { kind: 'agent', instruction: { kind: 'inline', text: '' } }
    case 'engine':
      return { kind: 'engine', operation: '' }
    case 'command':
      return { kind: 'command', commands: [{ command: '' }] }
    case 'subworkflow':
      return { kind: 'subworkflow', workflowId: others[0]?.id ?? '' }
  }
}

// 品牌：canvas 底输入 + stone-300 边、聚焦 cobalt（均为随主题翻色的语义令牌，勿用 bg-white 等死值）；字段标签为标题式（见 labelCls）；字段组复用 ListEditor。
// 统一输入高度 h-8（32px），与全局 inputClass 一致。
const inputCls =
  'h-8 w-full rounded border border-stone-300 bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-cobalt-500'
// 下拉与输入严格等高（h-8 定死，抹平 input/select 浏览器默认盒高差）——按内容自适应宽度。
const selectCls =
  'h-8 rounded border border-stone-300 bg-canvas px-2 text-[13px] text-ink outline-none focus:border-cobalt-500'
// 字段标签：标题式（品牌规范第 12 章）——13/600/ink，不再用小号大写描边。
const labelCls = 'mb-1 block text-[13px] font-semibold text-ink'
const ghostBtn = 'text-[12px] font-medium text-cobalt-500 hover:underline'
const segBtn = (on: boolean): string =>
  `rounded px-2 py-0.5 text-[12px] ${on ? 'bg-cobalt-500 text-white' : 'bg-stone-100 text-ink'}`

const iconDelCls =
  'grid h-7 w-7 shrink-0 place-items-center rounded text-stone-600 hover:bg-danger/10 hover:text-danger'

/** 字段组：复用品牌「头 + 行」列表编辑器（第 12 章）——头(标题·描述·计数仅>0) + 行 + 末行小「加」按钮，不再套盒。 */
function FieldGroup({
  title,
  hint,
  count,
  addLabel,
  onAdd,
  level = 1,
  children
}: {
  title: string
  hint?: string
  count: number
  addLabel: string
  onAdd: () => void
  /** 节点详情内的子列表传 2（缩进由父详情负责，头更小、无底线）。 */
  level?: 1 | 2
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <ListEditor title={title} description={hint} count={count} level={level} addLabel={addLabel} onAdd={onAdd}>
      {children}
    </ListEditor>
  )
}

/**
 * 工作流包内文件的「使用文件」管理子界面（未选定时新建/导入；已选定时只显文件名、可查看与移除）。
 * agent skill 与产出模板共用；`noun` 参数化按钮/标签文案。底层复用 createSkillFile/importSkillFile/readSkillFile。
 */
function PackageFileField({
  workflowId,
  path,
  noun,
  onChange
}: {
  workflowId: string
  path: string
  noun: string
  onChange: (path: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [adding, setAdding] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [viewContent, setViewContent] = useState<string | null>(null)

  if (path === '') {
    return (
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-stone-300 bg-canvas px-2.5 py-1 text-[12px] text-ink hover:border-ink"
          >
            {t('workflowEditor.newNoun', { noun })}
          </button>
          <button
            type="button"
            onClick={async () => {
              const rel = await window.klarit.importSkillFile(workflowId)
              if (rel) onChange(rel)
            }}
            className="rounded border border-stone-300 bg-canvas px-2.5 py-1 text-[12px] text-ink hover:border-ink"
          >
            {t('workflowEditor.importFile')}
          </button>
        </div>
        {adding && (
          <div className="space-y-1 rounded border border-stone-100 p-2">
            <input
              className={inputCls}
              value={newName}
              aria-label={t('workflowEditor.nounFileName', { noun })}
              placeholder={t('workflowEditor.fileNamePlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
            />
            <textarea
              className={`${inputCls} min-h-12`}
              value={newContent}
              aria-label={t('workflowEditor.nounContent', { noun })}
              placeholder={t('workflowEditor.writeNounContent', { noun })}
              onChange={(e) => setNewContent(e.target.value)}
            />
            <button
              type="button"
              disabled={newName.trim() === ''}
              onClick={async () => {
                const rel = await window.klarit.createSkillFile(workflowId, newName.trim(), newContent)
                onChange(rel)
                setAdding(false)
                setNewName('')
                setNewContent('')
              }}
              className="rounded bg-cobalt-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-cobalt-600 disabled:opacity-50"
            >
              {t('workflowEditor.saveNoun', { noun })}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            if (!viewing && viewContent === null) {
              setViewContent(
                (await window.klarit.readSkillFile(workflowId, path)) ?? t('workflowEditor.cannotReadContent')
              )
            }
            setViewing((v) => !v)
          }}
          className="flex-1 truncate rounded border border-stone-300 bg-canvas px-2.5 py-1 text-left text-[13px] text-cobalt-500 hover:border-cobalt-300"
        >
          {path.split('/').pop()}
        </button>
        <button
          type="button"
          aria-label={t('workflowEditor.removeNounFile', { noun })}
          onClick={() => {
            onChange('')
            setViewing(false)
            setViewContent(null)
          }}
          className="text-danger hover:opacity-70"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {viewing && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-stone-100 bg-paper p-2 text-[12px] text-ink">
          {viewContent ?? t('common.loading')}
        </pre>
      )}
    </div>
  )
}

/**
 * 工作流「建议 leaf 类型」编辑：声明这条工作流默认带哪些流通类型；项目首次激活该工作流时幂等播种进项目。
 * archetype 固定 leaf；id 由名称派生并在本列表内去重（容器/epic 为内置通用类型，不在此声明）。
 */
// 建议类型 id 由名称派生并在列表内去重；archetype 保留各项选择。
function withSuggestedIds(rows: CardTypeDef[]): CardTypeDef[] {
  const taken: string[] = []
  return rows.map((r) => {
    const id = dedupeProposedName(toProposedName(r.name) || 'type', taken)
    taken.push(id)
    return { ...r, id }
  })
}


/** 建议需求卡类型 · 详情视图（字段多 → 独立页面；每行单输入；顶栏返回+保存）。 */
function SuggestedTypeDetail({
  type,
  index,
  onChange,
  onBack,
  onSave,
  saved
}: {
  type: CardTypeDef
  index: number
  onChange: (p: Partial<CardTypeDef>) => void
  onBack: () => void
  onSave: () => void
  saved: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const n = index + 1
  return (
    <div className="flex h-full flex-col">
      <DetailHeader backLabel={t('workflowEditor.backToTypes')} onBack={onBack} onSave={onSave} saved={saved} saveLabel={t('common.save')} savedLabel={t('workflowEditor.saved')} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <Field label={t('cardTypeLibrary.archetypeLabel')}>
          <select
            className={inputCls}
            value={type.archetype}
            aria-label={t('workflowEditor.suggestedTypeArchetypeAria', { n })}
            onChange={(e) => onChange({ archetype: e.target.value as CardTypeDef['archetype'] })}
          >
            {CARD_ARCHETYPES.map((a) => (
              <option key={a} value={a}>
                {t(`cardTypeLibrary.archetype_${a}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('cardTypeLibrary.nameLabel')}>
          <input
            className={inputCls}
            value={type.name}
            aria-label={t('workflowEditor.suggestedTypeNameAria', { n })}
            placeholder={t('workflowEditor.suggestedTypeNamePlaceholder')}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field label={t('cardTypeLibrary.colorLabel')}>
          <CardColorPicker value={(type.color ?? 'blue') as CardColorKey} onChange={(c) => onChange({ color: c })} />
        </Field>
        <Field label={t('cardTypeLibrary.descLabel')}>
          <textarea
            className={`${inputCls} min-h-16`}
            value={type.description}
            aria-label={t('workflowEditor.suggestedTypeDescAria', { n })}
            placeholder={t('workflowEditor.suggestedTypeDescPlaceholder')}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}

/** 建议需求卡类型 · 列表（只读显示名称，行尾「编辑」铅笔进详情页）。 */
function SuggestedTypesField({
  types,
  onEdit,
  onAdd,
  onDelete
}: {
  types: CardTypeDef[]
  onEdit: (i: number) => void
  onAdd: () => void
  onDelete: (i: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const list = types ?? []
  return (
    <FieldGroup
      title={t('workflowEditor.suggestedTypes')}
      hint={t('workflowEditor.suggestedTypesHint')}
      count={list.length}
      addLabel={t('workflowEditor.addSuggestedType')}
      onAdd={onAdd}
    >
      {list.length > 0 && (
        <div>
          {list.map((it, i) => (
            <ListRow key={i}>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {it.name || t('workflowEditor.suggestedTypeNamePlaceholder')}
              </span>
              <IconButton label={t('workflowEditor.editSuggestedType', { name: it.name })} onClick={() => onEdit(i)}>
                <Pencil size={15} />
              </IconButton>
              <IconButton label={t('workflowEditor.deleteSuggestedTypeAria', { n: i + 1 })} danger onClick={() => onDelete(i)}>
                <Trash2 size={15} />
              </IconButton>
            </ListRow>
          ))}
        </div>
      )}
    </FieldGroup>
  )
}

function ExecutorFields({
  workflowId,
  executor,
  others,
  detectedAgents,
  onChange
}: {
  workflowId: string
  executor: NodeExecutor
  others: WorkflowSummary[]
  detectedAgents: DetectedAgent[]
  onChange: (next: NodeExecutor) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  if (executor.kind === 'engine') {
    return (
      <label className="block">
        <span className={labelCls}>{t('workflowEditor.engineOperationSpec')}</span>
        <select
          className={inputCls}
          aria-label={t('workflowEditor.engineOperation')}
          value={executor.operation}
          onChange={(e) => onChange({ kind: 'engine', operation: e.target.value })}
        >
          <option value="">{t('workflowEditor.selectOperation')}</option>
          {ENGINE_OPERATIONS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </label>
    )
  }
  if (executor.kind === 'command') {
    const commands = executor.commands
    const toSec = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v))
    const setCmds = (next: typeof commands): void => onChange({ ...executor, commands: next })
    const patchAt = (ci: number, p: Partial<(typeof commands)[number]>): void =>
      setCmds(commands.map((c, j) => (j === ci ? { ...c, ...p } : c)))
    return (
      <FieldGroup
        title={t('workflowEditor.commandLines')}
        hint={t('workflowEditor.commandLinesHint')}
        count={commands.length}
        level={2}
        addLabel={t('workflowEditor.addCommand')}
        onAdd={() => setCmds([...commands, { command: '' }])}
      >
        <div className="space-y-1.5">
          {commands.map((c, ci) => (
            <div key={ci} className="flex items-start gap-2 border-b border-stone-100 py-1.5">
              <span className="w-4 shrink-0 pt-1.5 text-center font-mono text-[11px] text-stone-600">{ci + 1}</span>
              <div className="flex-1 space-y-1.5">
                <input
                  className={inputCls}
                  value={c.label ?? ''}
                  aria-label={t('workflowEditor.commandLabel', { ci: ci + 1 })}
                  placeholder={t('workflowEditor.commandLabelPlaceholder')}
                  onChange={(e) => patchAt(ci, { label: e.target.value.trim() === '' ? undefined : e.target.value })}
                />
                <input
                  className={`${inputCls} font-mono`}
                  value={c.command}
                  aria-label={t('workflowEditor.commandLineN', { ci: ci + 1 })}
                  placeholder={t('workflowEditor.commandPlaceholder')}
                  onChange={(e) => patchAt(ci, { command: e.target.value })}
                />
                <input
                  className={`${inputCls} font-mono`}
                  value={c.check ?? ''}
                  aria-label={t('workflowEditor.commandCheckN', { ci: ci + 1 })}
                  placeholder={t('workflowEditor.commandCheckPlaceholder')}
                  onChange={(e) => patchAt(ci, { check: e.target.value.trim() === '' ? undefined : e.target.value })}
                />
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={c.timeoutSec ?? ''}
                  aria-label={t('workflowEditor.commandTimeoutN', { ci: ci + 1 })}
                  placeholder={t('workflowEditor.timeoutPlaceholder')}
                  onChange={(e) => patchAt(ci, { timeoutSec: toSec(e.target.value) })}
                />
              </div>
              <IconButton
                label={t('workflowEditor.deleteCommand', { ci: ci + 1 })}
                danger
                onClick={() => setCmds(commands.filter((_, j) => j !== ci))}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>
        <p className="mt-1 px-1 text-[11px] leading-snug text-stone-600">{t('workflowEditor.commandCheckHint')}</p>
      </FieldGroup>
    )
  }
  if (executor.kind === 'subworkflow') {
    return (
      <label className="block">
        <span className={labelCls}>{t('workflowEditor.targetWorkflow')}</span>
        <select
          className={inputCls}
          value={executor.workflowId}
          onChange={(e) => onChange({ kind: 'subworkflow', workflowId: e.target.value })}
        >
          {others.length === 0 && <option value="">{t('workflowEditor.noOtherWorkflows')}</option>}
          {others.map((w) => (
            <option key={w.id} value={w.id}>
              {resolveLocalized(w.name, i18n.language)}
            </option>
          ))}
        </select>
      </label>
    )
  }

  // agent：驱动指令（手写/使用文件）+ 可选执行配置（工具/模型/effort/额外参数，空＝跟随全局）。
  const instr = executor.instruction
  const setInstr = (next: typeof instr): void => onChange({ ...executor, instruction: next })
  const setExec = (patch: AgentExecConfig): void => {
    const merged: AgentExecConfig = { ...executor.exec, ...patch }
    const exec: AgentExecConfig = {}
    if (merged.toolId) exec.toolId = merged.toolId
    if (merged.model) exec.model = merged.model
    if (merged.effort) exec.effort = merged.effort
    if (merged.extraArgs) exec.extraArgs = merged.extraArgs
    onChange({ ...executor, exec: Object.keys(exec).length ? exec : undefined })
  }
  // 工具来自本机检测到的 agent；模型为可输可选（建议清单随工具联动），切工具时清掉旧模型（模型标识家际不通用）。
  const toolId = executor.exec?.toolId
  const model = executor.exec?.model
  const selectedTool = detectedAgents.find((a) => a.id === toolId)
  const onToolChange = (next: string): void => {
    setExec({ toolId: next || undefined, model: next === toolId ? model : undefined })
  }
  // 已存声明但本机没检测到时仍展示该值（标「未检测到」），避免换机器时静默丢失。
  const toolMissing = toolId !== undefined && !selectedTool

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <div className="flex gap-1" role="radiogroup" aria-label={t('workflowEditor.instructionForm')}>
          <button
            type="button"
            role="radio"
            aria-checked={instr.kind === 'inline'}
            onClick={() => setInstr({ kind: 'inline', text: instr.kind === 'inline' ? instr.text : '' })}
            className={segBtn(instr.kind === 'inline')}
          >
            {t('workflowEditor.handwritten')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={instr.kind === 'file'}
            onClick={() => setInstr({ kind: 'file', path: instr.kind === 'file' ? instr.path : '' })}
            className={segBtn(instr.kind === 'file')}
          >
            {t('workflowEditor.useFile')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={instr.kind === 'installed'}
            onClick={() => setInstr({ kind: 'installed', name: instr.kind === 'installed' ? instr.name : '' })}
            className={segBtn(instr.kind === 'installed')}
          >
            {t('workflowEditor.useInstalled')}
          </button>
        </div>

        {instr.kind === 'inline' ? (
          <label className="block">
            <span className={labelCls}>{t('workflowEditor.prompt')}</span>
            <textarea
              className={`${inputCls} min-h-16`}
              value={instr.text}
              aria-label={t('workflowEditor.prompt')}
              onChange={(e) => setInstr({ kind: 'inline', text: e.target.value })}
            />
          </label>
        ) : instr.kind === 'file' ? (
          <div className="space-y-1.5">
            <span className={labelCls}>{t('workflowEditor.skillFile')}</span>
            <PackageFileField
              workflowId={workflowId}
              path={instr.path}
              noun="skill"
              onChange={(path) => setInstr({ kind: 'file', path })}
            />
          </div>
        ) : (
          <label className="block">
            <span className={labelCls}>{t('workflowEditor.installedSkill')}</span>
            <input
              className={inputCls}
              value={instr.name}
              aria-label={t('workflowEditor.installedSkill')}
              placeholder={t('workflowEditor.installedSkillPlaceholder')}
              onChange={(e) => setInstr({ kind: 'installed', name: e.target.value })}
            />
            <span className="mt-1 block text-[12px] text-stone-500">{t('workflowEditor.installedSkillHint')}</span>
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        <span className={labelCls}>{t('workflowEditor.execConfig')}</span>
        <div className="space-y-1.5">
          <select
            className={inputCls}
            aria-label={t('workflowEditor.execTool')}
            value={toolId ?? ''}
            onChange={(e) => onToolChange(e.target.value)}
          >
            <option value="">{t('workflowEditor.followGlobal')}</option>
            {detectedAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            {toolMissing && (
              <option value={toolId}>{t('workflowEditor.notDetected', { value: toolId })}</option>
            )}
          </select>
          <ModelCombobox
            id="workflow-exec-model"
            ariaLabel={t('workflowEditor.execModel')}
            value={model ?? ''}
            suggestions={selectedTool?.models ?? []}
            placeholder={t('workflowEditor.followGlobal')}
            allowEmpty
            onCommit={(next) => setExec({ model: next || undefined })}
          />
          <select
            className={inputCls}
            aria-label={t('workflowEditor.execEffort')}
            value={executor.exec?.effort ?? ''}
            onChange={(e) => setExec({ effort: coerceEffort(e.target.value) })}
          >
            <option value="">{t('workflowEditor.followGlobal')}</option>
            {EFFORT_LEVELS.map((lv) => (
              <option key={lv} value={lv}>
                {lv}
              </option>
            ))}
          </select>
        </div>
        <input
          className={inputCls}
          aria-label={t('workflowEditor.extraArgs')}
          value={executor.exec?.extraArgs ?? ''}
          placeholder={t('workflowEditor.extraArgsPlaceholder')}
          onChange={(e) => setExec({ extraArgs: e.target.value || undefined })}
        />
      </div>
    </div>
  )
}

/** 从规则库按类型列条目、以全限定 `{packId,itemId}` 选择；引用的条目本机缺失时仍展示并标注。 */
function RefSelect({
  items,
  value,
  ariaLabel,
  onPick
}: {
  items: Array<{ packId: string; item: RulePackItem }>
  value?: RulePackItemRef
  ariaLabel: string
  onPick: (ref: RulePackItemRef) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const idx = value ? items.findIndex((x) => x.packId === value.packId && x.item.id === value.itemId) : -1
  const selectVal = idx >= 0 ? String(idx) : value ? 'missing' : ''
  return (
    <select
      className={inputCls}
      aria-label={ariaLabel}
      value={selectVal}
      onChange={(e) => {
        const v = e.target.value
        if (v === '' || v === 'missing') return
        const i = Number(v)
        if (items[i]) onPick({ packId: items[i].packId, itemId: items[i].item.id })
      }}
    >
      <option value="" disabled>
        {t('workflowEditor.selectRulePackItem')}
      </option>
      {items.map((x, i) => (
        <option key={`${x.packId}/${x.item.id}`} value={i}>
          {resolveLocalized(x.item.name, i18n.language)}
        </option>
      ))}
      {value && idx < 0 && (
        <option value="missing">{t('workflowEditor.missingItem', { value: value.itemId })}</option>
      )}
    </select>
  )
}

/**
 * 产出模板：只「不声明」或「从规则库引用」。模板内容统一住在规则库——「新建/编辑」直接把内容写进规则库再引用，
 * 工作流本身不嵌入模板（单一来源）。
 */
function TemplateField({
  template,
  index,
  rulePacks,
  onRulePacksChanged,
  onChange
}: {
  template: OutputTemplate
  index: number
  rulePacks: RulePack[]
  onRulePacksChanged: () => Promise<void>
  onChange: (next: OutputTemplate) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  // 工作流内嵌的模板表单是单语言（按当前界面语言编辑）：读时解析、写时合并进语言表并保留其它语言。
  const mergeLang = (base: Localized | undefined, value: string): Localized => {
    const next = { ...(base ?? {}) }
    if (value.trim() === '') delete next[lang]
    else next[lang] = value
    return next
  }
  const kind = template?.kind ?? 'none'
  const currentRef = template.kind === 'ref' ? template.ref : undefined
  const currentItem = currentRef
    ? rulePacks.find((p) => p.id === currentRef.packId)?.items.find((it) => it.id === currentRef.itemId)
    : undefined
  const [form, setForm] = useState<{ mode: 'new' | 'edit'; packId: string; name: string; content: string } | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)

  const saveToLibrary = async (): Promise<void> => {
    if (!form) return
    const fresh = await window.klarit.allRulePacks()
    const pack = fresh.find((p) => p.id === form.packId)
    if (!pack) {
      setFormErr(t('workflowEditor.selectRulePack'))
      return
    }
    const itemId = form.mode === 'edit' && currentRef ? currentRef.itemId : crypto.randomUUID()
    const items =
      form.mode === 'new'
        ? [
            ...pack.items,
            {
              kind: 'output-template' as const,
              id: itemId,
              name: mergeLang(undefined, form.name),
              content: mergeLang(undefined, form.content)
            }
          ]
        : pack.items.map((it) =>
            it.id === itemId && it.kind === 'output-template'
              ? { ...it, name: mergeLang(it.name, form.name), content: mergeLang(it.content, form.content) }
              : it
          )
    const r = await window.klarit.saveRulePack({ ...pack, items })
    if (!r.ok) {
      setFormErr(r.reason)
      return
    }
    await onRulePacksChanged()
    onChange({ kind: 'ref', ref: { packId: form.packId, itemId } })
    setForm(null)
    setFormErr(null)
  }

  return (
    <div>
      <span className={labelCls}>{t('workflowEditor.template')}</span>
      <div className="flex gap-1" role="radiogroup" aria-label={t('workflowEditor.templateForm', { n: index + 1 })}>
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'none'}
          onClick={() => {
            onChange({ kind: 'none' })
            setForm(null)
          }}
          className={segBtn(kind === 'none')}
        >
          {t('workflowEditor.noDeclaration')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'ref'}
          onClick={() => onChange({ kind: 'ref', ref: currentRef ?? { packId: '', itemId: '' } })}
          className={segBtn(kind === 'ref')}
        >
          {t('workflowEditor.refFromRulePack')}
        </button>
      </div>
      {kind === 'ref' && (
        <div className="mt-1 space-y-1">
          <div className="flex gap-1">
            <RefSelect
              items={listItemsByKind(rulePacks, 'output-template')}
              value={currentRef}
              ariaLabel={t('workflowEditor.templateRef', { n: index + 1 })}
              onPick={(ref) => onChange({ kind: 'ref', ref })}
            />
            <button
              type="button"
              onClick={() => {
                setForm({ mode: 'new', packId: rulePacks[0]?.id ?? '', name: '', content: '' })
                setFormErr(null)
              }}
              className="shrink-0 rounded border border-stone-300 bg-canvas px-2.5 py-1 text-[12px] text-ink hover:border-ink"
            >
              {t('common.add')}
            </button>
            {currentItem?.kind === 'output-template' && (
              <button
                type="button"
                onClick={() => {
                  setForm({
                    mode: 'edit',
                    packId: currentRef!.packId,
                    name: resolveLocalized(currentItem.name, lang),
                    content: resolveLocalized(currentItem.content, lang)
                  })
                  setFormErr(null)
                }}
                className="shrink-0 rounded border border-stone-300 bg-canvas px-2.5 py-1 text-[12px] text-ink hover:border-ink"
              >
                {t('common.edit')}
              </button>
            )}
          </div>
          {form && (
            <div className="space-y-1 rounded border border-stone-100 p-2">
              {form.mode === 'new' && (
                <select
                  className={inputCls}
                  aria-label={t('workflowEditor.newTemplateSavePack', { n: index + 1 })}
                  value={form.packId}
                  onChange={(e) => setForm({ ...form, packId: e.target.value })}
                >
                  <option value="" disabled>
                    {t('workflowEditor.selectSaveRulePack')}
                  </option>
                  {rulePacks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {resolveLocalized(p.name, lang)}
                    </option>
                  ))}
                </select>
              )}
              <input
                className={inputCls}
                aria-label={t('workflowEditor.templateItemName', { n: index + 1 })}
                placeholder={t('workflowEditor.templateNamePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <textarea
                className={`${inputCls} min-h-12`}
                aria-label={t('workflowEditor.templateItemContent', { n: index + 1 })}
                placeholder={t('workflowEditor.templateContentPlaceholder')}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
              {formErr && <p className="text-[11px] text-danger">{formErr}</p>}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={form.name.trim() === '' || form.packId === ''}
                  onClick={saveToLibrary}
                  className="rounded bg-cobalt-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-cobalt-600 disabled:opacity-50"
                >
                  {t('workflowEditor.saveToRuleLibrary')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForm(null)
                    setFormErr(null)
                  }}
                  className={ghostBtn}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OutputsEditor({
  outputs,
  rulePacks,
  onRulePacksChanged,
  level = 1,
  onChange
}: {
  outputs: WorkflowOutput[]
  rulePacks: RulePack[]
  onRulePacksChanged: () => Promise<void>
  level?: 1 | 2
  onChange: (next: WorkflowOutput[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const patch = (i: number, p: Partial<WorkflowOutput>): void =>
    onChange(outputs.map((o, j) => (j === i ? { ...o, ...p } : o)))
  return (
    <FieldGroup
      title={t('workflowEditor.outputs')}
      count={outputs.length}
      level={level}
      addLabel={t('workflowEditor.addOutput')}
      onAdd={() =>
        onChange([...outputs, { destination: { kind: 'file', path: '' }, template: { kind: 'none' }, required: false }])
      }
    >
      {outputs.length > 0 && (
        <div>
          {outputs.map((o, i) => (
            <div key={i} className="space-y-2 border-b border-stone-100 px-1 py-2.5 hover:bg-stone-100/45">
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-center font-mono text-[11px] text-stone-600">{i + 1}</span>
                {/* 同项内有常存控件（模板/必选），路径也用常存输入框，不与点击编辑混用 */}
                <input
                  className={`${inputCls} flex-1 font-mono ${
                    o.destination.path.trim() !== '' && !isSafeRelativePath(o.destination.path)
                      ? 'border-danger focus:border-danger'
                      : ''
                  }`}
                  value={o.destination.path}
                  aria-label={t('workflowEditor.outputPath', { n: i + 1 })}
                  aria-invalid={o.destination.path.trim() !== '' && !isSafeRelativePath(o.destination.path)}
                  placeholder={t('workflowEditor.outputPathPlaceholder')}
                  onChange={(e) => patch(i, { destination: { kind: 'file', path: e.target.value } })}
                />
                <IconButton
                  label={t('workflowEditor.deleteOutput', { n: i + 1 })}
                  danger
                  onClick={() => onChange(outputs.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              <TemplateField
                template={o.template}
                index={i}
                rulePacks={rulePacks}
                onRulePacksChanged={onRulePacksChanged}
                onChange={(template) => patch(i, { template })}
              />
              <label className="flex items-center gap-1.5 text-[12px] text-stone-600">
                <input
                  type="checkbox"
                  checked={o.required}
                  aria-label={t('workflowEditor.outputRequired', { n: i + 1 })}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                />
                {t('workflowEditor.required')}
              </label>
            </div>
          ))}
        </div>
      )}
    </FieldGroup>
  )
}

function GateEditor({
  gate,
  outputs,
  rulePacks,
  level = 1,
  onChange
}: {
  gate: WorkflowGateItem[]
  outputs: WorkflowOutput[]
  rulePacks: RulePack[]
  level?: 1 | 2
  onChange: (next: WorkflowGateItem[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const patch = (i: number, next: WorkflowGateItem): void => onChange(gate.map((x, j) => (j === i ? next : x)))
  const outputPaths = outputs.map((o) => o.destination.path).filter((p) => p.trim() !== '')
  const checks = listItemsByKind(rulePacks, 'objective-check')
  return (
    <FieldGroup
      title={t('workflowEditor.checks')}
      hint={t('workflowEditor.checksHint')}
      count={gate.length}
      level={level}
      addLabel={t('workflowEditor.addCheck')}
      onAdd={() => onChange([...gate, { kind: 'auto', check: { kind: 'inline', command: '' }, targets: [] }])}
    >
      {gate.length > 0 && (
        <div>
          {gate.map((g, i) => (
            <div key={i} className="space-y-2 border-b border-stone-100 px-1 py-2.5 hover:bg-stone-100/45">
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-center font-mono text-[11px] text-stone-600">{i + 1}</span>
                <select
                  className={`${inputCls} flex-1`}
                  value={g.kind}
                  aria-label={t('workflowEditor.checkType', { n: i + 1 })}
                  onChange={(e) =>
                    patch(
                      i,
                      e.target.value === 'auto'
                        ? { kind: 'auto', check: { kind: 'inline', command: '' }, targets: [] }
                        : e.target.value === 'external'
                          ? { kind: 'external', verify: 'pr-merged' }
                          : { kind: 'manual', actions: [{ label: '', command: '' }] }
                    )
                  }
                >
                  <option value="auto">{t('workflowEditor.autoCheck')}</option>
                  <option value="manual">{t('workflowEditor.manualReview')}</option>
                  <option value="external">{t('workflowEditor.externalGate')}</option>
                </select>
                <button
                  type="button"
                  aria-label={t('workflowEditor.deleteCheck', { n: i + 1 })}
                  onClick={() => onChange(gate.filter((_, j) => j !== i))}
                  className={iconDelCls}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {g.kind === 'auto' ? (
                <div className="space-y-1.5">
                  <div className="flex gap-1" role="radiogroup" aria-label={t('workflowEditor.checkForm', { n: i + 1 })}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={g.check.kind === 'inline'}
                      onClick={() =>
                        patch(i, { ...g, check: { kind: 'inline', command: g.check.kind === 'inline' ? g.check.command : '' } })
                      }
                      className={segBtn(g.check.kind === 'inline')}
                    >
                      {t('workflowEditor.commandLine')}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={g.check.kind === 'ref'}
                      onClick={() =>
                        patch(i, { ...g, check: { kind: 'ref', ref: g.check.kind === 'ref' ? g.check.ref : { packId: '', itemId: '' } } })
                      }
                      className={segBtn(g.check.kind === 'ref')}
                    >
                      {t('workflowEditor.refFromRulePack')}
                    </button>
                  </div>
                  {g.check.kind === 'inline' ? (
                    <input
                      className={`${inputCls} font-mono`}
                      value={g.check.command}
                      aria-label={t('workflowEditor.checkCommand', { n: i + 1 })}
                      placeholder={t('workflowEditor.checkCommandPlaceholder')}
                      onChange={(e) => patch(i, { ...g, check: { kind: 'inline', command: e.target.value } })}
                    />
                  ) : (
                    <RefSelect
                      items={checks}
                      value={g.check.ref}
                      ariaLabel={t('workflowEditor.checkRef', { n: i + 1 })}
                      onPick={(ref) => patch(i, { ...g, check: { kind: 'ref', ref } })}
                    />
                  )}
                  <label className="block">
                    <span className="text-[11px] text-stone-600">{t('workflowEditor.commandTimeout')}</span>
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={g.timeoutSec ?? ''}
                      placeholder={t('workflowEditor.timeoutPlaceholder')}
                      aria-label={t('workflowEditor.checkTimeout', { n: i + 1 })}
                      onChange={(e) =>
                        patch(i, { ...g, timeoutSec: e.target.value.trim() === '' ? undefined : Number(e.target.value) })
                      }
                    />
                  </label>
                  {outputPaths.length > 0 && (
                    <div className="space-y-0.5">
                      <span className="text-[11px] text-stone-600">{t('workflowEditor.checkTargets')}</span>
                      {outputPaths.map((p) => {
                        const checked = (g.targets ?? []).includes(p)
                        return (
                          <label key={p} className="flex items-center gap-1.5 text-[12px] text-ink">
                            <input
                              type="checkbox"
                              checked={checked}
                              aria-label={t('workflowEditor.checkTarget', { n: i + 1, path: p })}
                              onChange={(e) => {
                                const set = new Set(g.targets ?? [])
                                if (e.target.checked) set.add(p)
                                else set.delete(p)
                                patch(i, { ...g, targets: [...set] })
                              }}
                            />
                            {p}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : g.kind === 'manual' ? (
                <FieldGroup
                  title={t('workflowEditor.actionButtons')}
                  hint={t('workflowEditor.actionButtonsHint')}
                  count={(g.actions ?? []).length}
                  addLabel={t('workflowEditor.addActionButton')}
                  onAdd={() => patch(i, { ...g, actions: [...(g.actions ?? []), { label: '', command: '' }] })}
                >
                  {(g.actions ?? []).length > 0 && (
                    <div className="space-y-1.5">
                      {(g.actions ?? []).map((a, ai) => (
                        // 设置界面每行单输入：文案、命令各占一行（不并列）。
                        <div key={ai} className="flex items-start gap-2 border-b border-stone-100 py-1.5">
                          <span className="w-4 shrink-0 pt-1.5 text-center font-mono text-[11px] text-stone-600">
                            {ai + 1}
                          </span>
                          {/* 同项内有常存控件（检查项类型/形态），文案与命令也用常存输入框，不与点击编辑混用 */}
                          <div className="flex-1 space-y-1.5">
                            <input
                              className={inputCls}
                              value={a.label}
                              aria-label={t('workflowEditor.actionName', { i: i + 1, ai: ai + 1 })}
                              placeholder={t('workflowEditor.actionLabelPlaceholder')}
                              onChange={(e) =>
                                patch(i, { ...g, actions: (g.actions ?? []).map((x, j) => (j === ai ? { ...x, label: e.target.value } : x)) })
                              }
                            />
                            <input
                              className={`${inputCls} font-mono`}
                              value={a.command}
                              aria-label={t('workflowEditor.actionCommand', { i: i + 1, ai: ai + 1 })}
                              placeholder={t('workflowEditor.actionCommandPlaceholder')}
                              onChange={(e) =>
                                patch(i, { ...g, actions: (g.actions ?? []).map((x, j) => (j === ai ? { ...x, command: e.target.value } : x)) })
                              }
                            />
                            <input
                              type="number"
                              min={1}
                              className={inputCls}
                              value={a.timeoutSec ?? ''}
                              aria-label={t('workflowEditor.actionTimeout', { i: i + 1, ai: ai + 1 })}
                              placeholder={t('workflowEditor.timeoutPlaceholder')}
                              onChange={(e) =>
                                patch(i, {
                                  ...g,
                                  actions: (g.actions ?? []).map((x, j) =>
                                    j === ai ? { ...x, timeoutSec: e.target.value.trim() === '' ? undefined : Number(e.target.value) } : x
                                  )
                                })
                              }
                            />
                          </div>
                          <IconButton
                            label={t('workflowEditor.deleteAction', { i: i + 1, ai: ai + 1 })}
                            danger
                            onClick={() => patch(i, { ...g, actions: (g.actions ?? []).filter((_, j) => j !== ai) })}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      ))}
                    </div>
                  )}
                </FieldGroup>
              ) : (
                // 外部门：v1 只等「PR 已在平台合并」，无可编辑字段，给一句自描述。
                <p className="text-[12px] leading-relaxed text-stone-600">{t('workflowEditor.externalGateHint')}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </FieldGroup>
  )
}

/**
 * archive-docs 归档文档清单编辑：一行一条 `{ path, kind }`——路径输入 + 动态/快照选择 + 删除，末行「加文档」。
 * 空时给空态提示（回落文档扫描登记表）。仅 archive-docs 引擎节点渲染（显隐由父详情判断）。
 */
function ArchiveDocsEditor({
  entries,
  onChange
}: {
  entries: ArchiveDocEntry[]
  onChange: (next: ArchiveDocEntry[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const patch = (i: number, p: Partial<ArchiveDocEntry>): void =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...p } : e)))
  return (
    <FieldGroup
      title={t('workflowEditor.archiveDocsTitle')}
      hint={t('workflowEditor.archiveDocsHint')}
      count={entries.length}
      addLabel={t('workflowEditor.archiveDocsAdd')}
      onAdd={() => onChange([...entries, { path: '', kind: 'dynamic' }])}
    >
      {entries.length === 0 ? (
        <p className="px-1 py-2 text-[12px] leading-normal text-stone-600">{t('workflowEditor.archiveDocsEmpty')}</p>
      ) : (
        <div>
          {entries.map((e, i) => (
            <ListRow key={i} ordinal={i + 1}>
              <input
                className={`${inputCls} flex-1 font-mono ${
                  e.path.trim() !== '' && !isSafeRelativePath(e.path) ? 'border-danger focus:border-danger' : ''
                }`}
                value={e.path}
                aria-label={t('workflowEditor.archiveDocsPath', { n: i + 1 })}
                aria-invalid={e.path.trim() !== '' && !isSafeRelativePath(e.path)}
                placeholder={t('workflowEditor.archiveDocsPathPlaceholder')}
                onChange={(ev) => patch(i, { path: ev.target.value })}
              />
              <select
                className={selectCls}
                value={e.kind}
                aria-label={t('workflowEditor.archiveDocsKind', { n: i + 1 })}
                onChange={(ev) => patch(i, { kind: ev.target.value as ArchiveDocEntry['kind'] })}
              >
                <option value="dynamic">{t('workflowEditor.archiveDocsKindDynamic')}</option>
                <option value="snapshot">{t('workflowEditor.archiveDocsKindSnapshot')}</option>
              </select>
              <IconButton
                label={t('workflowEditor.archiveDocsDelete', { n: i + 1 })}
                danger
                onClick={() => onChange(entries.filter((_, j) => j !== i))}
              >
                <Trash2 size={15} />
              </IconButton>
            </ListRow>
          ))}
        </div>
      )}
    </FieldGroup>
  )
}

/** 节点详情视图：进入后编辑该节点全部字段；顶部「返回节点列表」。字段组在此为第一级。 */
function NodeDetail({
  node,
  stages,
  workflowId,
  others,
  detectedAgents,
  rulePacks,
  onRulePacksChanged,
  onChange,
  onBack,
  onSave,
  saved,
  lang,
  langs,
  onLangChange
}: {
  node: WorkflowNode
  stages: WorkflowStage[]
  workflowId: string
  others: WorkflowSummary[]
  detectedAgents: DetectedAgent[]
  rulePacks: RulePack[]
  onRulePacksChanged: () => Promise<void>
  onChange: (next: WorkflowNode) => void
  onBack: () => void
  onSave: () => void
  saved: boolean
  lang: string
  langs: string[]
  onLangChange: (l: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const EXECUTOR_LABELS = executorLabels(t)
  const scope = node.writableScope ?? []
  // 三块（可写范围/产出/检查）按执行者能力显隐：engine 操作不需要时隐藏，避免误导用户填永不被消费的设置。
  const sections = nodeSectionVisibility(node.executor)
  // 「查看完整 prompt」预览：null＝未打开；打开后先 null（加载中），拿到结果填入。传当前（含未保存）节点。
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const openPreview = async (): Promise<void> => {
    setPreviewOpen(true)
    setPreviewText(null)
    try {
      setPreviewText(await window.klarit.previewAgentNodePrompt(workflowId, node))
    } catch (err) {
      // IPC 失败（如主进程未注册该 handler）兜底显错，避免无限「加载中」。
      setPreviewText(t('workflowEditor.promptPreviewError', { message: String(err) }))
    }
  }
  return (
    <div className="flex h-full flex-col">
      {previewOpen && (
        <PromptPreviewModal text={previewText} onClose={() => setPreviewOpen(false)} />
      )}
      <DetailHeader
        backLabel={t('workflowEditor.backToNodes')}
        onBack={onBack}
        onSave={onSave}
        saved={saved}
        saveLabel={t('common.save')}
        savedLabel={t('workflowEditor.saved')}
        extraActions={
          <div className="flex items-center gap-2">
            <WfLangSelect langs={langs} value={lang} onChange={onLangChange} />
            {node.executor.kind === 'agent' && (
              <IconButton label={t('workflowEditor.viewFullPrompt')} onClick={openPreview}>
                <FileText size={16} />
              </IconButton>
            )}
          </div>
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {/* 设置界面每行单输入：名称/阶段/类型各占一行，不并列。 */}
        <Field label={t('workflowEditor.nodeName')}>
          <LocalizedTextInput
            value={node.name}
            lang={lang}
            ariaLabel={t('workflowEditor.nodeName')}
            onChange={(next) => onChange({ ...node, name: next })}
          />
        </Field>
        <Field label={t('workflowEditor.belongingStage')}>
          <select
            className={`${selectCls} w-full`}
            aria-label={t('workflowEditor.belongingStage')}
            value={node.stageId}
            onChange={(e) => onChange({ ...node, stageId: e.target.value })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {resolveLocalized(s.name, i18n.language)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('workflowEditor.executorType')}>
          <select
            className={`${selectCls} w-full`}
            aria-label={t('workflowEditor.executorType')}
            value={node.executor.kind}
            onChange={(e) => onChange({ ...node, executor: defaultExecutor(e.target.value as ExecutorKind, others) })}
          >
            {(Object.keys(EXECUTOR_LABELS) as ExecutorKind[]).map((k) => (
              <option key={k} value={k}>
                {EXECUTOR_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>

        <ExecutorFields
          workflowId={workflowId}
          executor={node.executor}
          others={others}
          detectedAgents={detectedAgents}
          onChange={(executor) => onChange({ ...node, executor })}
        />

        {/* 目标仓（多仓扇出）：仅引擎操作节点需要。本轮支持 all / tag 两模式（repo / fromUpstream 经 yaml）。 */}
        {node.executor.kind === 'engine' && (
          <Field label={t('workflowEditor.targetRepos')} description={t('workflowEditor.targetReposHint')}>
            <select
              className={`${selectCls} w-full`}
              aria-label={t('workflowEditor.targetRepos')}
              value={node.target?.kind === 'tag' ? 'tag' : 'all'}
              onChange={(e) =>
                onChange({
                  ...node,
                  target: e.target.value === 'tag' ? { kind: 'tag', tag: '' } : undefined
                })
              }
            >
              <option value="all">{t('workflowEditor.targetAll')}</option>
              <option value="tag">{t('workflowEditor.targetTag')}</option>
            </select>
            {node.target?.kind === 'tag' && (
              <input
                className={`${inputCls} mt-2`}
                aria-label={t('workflowEditor.targetTagName')}
                placeholder={t('workflowEditor.targetTagPlaceholder')}
                value={node.target.tag}
                onChange={(e) => onChange({ ...node, target: { kind: 'tag', tag: e.target.value } })}
              />
            )}
          </Field>
        )}

        {/* 归档文档清单：仅引擎操作 archive-docs 节点显示（author 产出/用户手改的归档配置可见可改）。 */}
        {node.executor.kind === 'engine' && node.executor.operation === 'archive-docs' && (
          <ArchiveDocsEditor
            entries={node.executor.archiveDocs ?? []}
            onChange={(archiveDocs) => onChange({ ...node, executor: { kind: 'engine', operation: 'archive-docs', archiveDocs } })}
          />
        )}

        {sections.writableScope && (
          <FieldGroup
            title={t('workflowEditor.writableScope')}
            hint={t('workflowEditor.writableScopeHint')}
            count={scope.length}
            addLabel={t('workflowEditor.addWritablePath')}
            onAdd={() => onChange({ ...node, writableScope: [...scope, ''] })}
          >
            {scope.length > 0 && (
              <div>
                {scope.map((p, i) => (
                  <ListRow key={i} ordinal={i + 1}>
                    <InlineCell
                      value={p}
                      grow
                      mono
                      autoEditEmpty
                      validate={(v) => v.trim() === '' || isSafeRelativePath(v)}
                      ariaLabel={t('workflowEditor.writableScopeItem', { n: i + 1 })}
                      placeholder={t('workflowEditor.writableScopePlaceholder')}
                      onCommit={(v) => onChange({ ...node, writableScope: scope.map((x, j) => (j === i ? v : x)) })}
                    />
                    <IconButton
                      label={t('workflowEditor.deleteWritableScope', { n: i + 1 })}
                      danger
                      onClick={() => onChange({ ...node, writableScope: scope.filter((_, j) => j !== i) })}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </ListRow>
                ))}
              </div>
            )}
          </FieldGroup>
        )}

        {sections.outputs && (
          <OutputsEditor
            outputs={node.outputs ?? []}
            rulePacks={rulePacks}
            onRulePacksChanged={onRulePacksChanged}
            onChange={(outputs) => onChange({ ...node, outputs })}
          />
        )}
        {sections.gate && (
          <GateEditor
            gate={node.gate ?? []}
            outputs={node.outputs ?? []}
            rulePacks={rulePacks}
            onChange={(gate) => onChange({ ...node, gate })}
          />
        )}
      </div>
    </div>
  )
}

/** 门徽标按门类的语义令牌配色（深浅两套靠令牌覆盖；manual=cobalt 强调 / auto=stone 中性 / external=info 蓝）。 */
const GATE_BADGE_STYLES: Record<WorkflowGateItem['kind'], string> = {
  manual: 'border-cobalt-300/50 bg-cobalt-50 text-cobalt-700',
  auto: 'border-stone-300 bg-stone-100 text-stone-600',
  external: 'border-info/40 bg-info/10 text-info'
}

/** 节点列表行（只读摘要，可拖拽排序）：行1=拖拽柄·名称·阶段·编辑·删除；行2（仅有门时）=门徽标另起一行缩进。点击编辑进入详情。 */
function SortableNodeRow({
  node,
  stageName,
  lang,
  onEdit,
  onDelete
}: {
  node: WorkflowNode
  stageName: string
  lang: string
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const nodeName = resolveLocalized(node.name, lang)
  // 派生本节点挂的门类（按首次出现去重，有几类显示几类）——纯展示，不改数据模型。
  const gateKinds = Array.from(new Set((node.gate ?? []).map((g) => g.kind)))
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border-b border-stone-100 px-1 py-2 hover:bg-stone-100/45"
      data-node-id={node.id}
    >
      {/* 行1（干净）：拖拽柄 · 节点名(13/ink) · 阶段名(12/stone-600) · 编辑 · 删除。顺序由拖拽柄表达，不显序号。 */}
      <div className="flex items-center gap-2">
        <DragHandle
          label={t('workflowEditor.dragToReorder')}
          attributes={attributes as unknown as Record<string, unknown>}
          listeners={listeners as unknown as Record<string, unknown>}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{nodeName || t('workflowEditor.newNode')}</span>
          <span className="shrink-0 text-[12px] text-stone-600">{stageName}</span>
        </div>
        <IconButton label={t('workflowEditor.editNode', { name: nodeName })} onClick={onEdit}>
          <Pencil size={15} />
        </IconButton>
        <IconButton label={t('workflowEditor.deleteNode', { name: nodeName })} danger onClick={onDelete}>
          <Trash2 size={15} />
        </IconButton>
      </div>
      {/* 行2（仅有门时）：门徽标另起一行，缩进对齐到节点名下方，避免行1拥挤。 */}
      {gateKinds.length > 0 && (
        // 门徽标：区分 manual(cobalt 强调，需人拍板) / auto(stone 中性) / external(info 蓝)；小而不喧、不可交互。
        <span
          className="mt-1.5 flex flex-wrap items-center gap-1 pl-7"
          aria-label={t('workflowEditor.gateBadgeGroup')}
        >
          {gateKinds.map((kind) => (
            <span
              key={kind}
              className={`rounded-sm border px-1 py-px text-[10px] font-medium leading-none ${GATE_BADGE_STYLES[kind]}`}
            >
              {t(`workflowEditor.gateBadge${kind === 'manual' ? 'Manual' : kind === 'auto' ? 'Auto' : 'External'}`)}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

/** 阶段列表行（可拖拽排序）：拖拽柄 · 名称（行内编辑）· 删除。顺序即看板列序，不显序号。 */
function SortableStageRow({
  stage,
  index,
  canDelete,
  lang,
  onRename,
  onDelete
}: {
  stage: WorkflowStage
  index: number
  canDelete: boolean
  lang: string
  onRename: (name: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const stageName = resolveLocalized(stage.name, lang)
  // 真值＝当前语言的原值（可能空）；空时以回退值作只读显示与灰色占位，编辑从空开始、不预填污染。
  const stageRaw = stage.name[lang] ?? ''
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 border-b border-stone-100 px-1 py-1.5 hover:bg-stone-100/45"
    >
      <DragHandle
        label={t('workflowEditor.dragToReorder')}
        attributes={attributes as unknown as Record<string, unknown>}
        listeners={listeners as unknown as Record<string, unknown>}
      />
      <InlineCell
        value={stageRaw}
        display={stageRaw || stageName}
        placeholder={stageName}
        grow
        ariaLabel={t('workflowEditor.stageName', { n: index + 1 })}
        onCommit={onRename}
      />
      <IconButton label={t('workflowEditor.deleteStage', { name: stageName })} danger disabled={!canDelete} onClick={onDelete}>
        <Trash2 size={15} />
      </IconButton>
    </div>
  )
}

/** 保存前清洗：丢掉空的可写范围条目、剔除完全空白的动作按钮行、剔除命令节点里命令行为空的命令。 */
function cleanForSave(def: WorkflowDefinition): WorkflowDefinition {
  return {
    ...def,
    nodes: def.nodes.map((n) => ({
      ...n,
      writableScope: (n.writableScope ?? []).filter((p) => p.trim() !== ''),
      executor:
        n.executor.kind === 'command'
          ? { ...n.executor, commands: n.executor.commands.filter((c) => c.command.trim() !== '') }
          : n.executor,
      gate: n.gate?.map((g) =>
        g.kind === 'manual'
          ? { ...g, actions: (g.actions ?? []).filter((a) => a.label.trim() !== '' || a.command.trim() !== '') }
          : g
      )
    }))
  }
}

/**
 * agent 节点「查看完整 prompt」只读预览模态（portal 挂 body，品牌令牌；标题 + 说明 + 滚动 pre + 关闭）。
 * text 为 null 时显示加载中。点击遮罩或关闭按钮收起。
 */
function PromptPreviewModal({
  text,
  onClose
}: {
  text: string | null
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('workflowEditor.promptPreviewTitle')}
        className="flex max-h-[80vh] w-[640px] max-w-[90vw] flex-col gap-3 rounded-card border border-stone-100 bg-paper p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-ink">{t('workflowEditor.promptPreviewTitle')}</h2>
          <IconButton label={t('common.close')} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <p className="text-[12px] text-stone-600">{t('workflowEditor.promptPreviewNote')}</p>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border border-stone-100 bg-canvas p-3 text-[12px] text-ink">
          {text ?? t('common.loading')}
        </pre>
      </div>
    </div>,
    document.body
  )
}

/** 保存被语义校验拦截时的模态提示（portal 挂 body，品牌令牌；标题+原因+「知道了」）。 */
function BranchPairingDialog({
  reason,
  onClose
}: {
  reason: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('workflowEditor.cannotSaveTitle')}
        className="flex w-[420px] flex-col gap-4 rounded-card border border-stone-100 bg-paper p-5"
      >
        <div>
          <h2 className="text-[15px] font-medium text-ink">{t('workflowEditor.cannotSaveTitle')}</h2>
          <p className="mt-1 text-[13px] text-stone-600">{reason}</p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-cobalt-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600"
          >
            {t('workflowEditor.gotIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const NO_AGENTS: DetectedAgent[] = []
const NO_RULE_PACKS: RulePack[] = []

export function WorkflowEditor({
  workflowId,
  initialDef,
  chromeless = false,
  footerLabels,
  libraryFirst = false,
  onSetActive,
  isActive = false,
  others,
  detectedAgents = NO_AGENTS,
  rulePacks = NO_RULE_PACKS,
  onClose,
  onSaved
}: WorkflowEditorProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [def, setDef] = useState<WorkflowDefinition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [branchDialog, setBranchDialog] = useState<string | null>(null)
  // 当前编辑语言（默认＝界面语言）；顶栏下拉切换，各可翻字段单栏编辑该语言。
  const [editLang, setEditLang] = useState<string>(() => coerceLanguage(i18n.language))
  // 正在编辑的节点 id / 建议类型下标（非空时显示对应详情视图，替换工作流表单）。列表行只读、行尾「编辑」进入。
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingSuggestedIdx, setEditingSuggestedIdx] = useState<number | null>(null)
  // 规则库本地副本：编辑器内「新建/编辑库条目」写库后即刷新，引用选择器实时更新。
  const [packs, setPacks] = useState<RulePack[]>(rulePacks)
  useEffect(() => setPacks(rulePacks), [rulePacks])
  const reloadPacks = useCallback(async (): Promise<void> => {
    setPacks(await window.klarit.allRulePacks())
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // 只种一次 def：有 initialDef（草稿态）→ 用它种、不从库读；否则从库按 id 读。种过就不再重置——
  // 避免草稿保存后 initialDef 变化触发重载而丢掉编辑（浮层预览态）。工作流切换在设置里靠整组件重挂。
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    // 有草稿且不优先读库 → 直接用草稿种子。
    if (initialDef && !libraryFirst) {
      setDef(initialDef)
      return
    }
    // 否则从库按 id 读；读不到（已被删/不存在）回落到草稿（若有），避免卡「加载中」。
    let alive = true
    window.klarit.getWorkflow(workflowId).then((d) => {
      if (alive) setDef(d ?? initialDef ?? null)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = useCallback((fn: (d: WorkflowDefinition) => WorkflowDefinition) => {
    setDef((d) => (d ? fn(d) : d))
    setSaved(false)
  }, [])

  const updateNode = useCallback(
    (nodeId: string, next: WorkflowNode) =>
      update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId ? next : n)) })),
    [update]
  )

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      if (!e.over || e.active.id === e.over.id) return
      update((d) => {
        const from = d.nodes.findIndex((n) => n.id === e.active.id)
        const to = d.nodes.findIndex((n) => n.id === e.over!.id)
        return { ...d, nodes: reorder(d.nodes, from, to) }
      })
    },
    [update]
  )

  const onStageDragEnd = useCallback(
    (e: DragEndEvent) => {
      if (!e.over || e.active.id === e.over.id) return
      update((d) => {
        const from = d.stages.findIndex((s) => s.id === e.active.id)
        const to = d.stages.findIndex((s) => s.id === e.over!.id)
        return { ...d, stages: reorder(d.stages, from, to) }
      })
    },
    [update]
  )

  if (!def) return <p className="px-3 py-4 text-[13px] text-stone-600">{t('common.loading')}</p>

  // 可选语言 = 受支持语言 ∪ 定义里已带的语言（去重）。
  const langs = [...new Set<string>([...SUPPORTED_LANGUAGES, ...presentWfLangs(def)])]

  // 软校验告警：随编辑实时重算的**非阻断**提示（与 error 硬错误分开——warnings 永不禁用/拦截保存）。
  const lintWarnings = lintWorkflow(def)

  const save = async (): Promise<boolean> => {
    const cleaned = cleanForSave(def)
    const v = validateWorkflow(cleaned)
    if (!v.ok) {
      setError(v.reason)
      return false
    }
    // 分支配对语义校验：建分支无删分支 → 弹模态拦截、不写盘。
    const pairing = checkBranchPairing(cleaned)
    if (!pairing.ok) {
      setBranchDialog(pairing.reason)
      return false
    }
    const result = await window.klarit.saveWorkflow(cleaned)
    if (result.ok) {
      setError(null)
      setSaved(true)
      onSaved()
      return true
    }
    setError(result.reason)
    return false
  }

  // 「保存并设为本项目工作流」一键：先保存（确保入库、被校验拦下则不激活）→ 激活为本项目工作流。仅浮层预览态（onSetActive 提供）用。
  const saveAndActivate = async (): Promise<void> => {
    if (await save()) await onSetActive?.(def.id)
  }

  // 进入节点详情：替换整个编辑器视图（顶栏 返回 + 保存）。节点不存在（被删）则回落到列表。
  const editingNode = editingNodeId ? def.nodes.find((n) => n.id === editingNodeId) : null
  if (editingNode) {
    return (
      <NodeDetail
        node={editingNode}
        stages={def.stages}
        workflowId={workflowId}
        others={others}
        detectedAgents={detectedAgents}
        rulePacks={packs}
        onRulePacksChanged={reloadPacks}
        onChange={(next) => updateNode(editingNode.id, next)}
        onBack={() => setEditingNodeId(null)}
        onSave={save}
        saved={saved}
        lang={editLang}
        langs={langs}
        onLangChange={setEditLang}
      />
    )
  }

  // 进入建议类型详情（独立页面）。
  const suggestedList = def.suggestedTypes ?? []
  const editingSuggested = editingSuggestedIdx !== null ? suggestedList[editingSuggestedIdx] : undefined
  if (editingSuggested && editingSuggestedIdx !== null) {
    const idx = editingSuggestedIdx
    return (
      <SuggestedTypeDetail
        type={editingSuggested}
        index={idx}
        onChange={(p) =>
          update((d) => ({
            ...d,
            suggestedTypes: withSuggestedIds(
              (d.suggestedTypes ?? []).map((it, j) => (j === idx ? { ...it, ...p } : it))
            )
          }))
        }
        onBack={() => setEditingSuggestedIdx(null)}
        onSave={save}
        saved={saved}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {branchDialog && <BranchPairingDialog reason={branchDialog} onClose={() => setBranchDialog(null)} />}
      {chromeless ? (
        // 浮层预览态：顶栏只留「编辑语言」，返回/保存移到底部固定横栏（见下）。
        <div className="flex items-center justify-end border-b border-stone-100 px-3 py-1.5">
          <WfLangSelect langs={langs} value={editLang} onChange={setEditLang} />
        </div>
      ) : (
        <DetailHeader backLabel={t('workflowEditor.backToList')} onBack={onClose} onSave={save} saved={saved} saveLabel={t('common.save')} savedLabel={t('workflowEditor.saved')} extraActions={<WfLangSelect langs={langs} value={editLang} onChange={setEditLang} />} />
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {error && (
          <p role="alert" className="rounded border border-danger/30 bg-signal-50 px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        )}

        {/* 软校验告警：非阻断的「可用但有隐患」提示（amber warning 令牌，区别于 danger 硬错误）；永不禁用保存。 */}
        {lintWarnings.length > 0 && (
          <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-[12px]">
            <span className="font-semibold text-warning">{t('workflowEditor.advisoryTitle')}</span>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ink">
              {lintWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <label className="block">
          <span className={labelCls}>{t('workflowEditor.displayName')}</span>
          <LocalizedTextInput
            value={def.name}
            lang={editLang}
            ariaLabel={t('workflowEditor.workflowName')}
            onChange={(next) => update((d) => ({ ...d, name: next }))}
          />
        </label>
        <label className="block">
          <span className={labelCls}>{t('workflowEditor.description')}</span>
          <LocalizedTextInput
            value={def.description}
            lang={editLang}
            multiline
            ariaLabel={t('workflowEditor.workflowDescription')}
            onChange={(next) => update((d) => ({ ...d, description: next }))}
          />
        </label>

        {/* 工作流建议 leaf 类型（激活时幂等播种进项目类型集）：列表只读，行尾「编辑」进详情页 */}
        <SuggestedTypesField
          types={def.suggestedTypes ?? []}
          onEdit={(i) => setEditingSuggestedIdx(i)}
          onAdd={() => {
            const next = withSuggestedIds([
              ...suggestedList,
              { id: '', name: '', description: '', archetype: 'leaf', color: 'blue' }
            ])
            update((d) => ({ ...d, suggestedTypes: next }))
            setEditingSuggestedIdx(next.length - 1) // 新建即进入其详情页
          }}
          onDelete={(i) =>
            update((d) => ({
              ...d,
              suggestedTypes: withSuggestedIds((d.suggestedTypes ?? []).filter((_, j) => j !== i))
            }))
          }
        />

        {/* 阶段列表（看板列） */}
        <FieldGroup
          title={t('workflowEditor.stages')}
          hint={t('workflowEditor.stagesHint')}
          count={def.stages.length}
          addLabel={t('workflowEditor.addStage')}
          onAdd={() =>
            update((d) => ({
              ...d,
              stages: [...d.stages, { id: crypto.randomUUID(), name: setLocalized({}, editLang, t('workflowEditor.newStage')) }]
            }))
          }
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onStageDragEnd}>
            <SortableContext items={def.stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div>
                {def.stages.map((s, i) => (
                  <SortableStageRow
                    key={s.id}
                    stage={s}
                    index={i}
                    canDelete={def.stages.length > 1}
                    lang={editLang}
                    onRename={(name) =>
                      update((d) => ({
                        ...d,
                        stages: d.stages.map((x) => (x.id === s.id ? { ...x, name: setLocalized(x.name, editLang, name) } : x))
                      }))
                    }
                    onDelete={() =>
                      update((d) => {
                        if (d.stages.length <= 1) return d
                        const remaining = d.stages.filter((x) => x.id !== s.id)
                        const fallback = remaining[0].id
                        return {
                          ...d,
                          stages: remaining,
                          // 该阶段下的节点改投到第一个剩余阶段，避免悬挂引用。
                          nodes: d.nodes.map((n) => (n.stageId === s.id ? { ...n, stageId: fallback } : n))
                        }
                      })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </FieldGroup>

        {/* 节点列表（执行顺序；每个节点选所属阶段） */}
        <FieldGroup
          title={t('workflowEditor.nodes')}
          hint={t('workflowEditor.nodesHint')}
          count={def.nodes.length}
          addLabel={t('workflowEditor.addNode')}
          onAdd={() => {
            const id = crypto.randomUUID()
            update((d) => ({
              ...d,
              nodes: [
                ...d.nodes,
                {
                  id,
                  name: setLocalized({}, editLang, t('workflowEditor.newNode')),
                  stageId: d.stages[0]?.id ?? '',
                  executor: { kind: 'agent', instruction: { kind: 'inline', text: '' } },
                  outputs: []
                }
              ]
            }))
            setEditingNodeId(id) // 加新节点后直接进入其详情编辑
          }}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={def.nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              <div>
                {def.nodes.map((node) => (
                  <SortableNodeRow
                    key={node.id}
                    node={node}
                    lang={editLang}
                    stageName={resolveLocalized(def.stages.find((s) => s.id === node.stageId)?.name, editLang)}
                    onEdit={() => setEditingNodeId(node.id)}
                    onDelete={() => update((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== node.id) }))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </FieldGroup>
      </div>

      {chromeless && footerLabels && (
        // 固定底部横栏（不随内容滚动）：关闭 + 一个主按钮。未激活 → 「保存并设为本项目工作流」（一键保存并激活）；
        // 已是本项目活动工作流 → 「更新工作流」（仅保存）。
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-stone-200 bg-paper px-4 py-2.5">
          {error && <span className="mr-auto truncate text-[12px] text-danger">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-300 px-3.5 py-1.5 text-[13px] text-ink hover:border-cobalt-500"
          >
            {footerLabels.close}
          </button>
          {onSetActive && !isActive ? (
            // 未激活：一键保存入库并设为本项目工作流（点击即人确认，无二次确认步骤）。
            <button
              type="button"
              onClick={() => void saveAndActivate()}
              className="rounded bg-cobalt-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600"
            >
              {footerLabels.saveAndActive}
            </button>
          ) : (
            // 已是活动工作流（或无激活能力）：主按钮仅保存/更新。
            <button
              type="button"
              onClick={() => void save()}
              className="rounded bg-cobalt-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600"
            >
              {footerLabels.update}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
