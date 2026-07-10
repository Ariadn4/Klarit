import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createOutputBuffer,
  createMemoryOutputBuffer,
  type OutputBuffer
} from './output-buffer'

function contract(name: string, make: () => OutputBuffer): void {
  describe(name, () => {
    let buf: OutputBuffer
    beforeEach(() => {
      buf = make()
    })

    it('前台与后台桶隔离：各桶只得自己的输出', () => {
      buf.append('r1', 'node:n1', 'fg-1\n')
      buf.append('r1', 'bg:b1', 'bg-1\n')
      buf.append('r1', 'node:n1', 'fg-2\n')
      buf.append('r1', 'bg:b2', 'bg-2\n')
      expect(buf.read('r1', 'node:n1')).toBe('fg-1\nfg-2\n')
      expect(buf.read('r1', 'bg:b1')).toBe('bg-1\n')
      expect(buf.read('r1', 'bg:b2')).toBe('bg-2\n')
    })

    it('累积输出可在流过之后读回', () => {
      buf.append('r1', 'node:n1', 'part1')
      buf.append('r1', 'node:n1', 'part2')
      expect(buf.read('r1', 'node:n1')).toBe('part1part2')
    })

    it('列出某运行的全部桶', () => {
      buf.append('r1', 'node:n1', 'a')
      buf.append('r1', 'bg:b1', 'b')
      expect(buf.listBuckets('r1').sort()).toEqual(['bg:b1', 'node:n1'])
    })

    it('未知桶/运行读空串、列空', () => {
      expect(buf.read('r1', 'node:ghost')).toBe('')
      expect(buf.listBuckets('rX')).toEqual([])
    })

    it('运行隔离：不同 runId 桶互不串', () => {
      buf.append('r1', 'node:n1', 'one')
      buf.append('r2', 'node:n1', 'two')
      expect(buf.read('r1', 'node:n1')).toBe('one')
      expect(buf.read('r2', 'node:n1')).toBe('two')
    })

    it('clear 清空某桶（复用桶重新开跑），不影响别的桶', () => {
      buf.append('r1', 'bg:b1', 'old-crash\n')
      buf.append('r1', 'bg:b2', 'keep\n')
      buf.clear('r1', 'bg:b1')
      expect(buf.read('r1', 'bg:b1')).toBe('')
      buf.append('r1', 'bg:b1', 'fresh\n')
      expect(buf.read('r1', 'bg:b1')).toBe('fresh\n') // 只含新输出
      expect(buf.read('r1', 'bg:b2')).toBe('keep\n') // 别的桶不受影响
    })
  })
}

contract('createMemoryOutputBuffer', () => createMemoryOutputBuffer())

describe('createOutputBuffer（文件持久化）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'klarit-out-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  contract('file-backed', () => createOutputBuffer(dir))

  it('关重开后据持久化缓冲仍可按桶读', () => {
    createOutputBuffer(dir).append('r1', 'node:n1', 'persisted\n')
    expect(createOutputBuffer(dir).read('r1', 'node:n1')).toBe('persisted\n')
  })
})
