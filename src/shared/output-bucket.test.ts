import { describe, it, expect } from 'vitest'
import { chunkBucket } from './output-bucket'

describe('chunkBucket', () => {
  it('后台 bgId 优先 → bg:<bgId>', () => {
    expect(chunkBucket('n1', { bgId: 'b7' })).toBe('bg:b7')
    expect(chunkBucket('n1', { bgId: 'b7', cmdIndex: 2 })).toBe('bg:b7') // bgId 优先于 cmdIndex
  })
  it('多命令节点 cmdIndex → node:<id>:<i>', () => {
    expect(chunkBucket('n1', { cmdIndex: 0 })).toBe('node:n1:0')
    expect(chunkBucket('n1', { cmdIndex: 1 })).toBe('node:n1:1')
  })
  it('无 bgId/cmdIndex 退化为 node:<id>', () => {
    expect(chunkBucket('n1')).toBe('node:n1')
    expect(chunkBucket('n1', {})).toBe('node:n1')
  })
})
