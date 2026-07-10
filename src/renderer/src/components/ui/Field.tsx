/**
 * 表单字段：标题式 label + 可选 description + 控件（品牌规范第 12 章「字段标签对」）。
 * label 13/600/ink、description 12/400/stone-600，顺序 label → description → 控件。
 * 差异只靠字号+字重+颜色（不靠 uppercase）。选填默认不标注，只有必填加 *。错误就近显示。
 */
export function Field({
  label,
  description,
  required = false,
  error,
  htmlFor,
  children
}: {
  label: string
  description?: string
  required?: boolean
  /** 有值即错误态：description 转 danger，并在控件下方就近显示该消息。 */
  error?: string
  /** 关联原生控件 id（点 label 聚焦控件）。 */
  htmlFor?: string
  /** 省略时仅渲染 label（+ description），用于纯信息字段。 */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold leading-snug text-ink">
        {label}
        {required && (
          <span className="ml-0.5 font-semibold text-signal-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {description && (
        <p className={`mt-0.5 text-[12px] leading-normal ${error ? 'text-danger' : 'text-stone-600'}`}>
          {description}
        </p>
      )}
      {children && <div className="mt-2">{children}</div>}
      {error && (
        <p role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
