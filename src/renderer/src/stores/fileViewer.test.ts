import { describe, it, expect, beforeEach } from 'vitest'
import { useFileViewerStore } from './fileViewer'

const reset = (): void =>
  useFileViewerStore.setState({ tabs: [], activePath: null, popupOpen: false })

beforeEach(reset)

const s = () => useFileViewerStore.getState()

describe('useFileViewerStore', () => {
  it('open 新文件：新增标签、置为激活、展开浮层', () => {
    s().open('/p/a.ts')
    expect(s().tabs).toEqual([{ path: '/p/a.ts', name: 'a.ts' }])
    expect(s().activePath).toBe('/p/a.ts')
    expect(s().popupOpen).toBe(true)
  })

  it('open 同一路径：不新增标签，聚焦既有标签并展开', () => {
    s().open('/p/a.ts')
    s().open('/p/b.ts')
    s().minimize()
    s().open('/p/a.ts')
    expect(s().tabs.map((t) => t.path)).toEqual(['/p/a.ts', '/p/b.ts'])
    expect(s().activePath).toBe('/p/a.ts')
    expect(s().popupOpen).toBe(true)
  })

  it('open 从反斜杠路径推断文件名', () => {
    s().open('C:\\proj\\src\\index.tsx')
    expect(s().tabs[0].name).toBe('index.tsx')
  })

  it('closeTab 关闭非激活标签：保留其余、激活项不变', () => {
    s().open('/p/a.ts')
    s().open('/p/b.ts')
    s().closeTab('/p/a.ts')
    expect(s().tabs.map((t) => t.path)).toEqual(['/p/b.ts'])
    expect(s().activePath).toBe('/p/b.ts')
  })

  it('closeTab 关闭激活标签：激活相邻标签', () => {
    s().open('/p/a.ts')
    s().open('/p/b.ts')
    s().open('/p/c.ts')
    s().setActive('/p/b.ts')
    s().closeTab('/p/b.ts')
    expect(s().tabs.map((t) => t.path)).toEqual(['/p/a.ts', '/p/c.ts'])
    expect(s().activePath).toBe('/p/a.ts')
  })

  it('closeTab 关闭最后一个标签：清空、收起浮层', () => {
    s().open('/p/a.ts')
    s().closeTab('/p/a.ts')
    expect(s().tabs).toEqual([])
    expect(s().activePath).toBeNull()
    expect(s().popupOpen).toBe(false)
  })

  it('minimize / restore 切换浮层开合，保留标签与激活项', () => {
    s().open('/p/a.ts')
    s().minimize()
    expect(s().popupOpen).toBe(false)
    s().restore()
    expect(s().popupOpen).toBe(true)
    expect(s().activePath).toBe('/p/a.ts')
  })

  it('toggle 在展开/收起间切换；无打开文件时无操作', () => {
    s().toggle()
    expect(s().popupOpen).toBe(false) // 无文件，不打开
    s().open('/p/a.ts')
    s().toggle()
    expect(s().popupOpen).toBe(false)
    s().toggle()
    expect(s().popupOpen).toBe(true)
  })

  it('closeAll 清空所有标签并收起浮层', () => {
    s().open('/p/a.ts')
    s().open('/p/b.ts')
    s().closeAll()
    expect(s().tabs).toEqual([])
    expect(s().activePath).toBeNull()
    expect(s().popupOpen).toBe(false)
  })
})
