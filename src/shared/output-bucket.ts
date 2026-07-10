/**
 * `op-chunk` 事件 → 输出桶键。引擎累积缓冲(engine.ts emit)与渲染层实时追加(App.tsx)**共用同一函数**,
 * 避免两处各写一份、漂移导致「引擎存对桶但渲染层追到别的桶 → 面板恒空」。
 * 分桶:后台 `bg:<bgId>` > 前台命令 `node:<nodeId>:<cmdIndex>`(多命令节点各命令一桶)> 前台节点 `node:<nodeId>`。
 */
export function chunkBucket(nodeId: string, opts: { bgId?: string; cmdIndex?: number } = {}): string {
  if (opts.bgId) return `bg:${opts.bgId}`
  if (opts.cmdIndex !== undefined) return `node:${nodeId}:${opts.cmdIndex}`
  return `node:${nodeId}`
}
