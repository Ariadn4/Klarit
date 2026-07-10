// 列表编辑器 / 字段共用的语义令牌类（品牌规范第 06 / 12 章）。绝不硬编码颜色。
// 输入框：canvas 底 + stone-300 边、聚焦 cobalt（均随主题翻色）。
// 统一高度 h-8（32px）——单行输入与下拉等高；textarea 用 min-h-* 覆盖该固定高自由增高。
export const inputClass =
  'h-8 w-full rounded border border-stone-300 bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-cobalt-500'
