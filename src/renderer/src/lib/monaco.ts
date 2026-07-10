/**
 * monaco 在 electron-vite（Vite）下的 web worker 接入——单一接入点。
 * Vite 用 `?worker` 把每个 worker 打成独立 chunk，再经 MonacoEnvironment.getWorker 按 label 分发。
 * 该模块有副作用（设置 self.MonacoEnvironment），故只由 MonacoViewer 引入，避免被测试环境加载。
 */
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

/** 扩展名 → monaco 语言 id 映射；命中走语法高亮，否则回退 plaintext。 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  sql: 'sql'
}

/** 据文件路径推断 monaco 语言 id；未知扩展名回退 'plaintext'。 */
export function languageForPath(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext'
}

export { monaco }
