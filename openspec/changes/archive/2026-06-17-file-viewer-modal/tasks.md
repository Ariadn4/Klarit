## 1. 主进程只读读取文件（契约 + 实现）

- [x] 1.1 在 `src/shared/types.ts` 新增 `ReadFileResult` 判别联合（`text` / `binary` / `too-large` / `error`），并在 `KlaritApi` 加 `readFile(path: string): Promise<ReadFileResult>`
- [x] 1.2 在 `src/shared/ipc.ts` 的 `IPC` 加 `readFile: 'fs:readFile'`
- [x] 1.3 先写 `src/main/readfile.test.ts`（先红）：文本→`text`、二进制→`binary`、超上限→`too-large`、不存在/无权限→`error`
- [x] 1.4 实现 `src/main/readfile.ts`：`stat` 判大小（`MAX_PREVIEW_BYTES` 常量），读取后探测 NUL/不可解码判二进制，纯函数便于单测，跑绿 1.3
- [x] 1.5 在 `src/main/index.ts` 注册 `ipcMain.handle(IPC.readFile, ...)` 调用 `readfile.ts`
- [x] 1.6 在 `src/preload/index.ts` 的 `api` 加 `readFile: (p) => ipcRenderer.invoke(IPC.readFile, p)`

## 2. monaco 依赖与只读编辑器组件

- [x] 2.1 `npm view monaco-editor version` 取 latest 并安装 `monaco-editor`
- [x] 2.2 配置 electron-vite 下 monaco 的 web worker（`MonacoEnvironment.getWorker` + Vite `?worker` import），封装于单一模块
- [x] 2.3 实现 `MonacoViewer` 组件：props 仅 `value` + `language`，`readOnly: true` / `domReadOnly: true`，按扩展名映射 language（常见扩展名表，未知回退纯文本）
- [x] 2.4 `npm start` 手动验证 monaco 在窗口内加载并展示带高亮文本（worker 无报错）；另 `npm run build` 确认 worker 进独立 chunk 可打包

## 3. 查看器全局状态（zustand store）

- [x] 3.1 先写 store 测试（先红）：`open` 去重聚焦同路径、新增标签并置 `expanded`；`closeTab` 移除并在关激活标签时激活相邻；`closeAll` 清空；`minimize`/`restore` 的 mode 迁移
- [x] 3.2 实现 `useFileViewerStore`：state（`tabs`、`activePath`、`mode`）+ actions（`open`/`closeTab`/`setActive`/`minimize`/`restore`/`closeAll`），跑绿 3.1

## 4. 查看器浮层组件（蒙层 + 标签页 + 底栏）

- [x] 4.1 先写 `FileViewer` 组件测试（先红，注入假 `readFile` 与 `MonacoViewer` 替身）：多标签渲染/切换/单关、关最后一个标签收起、蒙层空白点击→最小化、底栏点击→恢复、整体关闭、降级占位（binary/too-large/error）
- [x] 4.2 实现 `FileViewer`：订阅 store，`mode==='expanded'` 渲染蒙层+浮层（标签条+内容区+最小化/关闭按钮），`minimized` 渲染底栏，无 tab 不渲染；内容区按 `ReadFileResult.kind` 分支到 `MonacoViewer` 或占位组件；跑绿 4.1
- [x] 4.3 内容区在标签激活时通过 `window.klarit.readFile` 取内容并缓存到标签（避免切回重复读）
- [x] 4.4 按 `docs/brand/klarit-brand-system.html` 校对浮层/蒙层/底栏的配色、层级与间距，不另起配色或投影

## 5. 接线：文件树点击打开 + 挂载查看器

- [x] 5.1 先改 `FileTree.test.tsx`（先红）：点击文件项调用注入的 `onOpenFile(path)`，点击目录项不调用
- [x] 5.2 改 `FileTree.tsx`/`TreeNode`：文件项 `onClick` 调用 `onOpenFile`（默认走 `useFileViewerStore.open`），目录保持 `toggle`；跑绿 5.1
- [x] 5.3 在 `App.tsx` 挂载 `<FileViewer />`（应用级单例，不经 props 透传）
- [x] 5.4 `App.test.tsx` 补：点击文件树文件后查看器浮层出现并展示该文件

## 6. 收尾验证

- [x] 6.1 `npm run typecheck`（node + web 两套 config）通过
- [x] 6.2 `npm run test:run` 全绿（225 用例）；另跑通 `npm run build`，monaco 进独立懒加载 chunk、worker 配置可打包
- [x] 6.3 `npm start` 手动走查（用户验收）：点文件树文件打开→多开标签→切换/单关→收起/展开浮层→整体关闭；常驻底栏（任务栏）始终显示、蒙层不覆盖侧边栏与底栏
