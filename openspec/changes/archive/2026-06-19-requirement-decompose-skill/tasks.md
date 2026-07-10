## 1. 需求卡模型（shared 纯逻辑，无 fs）

- [x] 1.1 在 `src/shared/types.ts` 定义 `CandidateCard`（预取名、标题、描述、分类、关系）、`RequirementCard`（候选 + 系统字段 status/时间戳）、`CardCategory`（`epic`/`feature`/`bug`）、`CardRelation`（`kind: parent|child|blocked_by|blocks|coupled_with`，target）类型
- [x] 1.2 写 `src/shared/requirement-card.test.ts`（先红）：`validateCandidateCard` 覆盖——合法候选通过、空标题/未知分类/非法关系类型被拒、关系 target 须为字符串；`toProposedName` 把「增加暗色模式 (Dark Mode)」规整为合法 slug、拒含空格/斜杠/大写的预取名、冲突加后缀去重；完整卡往返字段保持
- [x] 1.3 实现 `src/shared/requirement-card.ts`（`validateCandidateCard`/`validateRequirementCard`/`toProposedName`）使测试转绿；状态封闭词表与默认 `未开始`

## 2. 工作流「新建需求」分解指令（model + 校验）

- [x] 2.1 在 `src/shared/types.ts` 给 `WorkflowDefinition` 增可选 `newRequirementInstruction?: AgentInstruction`
- [x] 2.2 在 `src/shared/workflow.test.ts` 补用例（先红）：声明 inline 往返保持、file 形态合规相对路径通过、越界路径被拒、未声明仍合法
- [x] 2.3 在 `src/shared/workflow.ts` 的 `validateWorkflow`：仅当声明时复用 `validateInstruction`；确认 `serializeWorkflow`/读回往返保持该字段，使测试转绿

## 3. 工作流编辑器：编辑「新建需求」prompt

- [x] 3.1 在 `WorkflowEditor.test.tsx` 补用例（先红）：工作流级「新建需求 prompt」手写态存为 inline、使用文件态复用新建/导入控件、越界路径阻止保存
- [x] 3.2 在 `WorkflowEditor.tsx` 工作流级区域（区别于节点）加「新建需求 prompt」编辑，复用 `PackageFileField`；保存经既有 `validateWorkflow` 路径；仅用语义令牌、深浅双主题、遵循 `docs/brand`

## 4. 全局默认分解 skill 存储与种子（main）

- [x] 4.1 写 `src/main/global-skill-store.test.ts`（先红）：`write/import/read` 全局默认分解 skill——越界路径被拒、导入拷入受管目录、`seedIfMissing` 首次写入内置默认 skill 文本
- [x] 4.2 实现 `src/main/global-skill-store.ts`：存 `userData/skills/decompose-default.md`，导入约束同节点 prompt（拷入、越界拒绝、可读回），使测试转绿
- [x] 4.3 撰写内置默认分解 skill 文本（markdown）：写明「怎么把一大段描述分解成多张候选卡」+ 候选卡 JSON schema（标题/描述/分类/关系/预取名），作为 skill 单一来源；在 `index.ts` 装配 store 并首次需要时 seed

## 5. 分解契约：prompt 解析 + 候选卡产出（shared + main）

- [x] 5.1 写 `src/shared/decomposition.test.ts`（先红）：候选卡批校验（每张过卡模型校验、预取名本批内唯一、关系 target 引用本批某预取名、不合者带可读原因）
- [x] 5.2 实现 `src/shared/decomposition.ts`（候选卡批校验/去重）使测试转绿
- [x] 5.3 写主进程测试（先红）：`resolveDecomposePrompt`——激活工作流声明新建需求 prompt 时取之（file 形态读包内 skill）、未声明/未激活时回落全局默认 skill、始终返回非空生效 prompt
- [x] 5.4 实现 `resolveDecomposePrompt` 并经 IPC 暴露；定义分解 IPC（输入自由描述+项目上下文 → 返回结构化候选卡）；preload 暴露、补 `KlaritApi` 签名（**只到产出候选卡，不含落库**）

## 6. 全局 agent 接缝（main）

- [x] 6.1 写主进程测试（先红）：未绑定项目时触发分解给空态、不产出候选、不报错；候选携带当前绑定项目上下文（含涉及成员仓候选）
- [x] 6.2 实现全局 agent 接缝：把「新建需求」与外部调用收敛到同一「解析 prompt → 产出候选卡」链路；未绑定项目返回空态；点「创建任务」仅把候选交出（不落库——交接下一个 change）

## 7. 分解交互 UI：描述想法窗

- [x] 7.1 写描述想法窗组件测试（`@testing-library/react`，先红）：构成（附件区/多行描述/取消提交/提示文案、无蒙层）、Ctrl+V 粘贴截图纳为附件、拖入文件把路径插入描述、提交发起分解、取消不发起
- [x] 7.2 实现描述想法窗（可最小化浮窗、无 scrim）；仅用语义令牌、深浅双主题、遵循 `docs/brand`

## 8. 分解交互 UI：处理态底栏 + 重弹

- [x] 8.1 写处理态测试（先红）：提交后窗隐藏、底栏出现「建卡中」；处理中再点「新建需求」重弹并显示「正在处理需求」、不发起第二次分解；完成后自动弹审阅窗、底栏态消除
- [x] 8.2 实现底栏「建卡中」处理态指示与重弹逻辑；样式遵循品牌规范与令牌、深浅双主题

## 9. 分解交互 UI：审阅候选任务窗

- [x] 9.1 写审阅窗组件测试（先红）：逐张展示分类徽章(EPIC/FEAT/BUG)+标题+markdown 渲染描述、无蒙层；点卡弹任务详情；详情仅标题与描述可改（分类/预取名/关系只读）；描述以渲染样式呈现非源码；「创建任务」把含编辑候选交给接缝（本 change 止于此）；「取消」丢弃候选
- [x] 9.2 实现审阅候选任务窗 + 任务详情（markdown 渲染新增 react-markdown 依赖）；「新建需求」最小临时入口接通整条链路；仅用语义令牌、深浅双主题、遵循 `docs/brand`

## 10. 校验、文档与收尾

- [x] 10.1 `npm run typecheck`（node + web 两套）、`npm run test:run` 全绿（407 测试）；`npm run build` 三端构建通过
- [x] 10.2 `openspec validate "requirement-decompose-skill"` 通过；design.md 的 markdown 渲染描述按「只记最新现状」更正为「新增 react-markdown」
- [x] 10.3 自检：用户在 `npm start` GUI 下走通主链路并验收通过（含真接 agent 分解、附件路径插入正文、处理窗收底栏、审阅候选）

## 11. 验收反馈修正（描述想法窗附件 + 真接 AI）

- [x] 11.1 描述想法窗「附件」改为按钮：点击经新 IPC `pickAttachments` 弹系统文件选择器（多选），所选路径插入正文；粘贴图片经 `saveClipboardImage` 落盘后插入路径；拖入文件经 `webUtils.getPathForFile` 取路径插入正文（Electron 42 已移除 File.path）。去掉附件 chips、统一「插入正文」。补测试
- [x] 11.2 真接 AI：新增 `src/main/agent-runner.ts` 无头调用用户配置的默认 agent CLI（`claude -p` 等，prompt 走 stdin）跑分解 skill，`parseCandidateCards` 容错解析候选；替换占位 producer 为 `decomposeProducer`；未配置/失败优雅返空。补 `agent-runner.test.ts`（调用映射 + 解析容错）
- [x] 11.3 更新 proposal/design/global-agent spec：分解由「占位 stub」更正为「真实无头调用配置 agent」；Non-Goal 收窄为「写代码的 PTY 交互式后台执行 agent 运行时 + 对话 UI」
