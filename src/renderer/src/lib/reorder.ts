/** 把数组中 from 位置的元素移动到 to 位置，返回新数组（不改原数组）。越界则返回原数组副本。 */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
