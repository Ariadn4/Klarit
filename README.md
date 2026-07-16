# Klarit

**面向 vibe coder 的需求驱动项目管理应用——你只描述要什么，它接管从需求到交付的全过程，让项目规模化后不腐烂。**

用户管需求和优先级，Klarit 扮演产品经理 + 架构师：拆分与合并需求、编排 AI 编程工具执行、维护文档、跑合规、复现 bug、在交付前自检并请你验收。代码由 Claude Code / Codex / Cursor 等智能编程工具写——主界面只在需求层操作，看代码是兜底而非主路径。

技术栈：Electron + electron-vite，UI 是 React 19 + Tailwind v4 + zustand，面板用 dockview，拖拽用 @dnd-kit，富文本用 tiptap、代码编辑器用 monaco，内嵌终端用 xterm + node-pty，文件监听用 chokidar。

## 常用命令

```bash
npm run dev            # 启动应用（开发）
npm run build          # 构建主/预加载/渲染三端
npm start              # 预览已构建产物（dogfood 用这个，不监听源码）
npm run typecheck      # tsc 两套 config
npm run test:run       # vitest 单次跑全部
npm run test:e2e       # 先 build 再 playwright
```

## 文档

动态文档只记**最新现状**（不留旧版、不写与旧版差异）。想了解某块前先读对应文档：

- [`docs/project-goals.md`](docs/project-goals.md) —— 产品定位、范围边界、三层 Agent 结构。
- [`docs/agent-skill-rail.md`](docs/agent-skill-rail.md) —— **全局 agent 的产出 rail**（skill → 结构化产出 → 校验 → 人审 → 落地）。给全局 agent 加新能力前先读这条约束。
- [`docs/failure-handling.md`](docs/failure-handling.md) —— 工作流执行期的失败处置（合并冲突/命令失败 heal、评审门驳回的内容驱动回退）。
- [`docs/brand`](docs/brand) —— 品牌与 UI 规范（改任何界面前先看；深浅双主题、只用语义令牌）。
- `openspec/specs/` —— 各能力的行为规格（单一来源）；`openspec/changes/` —— 进行中的变更提案。

面向 Claude Code 的仓库约定见 [`CLAUDE.md`](CLAUDE.md)。
