import { useEffect, useRef } from 'react'
import { monaco, languageForPath } from '../lib/monaco'

interface MonacoViewerProps {
  /** 文件文本内容。 */
  value: string
  /** 文件路径——据此推断语法高亮语言。 */
  path: string
}

/** 当前 <html data-theme>（由 App 写入）映射为 monaco 内置主题名。 */
function monacoThemeFromDom(): string {
  return document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs'
}

/**
 * 只读的 monaco 代码查看器：按文件类型语法高亮，内容不可编辑。
 * 渲染由 value + path 决定；编辑器主题随生效主题（<html data-theme>）切换，
 * 与周边界面保持明暗一致。
 */
export function MonacoViewer({ value, path }: MonacoViewerProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  // 仅创建/销毁编辑器一次；value/path 的更新走下面的副作用，避免重建丢滚动位置。
  useEffect(() => {
    if (!host.current) return
    const ed = monaco.editor.create(host.current, {
      value,
      language: languageForPath(path),
      theme: monacoThemeFromDom(),
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
      renderLineHighlight: 'none'
    })
    editor.current = ed
    return () => {
      ed.getModel()?.dispose()
      ed.dispose()
      editor.current = null
    }
    // 创建只跑一次；后续更新由下面的 effect 接管。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 生效主题变化时切 monaco 主题（setTheme 是全局副作用，仅在挂载期间订阅）。
  useEffect(() => {
    monaco.editor.setTheme(monacoThemeFromDom())
    return window.klarit.onThemeChange((t) => {
      monaco.editor.setTheme(t === 'dark' ? 'vs-dark' : 'vs')
    })
  }, [])

  useEffect(() => {
    const ed = editor.current
    if (!ed) return
    if (ed.getValue() !== value) ed.setValue(value)
    const model = ed.getModel()
    if (model) monaco.editor.setModelLanguage(model, languageForPath(path))
  }, [value, path])

  return <div ref={host} className="h-full w-full" data-testid="monaco-viewer" />
}
