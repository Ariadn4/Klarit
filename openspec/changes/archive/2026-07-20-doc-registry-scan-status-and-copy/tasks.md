## 1. 扫描进度移到底栏（renderer，测试先行）

- [x] 1.1 写红：新增底栏扫描状态组件测试——`analyzing` 为真时渲染不可交互的扫描中状态（无 button/可点元素），为假时不渲染
- [x] 1.2 写红：`DocumentOnboardingDialog.test.tsx` 改判——分析进行中确认步**不出现**（无 dialog），分析完成后弹窗推出且直接是两栏编辑器
- [x] 1.3 实现底栏扫描状态组件（语义令牌、只告知不可交互），挂进 App 底栏状态条区
- [x] 1.4 `DocumentOnboardingDialog`：扫描期间不渲染弹窗（分析仍照常触发），完成后推出完整编辑器
- [x] 1.5 跑绿：对应测试

## 2. 登记表用途说明 + 术语改口（renderer，测试先行）

- [x] 2.1 写红：`DocumentRegistryEditor.test.tsx` 断言标题下用途说明存在（含「归档」节点与 agent 参考两层意思）、规定框标为「文档规定」、公约区标为「项目级文档公约」，界面不出现「习惯 prompt」
- [x] 2.2 改 `zh.ts`/`en.ts` 文案：`habitPromptLabel`/`habitPromptAria`/`habitPromptDescription`、`convention`/`conventionDescription`，新增登记表用途说明键
- [x] 2.3 `DocumentRegistryEditor.tsx` 渲染用途说明
- [x] 2.4 跑绿：对应测试

## 3. 公约起草收窄到语言 + 目录约定（main，测试先行）

- [x] 3.1 写红：`document-scan.test.ts` 断言分析 prompt 的公约段只要语言与目录约定、明说不写风格类内容且要简短
- [x] 3.2 `document-scan.ts`：改 `buildAnalyzePrompt` 的公约起草指令
- [x] 3.3 跑绿：对应测试

## 4. 全量校验

- [x] 4.1 `npm run typecheck`
- [x] 4.2 `npm run test:run`（全绿）
