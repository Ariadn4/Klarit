## Context

输出窗口(命令 / AI / 后台 / prompt)全在 `RequirementCardDetail` 里,其中三个是同一个 `CommandOutputView` 组件(渲染一个 `<pre>`),第四个是「查看 prompt」的内联 `<pre>`。执行器无头跑、非 xterm,所以输出就是普通文本节点——本该可选可复制,被一行全局 CSS 摁住:

```
src/renderer/src/index.css   body { user-select: none }   ← 整界面禁选（桌面原生感）
```

`user-select` 可按元素覆盖,故局部 `select-text` 即放开;`CommandOutputView` 是单一改点(覆盖三个输出面)。剪贴板已有先例(`saveClipboardImage` 走 preload/IPC),`lucide-react` 已有 `Copy` 图标。

## Goals / Non-Goals

**Goals:**
- 命令/AI/后台/prompt 输出可选中文字自行复制。
- 每个输出框可一键复制全部缓冲文本,hover 浮现按钮 + 「已复制」反馈。
- 剪贴板走 Electron `clipboard`,稳、无权限坑。

**Non-Goals:**
- 不做全局「默认可选」翻转(误伤看板/标签风险大);别处内容放开留后续。
- 不做「复制选中片段」的自定义按钮(原生选中已够)。
- 不碰引擎/输出缓冲逻辑本身。

## Decisions

### D1：局部 `select-text` opt-in,不动全局禁选
在输出 `<pre>` 上加 `select-text`(Tailwind → `user-select: text`)覆盖 `body` 的 `user-select: none`。

- **为何不翻全局**(替代:`body` 改可选 + 给 chrome 逐个 `select-none`):全局翻转要给看板卡、标签、按钮、侧栏等大量 chrome 补 `select-none`,漏一个就出现「拖选界面元素」的廉价感,回归面广。opt-in 只碰输出,零回归。
- **代价**:别处内容(卡描述、决策原因、报告)仍不可选——但那不在本次诉求,留后续按同一 `select-text` 约定按需加。

### D2：复制走 Electron `clipboard` + preload,而非 `navigator.clipboard`
新增 `window.klarit.copyText(text)`,主进程 `ipcMain.handle` 调 `clipboard.writeText`。

- **为何**(替代:渲染层直接 `navigator.clipboard.writeText`):桌面应用里 `navigator.clipboard` 受安全上下文/焦点/权限约束,偶发静默失败;Electron `clipboard` 主进程写入确定、无条件可用,和既有 `saveClipboardImage` 同一套 preload 模式,一致。
- **代价**:多一个 IPC 往返(可忽略)+ 三处小改(shared/ipc、preload、main)。

### D3：一处改 `CommandOutputView`,prompt 复用同一 `CopyButton`
把 `select-text` 与复制按钮塞进 `CommandOutputView` → 命令/AI/后台三面一次生效;抽一个极小 `CopyButton`(收 `text`,内部调 `copyText` + 管「已复制」短暂态),prompt 那个内联 `<pre>` 复用它。

- **为何抽 `CopyButton`**:复制 + 反馈的状态逻辑(copied → 1.5s 复原)两处都要,抽出即 DRY;也便于单测(注入假 `copyText`)。
- **按钮呈现**:相对定位于输出框内右上角、默认低存在感、**hover 输出框才浮现**(GitHub 代码块风格)——输出框可能很多(逐命令 + 各后台),常显工具条会吵。空文本不渲染按钮。

### D4：复制底层缓冲字符串,不受视觉换行影响
`<pre>` 用 `break-all` 视觉换行,但复制的是 store 里该桶的原始 `text`(换行 `\n` 完整)——所以复制结果干净,与折行无关。

## Risks / Trade-offs

- **[流式追加时框选被自动滚动打断]** → 现有自动滚只在「已贴近底部(<40px)」时触发;用户往上滚动框选历史时不会自动滚,基本不冲突。极端情况(贴着底部边选边流)可能扰动,属边缘、不额外处理。
- **[hover 浮现按钮的可发现性]** → 首次用户可能不知有按钮;但文本已可选中(第二条路径)兜底,且 hover 浮现是通行范式,可接受。
- **[复制大输出]** → 缓冲文本可能很长;`clipboard.writeText` 同步写入大字符串开销可忽略,不设截断(用户要的就是全部)。

## Migration Plan

纯增量、无数据迁移。渲染层 + 新增一个 IPC 通道;回滚 = 撤代码,输出恢复不可选、无复制按钮。

## Open Questions

- 复制按钮图标 vs 图标+「复制」字样——倾向纯图标(`lucide` `Copy`),hover 出 tooltip;实现期定。
- 「已复制」反馈时长(1.5s)——实现期按手感微调。
