import { describe, it, expect } from 'vitest'
import { classifyScope } from './scope'

describe('classifyScope — 改动集按实际可写范围分类', () => {
  it('可写范围为空＝整条分支可写：全部范围内', () => {
    const r = classifyScope(['src/a.ts', 'x/y.md'], [], [])
    expect(r.outOfScope).toEqual([])
    expect(r.inScope).toEqual(['src/a.ts', 'x/y.md'])
  })

  it('目录前缀命中即范围内；范围外文件进 outOfScope', () => {
    const r = classifyScope(['docs/a.md', 'src/x.ts'], ['docs/'], [])
    expect(r.inScope).toEqual(['docs/a.md'])
    expect(r.outOfScope).toEqual(['src/x.ts'])
  })

  it('产出路径恒可写（并入可写范围）', () => {
    const r = classifyScope(['reports/r.md', 'src/x.ts'], ['docs/'], ['reports/r.md'])
    expect(r.inScope).toContain('reports/r.md')
    expect(r.outOfScope).toEqual(['src/x.ts'])
  })

  it('精确文件范围：只许动某个文件', () => {
    const r = classifyScope(['a.ts', 'b.ts'], ['a.ts'], [])
    expect(r.inScope).toEqual(['a.ts'])
    expect(r.outOfScope).toEqual(['b.ts'])
  })

  it('路径分隔归一（\\\\ 与 /）后再比对', () => {
    const r = classifyScope(['docs\\a.md'], ['docs/'], [])
    expect(r.outOfScope).toEqual([])
  })

  it('子目录不被同名前缀误伤（docs vs docs2）', () => {
    const r = classifyScope(['docs2/a.md'], ['docs/'], [])
    expect(r.outOfScope).toEqual(['docs2/a.md'])
  })
})
