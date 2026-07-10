import { describe, it, expect } from 'vitest'
import { reorder } from './reorder'

describe('reorder', () => {
  it('把元素从 from 移到 to，返回新数组', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('from === to 时原样返回（内容不变）', () => {
    expect(reorder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('越界索引时安全返回原数组副本', () => {
    expect(reorder(['a', 'b'], -1, 5)).toEqual(['a', 'b'])
  })

  it('不修改原数组', () => {
    const src = ['a', 'b', 'c']
    reorder(src, 0, 2)
    expect(src).toEqual(['a', 'b', 'c'])
  })
})
