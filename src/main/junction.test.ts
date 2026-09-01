import { describe, it, expect, afterEach } from 'vitest'
import { rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { linkJunction, readJunction, unlinkReparsePoints } from './junction'
import { testTmpDir } from './test-tmp'

const trash: string[] = []
function tmp(prefix: string): string {
  const d = testTmpDir(prefix)
  trash.push(d)
  return d
}
afterEach(() => {
  while (trash.length) {
    try {
      rmSync(trash.pop()!, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('linkJunction / readJunction', () => {
  it('链接后可探测到指向目标', async () => {
    const target = tmp('klarit-target-')
    writeFileSync(join(target, 'keep.txt'), 'precious\n')
    const wt = tmp('klarit-wt-')
    const link = join(wt, 'node_modules')
    await linkJunction(target, link)
    const resolved = await readJunction(link)
    expect(resolved).not.toBeNull()
    // 经链接可读到目标内容
    expect(readFileSync(join(link, 'keep.txt'), 'utf8')).toBe('precious\n')
  })

  it('非链接路径 readJunction 返回 null', async () => {
    const wt = tmp('klarit-wt-')
    mkdirSync(join(wt, 'real'))
    expect(await readJunction(join(wt, 'real'))).toBeNull()
    expect(await readJunction(join(wt, 'missing'))).toBeNull()
  })
})

describe('unlinkReparsePoints（防御性解链）', () => {
  it('解掉链接本身，目标内容原封不动', async () => {
    const target = tmp('klarit-target-')
    writeFileSync(join(target, 'keep.txt'), 'precious\n')
    const wt = tmp('klarit-wt-')
    const link = join(wt, 'node_modules')
    await linkJunction(target, link)

    const unlinked = await unlinkReparsePoints(wt)
    expect(unlinked.map((p) => p.toLowerCase())).toContain(link.toLowerCase())
    // 链接没了，但目标与其内容还在
    expect(existsSync(link)).toBe(false)
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('precious\n')
  })

  it('解掉嵌套位置的（“私自建”）链接，不依赖任何登记', async () => {
    const target = tmp('klarit-target-')
    writeFileSync(join(target, 'keep.txt'), 'precious\n')
    const wt = tmp('klarit-wt-')
    mkdirSync(join(wt, 'packages', 'app'), { recursive: true })
    const link = join(wt, 'packages', 'app', 'vendor')
    await linkJunction(target, link)

    const unlinked = await unlinkReparsePoints(wt)
    expect(unlinked.map((p) => p.toLowerCase())).toContain(link.toLowerCase())
    expect(existsSync(link)).toBe(false)
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('precious\n')
  })

  it('绝不递归进 reparse point（不触达目标内部文件）', async () => {
    // 目标内放很多“深”文件；若扫描递归进去会把它们当成 worktree 内文件
    const target = tmp('klarit-target-')
    mkdirSync(join(target, 'deep'), { recursive: true })
    writeFileSync(join(target, 'deep', 'inner.txt'), 'inner\n')
    const wt = tmp('klarit-wt-')
    writeFileSync(join(wt, 'top.txt'), 'top\n')
    const link = join(wt, 'linked')
    await linkJunction(target, link)

    const unlinked = await unlinkReparsePoints(wt)
    // 只解了那一个链接，目标深处文件完好（说明没递归进去删）
    expect(unlinked).toHaveLength(1)
    expect(readFileSync(join(target, 'deep', 'inner.txt'), 'utf8')).toBe('inner\n')
  })

  it('无链接时返回空数组、目录结构不变', async () => {
    const wt = tmp('klarit-wt-')
    mkdirSync(join(wt, 'src'))
    writeFileSync(join(wt, 'src', 'x.txt'), 'x\n')
    const unlinked = await unlinkReparsePoints(wt)
    expect(unlinked).toEqual([])
    expect(existsSync(join(wt, 'src', 'x.txt'))).toBe(true)
  })
})
