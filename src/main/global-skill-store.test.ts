import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGlobalSkillStore, DECOMPOSE_SKILL_FILE } from './global-skill-store'
import { testTmpDir } from './test-tmp'

let base: string
let ext: string

beforeEach(() => {
  base = testTmpDir('klarit-gskill-')
  ext = testTmpDir('klarit-ext-')
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(ext, { recursive: true, force: true })
})

function store() {
  return createGlobalSkillStore(base)
}

describe('createGlobalSkillStore（覆盖 skill）', () => {
  it('未设置时 readOverride 返回 null（不种入内置文本，由自动生成 skill 兜底）', () => {
    expect(store().readOverride()).toBeNull()
  })

  it('writeOverride 手写存盘、readOverride 读回', () => {
    const s = store()
    s.writeOverride('# 分解\n按点子拆卡')
    expect(s.readOverride()).toBe('# 分解\n按点子拆卡')
  })

  it('importOverride 把外部文件内容拷入受管文件', () => {
    const src = join(ext, 'my-skill.md')
    writeFileSync(src, '外部分解 skill 内容', 'utf8')
    const s = store()
    s.importOverride(src)
    expect(s.readOverride()).toBe('外部分解 skill 内容')
  })

  it('read 越界路径（绝对/含 ..）返回 null；合规相对路径读回', () => {
    const s = store()
    s.writeOverride('内容')
    expect(s.read(DECOMPOSE_SKILL_FILE)).toBe('内容')
    expect(s.read('../escape.md')).toBeNull()
    expect(s.read('C:\\abs.md')).toBeNull()
    expect(s.read('/etc/passwd')).toBeNull()
    expect(s.read('missing.md')).toBeNull()
  })
})
