import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileForPreview, MAX_PREVIEW_BYTES } from './readfile'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'klarit-rf-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readFileForPreview', () => {
  it('文本文件返回 text 与内容', () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'const x = 1\n')
    const r = readFileForPreview(p)
    expect(r).toEqual({ kind: 'text', content: 'const x = 1\n' })
  })

  it('含 NUL 字节的文件判为 binary', () => {
    const p = join(dir, 'a.bin')
    writeFileSync(p, Buffer.from([0x68, 0x69, 0x00, 0x01, 0x02]))
    expect(readFileForPreview(p)).toEqual({ kind: 'binary' })
  })

  it('超过大小上限的文件返回 too-large 与大小', () => {
    const p = join(dir, 'big.txt')
    const size = MAX_PREVIEW_BYTES + 1
    writeFileSync(p, Buffer.alloc(size, 0x61))
    expect(readFileForPreview(p)).toEqual({ kind: 'too-large', size })
  })

  it('不存在的文件返回 error', () => {
    const r = readFileForPreview(join(dir, 'nope.txt'))
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/.+/)
  })
})
