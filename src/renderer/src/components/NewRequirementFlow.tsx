import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Loader2, Minus, Paperclip, X } from 'lucide-react'
import Markdown from 'react-markdown'
import type { CandidateCard } from '@shared/types'
import { useNewRequirementStore } from '../stores/newRequirement'

const inputCls =
  'w-full rounded border border-stone-300 bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-cobalt-500'
// 字段标签：标题式（品牌规范第 12 章）。
const labelCls = 'mb-1 block text-[13px] font-semibold text-ink'
const ghostBtn = 'px-2 text-[13px] text-stone-600 hover:text-ink'
const primaryBtn =
  'rounded bg-cobalt-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-600'

/** 内置默认类型的徽章配色（标签专用实色，配白字；不蹭品牌/语义色）；自定义类型回落默认标签色。 */
const TYPE_BADGE_CLS: Record<string, string> = {
  epic: 'bg-tag-violet',
  feature: 'bg-tag-green',
  bug: 'bg-tag-red'
}

/** 类型徽章：显示卡片 typeId（自定义类型亦可读）；实色背景 + 白字，inline-block + line-height 居中。 */
export function TypeBadge({ typeId }: { typeId: string }): React.JSX.Element {
  const cls = TYPE_BADGE_CLS[typeId] ?? 'bg-tag-violet'
  return (
    <span
      className={`inline-block rounded px-2 text-[10px] font-semibold uppercase leading-[18px] tracking-wide text-white ${cls}`}
    >
      {typeId || '—'}
    </span>
  )
}

/** 把候选卡描述按 markdown 渲染（非源码）；无 typography 插件，靠少量子选择器排版。 */
export function MarkdownView({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="text-[13px] leading-relaxed text-ink [&_code]:font-mono [&_h1]:mb-1 [&_h1]:text-[14px] [&_h1]:font-medium [&_h2]:mb-1 [&_h2]:text-[13px] [&_h2]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-1">
      <Markdown>{content}</Markdown>
    </div>
  )
}

/** 无蒙层的可最小化浮窗（带 — / ×），挂在主面板区内。三窗共用；全局对话面板亦复用。 */
export function FloatingWindow({
  title,
  onBack,
  onMinimize,
  onClose,
  footer,
  widthClass = 'w-[560px]',
  children
}: {
  title: string
  /** 返回上一级（内部详情视图用）：传入则标题栏左侧渲染统一 chevron 返回按钮，标题作返回目的地。 */
  onBack?: () => void
  onMinimize: () => void
  /** 关闭(×)；不传则不渲染 ×（如处理态只留「收起」一个按钮）。 */
  onClose?: () => void
  footer?: React.ReactNode
  widthClass?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="dialog"
      aria-label={title}
      className={`absolute left-1/2 top-1/2 z-50 flex max-h-[80%] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card border border-stone-300 bg-paper ${widthClass}`}
    >
      <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-[14px] font-medium text-ink hover:bg-stone-100"
          >
            <ChevronLeft size={16} className="text-stone-600" />
            {title}
          </button>
        ) : (
          <span className="text-[14px] font-medium text-ink">{title}</span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('newRequirement.minimize')}
            onClick={onMinimize}
            className="flex h-6 w-6 items-center justify-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
          >
            <Minus size={15} />
          </button>
          {onClose && (
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-stone-600 hover:bg-stone-100 hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-stone-100 px-3 py-2">{footer}</div>
      )}
    </div>
  )
}

function DescribeWindow(): React.JSX.Element {
  const { t } = useTranslation()
  const description = useNewRequirementStore((s) => s.description)
  const setDescription = useNewRequirementStore((s) => s.setDescription)
  const appendToDescription = useNewRequirementStore((s) => s.appendToDescription)
  const minimize = useNewRequirementStore((s) => s.minimize)
  const cancel = useNewRequirementStore((s) => s.cancel)
  const submit = useNewRequirementStore((s) => s.submit)

  // 附件按钮：系统文件选择器（多选）→ 路径插入正文。
  const pickAttachments = async (): Promise<void> => {
    const paths = await window.klarit.pickAttachments()
    paths.forEach((p) => appendToDescription(p))
  }
  // 粘贴：含图片则落盘取路径插入正文（其余走默认文本粘贴）。
  const onPaste = (e: React.ClipboardEvent): void => {
    const hasImage = Array.from(e.clipboardData?.items ?? []).some(
      (it) => it.kind === 'file' && it.type.startsWith('image/')
    )
    if (!hasImage) return
    e.preventDefault()
    void window.klarit.saveClipboardImage().then((p) => {
      if (p) appendToDescription(p)
    })
  }
  // 拖入文件：取本地路径（Electron webUtils）插入正文。
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    Array.from(e.dataTransfer?.files ?? []).forEach((f) => {
      const p = window.klarit.getDroppedFilePath(f)
      if (p) appendToDescription(p)
    })
  }

  return (
    <FloatingWindow
      title={t('newRequirement.describeTitle')}
      onMinimize={minimize}
      onClose={cancel}
      footer={
        <>
          <button type="button" onClick={cancel} className={ghostBtn}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={submit} className={primaryBtn}>
            {t('newRequirement.submit')}
          </button>
        </>
      }
    >
      <div className="space-y-2" onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <button
          type="button"
          onClick={pickAttachments}
          className="flex items-center gap-1 rounded border border-stone-300 bg-canvas px-2.5 py-1 text-[12px] text-ink hover:bg-stone-100"
        >
          <Paperclip size={13} />
          <span>{t('newRequirement.attachments')}</span>
        </button>
        <textarea
          aria-label={t('newRequirement.descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputCls} min-h-40`}
        />
        <p className="text-[12px] text-stone-600">{t('newRequirement.describeHint')}</p>
      </div>
    </FloatingWindow>
  )
}

function ProcessingWindow(): React.JSX.Element {
  const { t } = useTranslation()
  const minimize = useNewRequirementStore((s) => s.minimize)
  // 处理态：只留「收起」一个按钮（收进底栏，不中断分解、不清空）——底栏「建卡中」一直留到审阅窗弹出。
  return (
    <FloatingWindow title={t('newRequirement.describeTitle')} onMinimize={minimize}>
      <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-stone-600">
        <Loader2 size={16} className="animate-spin" />
        <span>{t('newRequirement.processing')}</span>
      </div>
    </FloatingWindow>
  )
}

function TaskDetail({
  card,
  onTitle,
  onDesc
}: {
  card: CandidateCard
  onTitle: (v: string) => void
  onDesc: (v: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TypeBadge typeId={card.typeId} />
        <span className="font-mono text-[11px] text-stone-600">{card.proposedName}</span>
      </div>
      <label className="block">
        <span className={labelCls}>{t('newRequirement.titleLabel')}</span>
        <input
          aria-label={t('newRequirement.titleLabel')}
          value={card.title}
          onChange={(e) => onTitle(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className={labelCls}>{t('newRequirement.descLabel')}</span>
        <textarea
          aria-label={t('newRequirement.descLabel')}
          value={card.description}
          onChange={(e) => onDesc(e.target.value)}
          className={`${inputCls} min-h-32`}
        />
      </label>
      {card.relations.length > 0 && (
        <div className="text-[12px] text-stone-600">
          {card.relations.map((r, i) => (
            <span key={i} className="mr-2 font-mono">
              {r.kind}→{r.target}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewWindow(): React.JSX.Element {
  const { t } = useTranslation()
  const cards = useNewRequirementStore((s) => s.reviewCards)
  const setTitle = useNewRequirementStore((s) => s.setReviewTitle)
  const setDesc = useNewRequirementStore((s) => s.setReviewDescription)
  const minimize = useNewRequirementStore((s) => s.minimize)
  const cancel = useNewRequirementStore((s) => s.cancel)
  const createTasks = useNewRequirementStore((s) => s.createTasks)
  const [detail, setDetail] = useState<number | null>(null)
  const inDetail = detail !== null && !!cards[detail]

  return (
    <FloatingWindow
      title={t('newRequirement.reviewTitle')}
      widthClass="w-[640px]"
      onMinimize={minimize}
      onClose={cancel}
      // 详情视图：标题栏左侧 chevron 返回候选列表，且不渲染「取消/创建任务」页脚——须先返回列表才能创建。
      onBack={inDetail ? () => setDetail(null) : undefined}
      footer={
        inDetail ? undefined : (
          <>
            <button type="button" onClick={cancel} className={ghostBtn}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={() => void createTasks()} className={primaryBtn}>
              {t('newRequirement.createTasks')}
            </button>
          </>
        )
      }
    >
      {cards.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-stone-600">{t('newRequirement.noCandidates')}</p>
      ) : detail !== null && cards[detail] ? (
        <TaskDetail
          card={cards[detail]}
          onTitle={(v) => setTitle(detail, v)}
          onDesc={(v) => setDesc(detail, v)}
        />
      ) : (
        <ul className="space-y-2">
          {cards.map((c, i) => (
            <li key={c.proposedName}>
              <button
                type="button"
                onClick={() => setDetail(i)}
                className="block w-full rounded-card border border-stone-100 bg-paper p-3 text-left hover:border-cobalt-300"
              >
                <div className="mb-1">
                  <TypeBadge typeId={c.typeId} />
                </div>
                <div className="mb-1 text-[14px] font-medium text-ink">{c.title}</div>
                <MarkdownView content={c.description} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </FloatingWindow>
  )
}

/** 未绑定项目空态提示（轻量 toast，可关闭）。 */
function UnboundNotice(): React.JSX.Element {
  const { t } = useTranslation()
  const dismiss = useNewRequirementStore((s) => s.dismissNotice)
  return (
    <div
      role="status"
      className="absolute bottom-9 right-2 z-[61] flex items-center gap-2 rounded-card border border-stone-300 bg-paper px-3 py-1.5 text-[12px] text-ink"
    >
      <span>{t('newRequirement.unboundNotice')}</span>
      <button type="button" aria-label={t('common.close')} onClick={dismiss} className="text-stone-600 hover:text-ink">
        <X size={13} />
      </button>
    </div>
  )
}

/**
 * 新建需求流程：描述想法窗 → 处理态 → 审阅候选任务窗。三窗无蒙层、可最小化。
 * 挂在主面板区（App.tsx 的 <main>）内，订阅 useNewRequirementStore。
 * 全程状态（含处理态「建卡中」、审阅收起）由「待办」列的 CreateRequirementEntry 按钮承载，此处不再渲染独立底栏指示。
 */
export function NewRequirementFlow(): React.JSX.Element {
  const phase = useNewRequirementStore((s) => s.phase)
  const windowOpen = useNewRequirementStore((s) => s.windowOpen)
  const notice = useNewRequirementStore((s) => s.notice)
  return (
    <>
      {windowOpen && phase === 'describing' && <DescribeWindow />}
      {windowOpen && phase === 'processing' && <ProcessingWindow />}
      {windowOpen && phase === 'reviewing' && <ReviewWindow />}
      {notice === 'unbound' && <UnboundNotice />}
    </>
  )
}
