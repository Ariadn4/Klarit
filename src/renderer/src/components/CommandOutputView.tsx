/**
 * 单条命令输出视图：按桶（前台 `node:<id>` / 后台 `bg:<id>`）展示某命令的累积输出，可回看。
 * 挂载时从主进程缓冲 seed 一次（关重开仍可读），之后由 op-chunk 实时追加（见 App 的进度订阅）。
 *
 * store 里每桶只常驻**尾部窗口**（长跑 agent 会一直往里流，无上限累积等于拿内存换盘上已有的东西）。
 * 该桶丢过开头时给一个「载入更早」的入口——走既有 `readRunOutput` 从引擎缓冲把完整内容读回来，
 * 只把常驻窗口**之前**的那段留在组件本地，尾部照旧跟着实时输出长。
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCardsStore, outputKey } from '../stores/cards'
import { CopyButton } from './CopyButton'

export function CommandOutputView({
  runId,
  bucket
}: {
  runId: string
  bucket: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const tail = useCardsStore((s) => s.outputs[outputKey(runId, bucket)] ?? '')
  const truncated = useCardsStore((s) => s.outputTruncated[outputKey(runId, bucket)] ?? false)
  const seedOutput = useCardsStore((s) => s.seedOutput)
  const preRef = useRef<HTMLPreElement>(null)
  // 回看载入的「常驻窗口之前」那段；null＝没载入过。留在组件本地，不进 store（store 要保持有界）。
  const [earlier, setEarlier] = useState<string | null>(null)
  const text = earlier === null ? tail : earlier + tail

  const loadEarlier = async (): Promise<void> => {
    const full = await window.klarit.readRunOutput(runId, bucket)
    // 常驻的是全量的后缀（正常情形）→ 只取它之前那段，免得尾部重复一遍。
    setEarlier(tail && full.endsWith(tail) ? full.slice(0, full.length - tail.length) : full)
  }

  // 挂载时从引擎缓冲 seed 一次（关重开回看）。但**不得覆盖已有实时输出**：
  // 若 store 里该桶已被实时 op-chunk 填过（刚进节点即开始流），seed 会把已流的内容替换回读取瞬间的旧值，
  // 造成「出现→清空→再出现」的闪烁。故 seed 前后都只在该桶仍为空时才写。
  useEffect(() => {
    const key = outputKey(runId, bucket)
    if (useCardsStore.getState().outputs[key]) return
    void window.klarit.readRunOutput(runId, bucket).then((buffered) => {
      if (buffered && !useCardsStore.getState().outputs[key]) seedOutput(runId, bucket, buffered)
    })
  }, [runId, bucket, seedOutput])

  // 自动滚到底：新内容追加时跟随，像终端持续往下流（而非停在顶部、看不到最新）。
  // 仅当用户已贴近底部时才自动滚，避免打断向上回看历史。
  useEffect(() => {
    const el = preRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [text])

  // group + relative：输出可选中（select-text 覆盖全局禁选）+ 右上角 hover 才浮现的「复制全部」按钮（空输出不渲染）。
  return (
    <div className="group relative">
      {truncated && earlier === null && (
        <button
          type="button"
          onClick={() => void loadEarlier()}
          className="mb-1 text-[11px] text-cobalt-600 underline underline-offset-2 hover:text-cobalt-700"
        >
          {t('board.loadEarlierOutput')}
        </button>
      )}
      <pre
        ref={preRef}
        className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-all rounded border border-stone-300 bg-canvas p-1.5 text-[11px] leading-snug text-stone-600"
      >
        {text || t('board.noOutput')}
      </pre>
      <CopyButton text={text} className="absolute right-4 top-1 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  )
}
