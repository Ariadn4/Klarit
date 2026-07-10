## Why

命令输出 / AI 输出这些窗口现在**完全不能选中文字、也没有方便的复制方法**——排查失败、抄一段报错、留存 AI 的产出都得靠肉眼重敲。根因是一行全局 CSS(`src/renderer/src/index.css` 的 `body { user-select: none }`,桌面原生感的整界面禁选)顺手把输出文本也禁选了,而输出窗口本就是普通 `<pre>`(agent/命令执行器无头跑、非 xterm 终端),放开选中 + 加个复制按钮即可,成本很小、体验提升明显。

## What Changes

- **输出可选中**:给输出 `<pre>` 局部加 `select-text` 覆盖全局 `user-select: none`,用户可框选任意片段 + Ctrl+C 自行复制。覆盖全部四个输出面:AI 活动输出、当前命令逐条输出、后台命令输出、以及「查看 prompt」里 AI 的输入文本。
- **一键复制全部**:输出框右上角加一个 **hover 才浮现**的小「复制」按钮(GitHub 代码块风格,不占地、输出框多也不吵),复制该输出桶的**完整缓冲文本**;点后给「已复制 ✓」反馈(约 1.5s 复原);空输出时不渲染。三个 `CommandOutputView` 一处改全生效;prompt 那个内联 `<pre>` 复用同一个 `CopyButton`。
- **剪贴板走 Electron clipboard**:新增 preload `window.klarit.copyText(text)` + 主进程 IPC,用 Electron 的 `clipboard.writeText`——桌面应用最稳,不吃浏览器安全上下文/权限脸色(不用 `navigator.clipboard`)。

**明确边界(不在本 change)**:
- **不做全局翻转**(「默认可选、只 chrome 禁选」)——那会误伤看板/标签/按钮等,风险大;只放开用户点名的「输出 + prompt」这几个窗口,别处内容(卡片描述、决策原因、报告等)要放开留后续按需扩。
- 复制按钮 = 复制全部;部分复制靠原生选中(已放开),两者互补,不做「复制选中」的自定义按钮。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `requirement-card-detail`: 命令/AI/后台输出的分流展示新增「**输出文本可选中**(局部覆盖全局禁选)+ **一键复制全部**(hover 浮现按钮、复制该桶完整缓冲、已复制反馈)」;「查看 prompt」的 AI 输入文本同样可选中 + 可复制。

## Impact

- **纯渲染层 + 一个极小 IPC 通道**,不碰引擎、不碰 git、不碰输出缓冲逻辑本身。
- **代码**(预估):
  - `src/renderer/src/components/CommandOutputView.tsx`:输出 `<pre>` 加 `select-text` + 右上角 hover 复制按钮。
  - `src/renderer/src/components/CopyButton.tsx`(新,小组件):图标 + 复制 + 「已复制」短暂反馈,复用于 prompt。
  - `src/renderer/src/components/RequirementCardDetail.tsx`:prompt `<pre>` 加 `select-text` + `CopyButton`。
  - `src/preload/index.ts`、`src/main/index.ts`、`src/shared/ipc.ts`:新增 `copyText` 通道(`clipboard.writeText`)。
  - `src/renderer/src/i18n/locales/{zh,en}.ts`:「复制」/「已复制」文案。
- **UI 遵守 `docs/brand`**:复制按钮用语义令牌(`stone-*`/`cobalt-*`)、深浅双主题,无硬编码色。
- **测试**(先行):`CommandOutputView` 有内容时渲染复制按钮、点击调 `copyText` 并显示「已复制」、空输出不渲染按钮;输出 `<pre>` 带 `select-text`。用假 `window.klarit.copyText` 注入,不依赖真剪贴板。
- **无破坏性变更 / 无迁移**:纯增量,老数据无关。
