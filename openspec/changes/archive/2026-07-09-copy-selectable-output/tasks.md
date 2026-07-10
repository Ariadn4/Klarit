## 1. 剪贴板通道（Electron clipboard）

- [x] 1.1 `src/shared/ipc.ts`:新增 `copyText` 通道常量
- [x] 1.2 `src/main/index.ts`:`ipcMain.handle(copyText)` → `clipboard.writeText(text)`(从 electron 引入 `clipboard`)
- [x] 1.3 `src/preload/index.ts`:暴露 `window.klarit.copyText(text: string): Promise<void>`;补 `src/preload` 的 `KlaritApi` 类型
- [x] 1.4 冒烟:渲染层能调 `window.klarit.copyText('x')` 不报错(手动或类型层验证）

## 2. CopyButton 小组件（测试先行）

- [x] 2.1 写 `CopyButton.test.tsx`:有文本时渲染按钮、点击调注入的 `copyText(text)`、点后显示「已复制」并在计时后复原;`text` 为空时不渲染
- [x] 2.2 实现 `src/renderer/src/components/CopyButton.tsx`:收 `text` + 调 `window.klarit.copyText`,内部管 `copied` 短暂态(约 1.5s 复原);空文本返回 null;用 `lucide-react` 的 `Copy` 图标、语义令牌配色、hover tooltip
- [x] 2.3 补 i18n:`board.copy` /「已复制」`board.copied`（zh + en）

## 3. CommandOutputView：可选中 + 复制按钮

- [x] 3.1 更新 `CommandOutputView.test`（或新建）:有内容时渲染 `CopyButton`、空输出不渲染;`<pre>` 带 `select-text` 类(可选中）
- [x] 3.2 `src/renderer/src/components/CommandOutputView.tsx`:`<pre>` 加 `select-text`;包一层相对定位容器,右上角放 `CopyButton`（hover 才浮现,传该桶 `text`）
- [x] 3.3 目视确认三个用处（AI 活动 `node:<id>` / 逐命令 `node:<id>:<i>` / 后台 `bg:<id>`）都随之生效（一处改、三面覆盖）

## 4. prompt 输出：可选中 + 复制按钮

- [x] 4.1 `src/renderer/src/components/RequirementCardDetail.tsx`:「查看 prompt」的内联 `<pre>`（行 221-223）加 `select-text`,并在其角落放 `CopyButton`（传 `agentRuns[nodeId].prompt`）

## 5. 收尾

- [x] 5.1 `npm run typecheck`（node + web）全绿
- [x] 5.2 `npm run test:run` 全绿（含新增 CopyButton / CommandOutputView 用例）
- [x] 5.3 UI 核对:复制按钮用语义令牌、深浅双主题正常、无硬编码色（对齐 `docs/brand`）
- [x] 5.4 dogfood（`npm start` 或 dev）:跑一张卡到有输出 → 框选一段文字能选中并复制 → 点复制按钮见「已复制」、粘贴出完整输出;prompt、命令、后台各面都验一遍
