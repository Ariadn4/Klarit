# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

**Klarit 是面向 vibe coder 的需求驱动项目管理应用——用户只描述要什么，它接管从需求到交付的全过程，让项目规模化后不腐烂。**

用户管需求和优先级，它扮演产品经理 + 架构师：拆分与合并需求、编排 AI 编程工具执行、维护文档、跑合规、复现 bug、在交付前自检并请你验收。代码由 Claude Code / Codex / Cursor 等智能编程工具写——你不需要读，主界面只在需求层操作，查看代码是兜底而非主路径

技术栈：Electron + electron-vite，UI 是 React 19 + Tailwind v4 + zustand，面板用 dockview，
拖拽用 @dnd-kit，富文本用 tiptap、代码编辑器用 monaco，内嵌终端用 xterm + node-pty（用来跑各家 agent CLI），
文件监听用 chokidar。

## 常用命令

```bash
npm run dev            # electron-vite dev —— 启动应用（开发）
npm run build          # 构建主/预加载/渲染三端
npm start              # electron-vite preview（预览已构建产物）
npm run typecheck      # tsc 两套 config：tsconfig.node.json + tsconfig.web.json
npm test               # vitest（watch）
npm run test:run       # vitest run（单次跑全部）
npm run test:coverage  # vitest run --coverage
npm run test:e2e       # 先 electron-vite build 再 playwright test
npm run package        # 构建 + electron-builder 打包

# 跑单个测试文件 / 单个用例
npx vitest run path/to/file.test.ts
npx vitest run -t "用例名片段"
```

单元/契约测试用 Vitest（happy-dom 环境 + @testing-library/react）；端到端用 Playwright（用例在 `e2e/`），
注意 `test:e2e` 会**先 build 再跑**，改了主进程/预加载代码要重新构建才会生效。
`packages/` 下的子包各有自己的测试。给用户dogfood本项目时必须使用 `npm start` 不监听源码，否则会导致热重载，造成半合并的死循环。

## 在本仓库工作的约定

- **UI 遵守品牌规范**：改或加任何界面前，先看 **`docs/brand`**，新界面按它来、不要另起一套配色或加投影，需要深浅两套UI。设计令牌是单一来源，定义在 `src/renderer/src/index.css` 的 `@theme`；品牌 logo 用 `src/renderer/src/components/KlaritLogo.tsx`。如果品牌规范内确实缺失我们需要的UI规范，可向用户反馈并申请修改规范。
- **深色靠令牌覆盖，所以只用语义令牌、绝不硬编码颜色**：深浅主题由 `index.css` 的 `html[data-theme='dark']` 覆盖 `--color-*` 实现，主进程按外观偏好+系统明暗解析后写 `<html data-theme>`（`theme-rendering` 能力）。因此组件配色**只能用语义令牌类**（`bg-canvas`/`bg-paper`/`text-ink`/`border-stone-*`/`*-cobalt-*` 等）——令牌覆盖只对用令牌的组件生效。**禁止**用 Tailwind 原生色（`bg-white`/`bg-black`/`text-gray-*` 等）当界面表面或文字，它们深色下不翻色会翻车（白底白字、`bg-ink` 当遮罩会变白罩）。唯一例外：模态遮罩 scrim 用 `bg-black/50`（深浅都要稳定的暗罩），彩色按钮上的 `text-white` 可保留。
- **测试先行（不可妥协）**：写实现前先写测试并确认先红后绿；测试针对**公共 API** 完整覆盖行为，不要为可测性导出私有或拆函数。详见上方 constitution。
- **提交遵循 Conventional Commits**（commitlint + husky 已装），破坏性变更加 `!` 或写 `BREAKING CHANGE:`。
- **依赖默认上前沿**：加依赖先 `npm view` 查 latest，别凭印象用老版本；工具链以编排器最新稳定版为上限。
- 写中文文档/spec 用大白话，别直译英文 jargon（项目已用的词如 dogfooding 可沿用）。
- 动态文档（种子文档 / spec / architecture）只记**最新现状**，不留旧版、不写与旧版差异；过时就直接改或删。
