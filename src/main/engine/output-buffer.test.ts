import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
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

/**
 * 原始流记录（agent stdout 逐行原样）与展示转写是**两份并存、职责相反**的记录：
 * 展示要压缩给人看，原始要保真给机器（续接重建）。故不同文件、互不覆盖，但保留/清理口径一致（同生共死）。
 */
describe('原始流记录（与展示转写并存）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'klarit-raw-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('同一桶两份记录并存、互不覆盖：各写各的、各读各的', () => {
    const buf = createOutputBuffer(dir)
    const p = buf.rawPath('r1', 'node:n1')
    expect(p && isAbsolute(p)).toBe(true)
    appendFileSync(p!, '{"type":"tool_result","content":"全量结果"}\n')
    buf.append('r1', 'node:n1', '[工具] Edit\n')
    expect(buf.readRaw('r1', 'node:n1')).toBe('{"type":"tool_result","content":"全量结果"}\n')
    expect(buf.read('r1', 'node:n1')).toBe('[工具] Edit\n')
  })

  it('原始记录按桶隔离，且不冒充展示桶出现在桶清单里', () => {
    const buf = createOutputBuffer(dir)
    appendFileSync(buf.rawPath('r1', 'node:n1')!, 'a\n')
    appendFileSync(buf.rawPath('r1', 'node:n2')!, 'b\n')
    expect(buf.readRaw('r1', 'node:n1')).toBe('a\n')
    expect(buf.readRaw('r1', 'node:n2')).toBe('b\n')
    expect(buf.listBuckets('r1')).toEqual([])
  })

  it('保留/清理口径一致：clear 连原始记录一起清，remove 整个运行一起回收', () => {
    const buf = createOutputBuffer(dir)
    appendFileSync(buf.rawPath('r1', 'node:n1')!, 'raw\n')
    buf.append('r1', 'node:n1', 'display\n')
    appendFileSync(buf.rawPath('r1', 'node:n2')!, 'keep\n')
    buf.clear('r1', 'node:n1')
    expect(buf.read('r1', 'node:n1')).toBe('')
    expect(buf.readRaw('r1', 'node:n1')).toBe('')
    expect(buf.readRaw('r1', 'node:n2')).toBe('keep\n') // 别的桶不受影响
    buf.remove('r1')
    expect(buf.readRaw('r1', 'node:n2')).toBe('')
  })

  it('关重开后原始记录仍可读（与展示转写一样持久）', () => {
    appendFileSync(createOutputBuffer(dir).rawPath('r1', 'node:n1')!, 'persisted\n')
    expect(createOutputBuffer(dir).readRaw('r1', 'node:n1')).toBe('persisted\n')
  })

  it('内存缓冲无盘 → 无原始记录路径、读空（调用方据此回落展示转写）', () => {
    const buf = createMemoryOutputBuffer()
    expect(buf.rawPath('r1', 'node:n1')).toBeNull()
    expect(buf.readRaw('r1', 'node:n1')).toBe('')
  })
})
