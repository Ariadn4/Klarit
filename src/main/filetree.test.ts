import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { listDir } from './filetree'
import { testTmpDir } from './test-tmp'

let dir: string
beforeEach(() => {
  dir = testTmpDir('klarit-ft-')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('listDir', () => {
  it('列出顶层文件与文件夹，目录在前、按名排序', () => {
    mkdirSync(join(dir, 'src'))
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'README.md'), '')
    writeFileSync(join(dir, 'package.json'), '')
    const nodes = listDir(dir)
    expect(nodes.map((n) => n.name)).toEqual(['docs', 'src', 'package.json', 'README.md'])
    expect(nodes[0].kind).toBe('directory')
    expect(nodes.find((n) => n.name === 'README.md')?.kind).toBe('file')
  })

  it('忽略 node_modules / .git 等重目录', () => {
    mkdirSync(join(dir, 'node_modules'))
    mkdirSync(join(dir, '.git'))
    mkdirSync(join(dir, 'src'))
    const nodes = listDir(dir)
    expect(nodes.map((n) => n.name)).toEqual(['src'])
  })

  it('路径为子项的绝对路径', () => {
    writeFileSync(join(dir, 'a.txt'), '')
    expect(listDir(dir)[0].path).toBe(join(dir, 'a.txt'))
  })
})
