## Why

`auto-workflow-on-import`(已落)确立了导入后自动派工作流的链路,其触发**排在文档扫描之后**(理由是单默认 agent 档期串行)。但实测 + 调研暴露一个**浪费**:

- 调研实锤:**文档登记表(`DocRegistry`/`conventionPreamble`/`habitPrompt`)在运行时只被 `archive-docs` 一个引擎操作消费**(`getDocRegistry` 唯一调用方是 `engine.ts` 的 `runArchiveDocsNode`;不进编排/分解/agent 上下文)。
- 而文档扫描现在**每次首次导入都无条件跑**(`DocumentOnboardingDialog` 挂载即 `analyze`)。
- 于是:**当项目的工作流不含 `archive-docs` 时,那次文档扫描纯属浪费**——用户还实测反馈「(生成前)还是先扫文档了」。对吃 opsx 的项目(用 `opsx:archive` 而非预制 `archive-docs`)尤其如此。

本 change 把文档扫描从「导入即无条件扫」改为**需求驱动**:先派工作流,**只有当项目的活动工作流真的用到 `archive-docs` 时才扫文档**。顺带把工作流 onboarding 的触发从「扫完→author」**翻转**为「导入→先 author」。

## What Changes

- **翻转触发链**:工作流 onboarding 的触发点从「文档分析 agent 返回」移到**导入完成**——author 成为导入后**第一个** agent 任务(不再等文档扫描)。单默认 agent 档期串行仍成立(author 先占、扫描后占)。
- **文档扫描改需求驱动**:不再在首次导入时无条件弹文档 onboarding / 跑 analyze。改为**当一个含 `archive-docs` 节点的工作流成为项目活动工作流时**(采纳自动提案 / 聊天产出 / 设置里选定 / 兜底默认——默认不含 archive-docs 故不触发),若该项目尚无文档登记表,才触发文档扫描/onboarding 去populate 它。
- **兜底稳健**:`archive-docs` 节点运行时已有「无登记表则失败挂起给清楚提示」的兜底(见 `document-archive`),本 change 只是把 populate 时机提前到「含该节点的工作流被激活」,避免跑到该节点才发现没表。
- **移除无条件导入扫描**:首次导入不再自动 `analyze`/弹 onboarding;`DocumentRegistrySettings` 的手动「重扫」保留;需求驱动触发之外,用户仍可手动扫。

## Capabilities

### Modified Capabilities
- `workflow-onboarding`: 触发点 SHALL 从「文档分析返回」翻转为**导入完成**(author 为导入后第一个 agent 任务);不再依赖文档扫描先行。判据/无头 author/进对话/审批门等其余语义不变。
- `document-registry-ui`(及其主进程分析入口 / 首次导入 onboarding 触发):文档扫描/onboarding SHALL 改为**需求驱动**——不在首次导入无条件跑,而在**含 `archive-docs` 的工作流成为活动工作流且项目尚无登记表**时触发;手动重扫保留。

## Impact

- **依赖**:建立在 `auto-workflow-on-import`(已落)之上——复用其 `runWorkflowOnboarding`、`workflow-onboarding` 判据、`lintWorkflow`/工作流模型;复用 `document-registry` 的 `document-store`/`analyzeDocuments`。
- **代码**:
  - `src/main/index.ts`:工作流 onboarding 触发从 `IPC.documentsAnalyze` 返回处(:1209 附近)移到导入路径(`importProject`/`manageImportProject`)完成后;移除/改造首次导入的无条件 `notifyDocumentsOnboard`/`maybeDocOnboard`;新增「工作流激活时若含 archive-docs 且无登记表→触发扫描」的挂钩(`setActiveWorkflow` 及采纳提案路径)。
  - 判定「工作流是否含 archive-docs」:纯结构检查 `def.nodes.some(n => n.executor.kind==='engine' && n.executor.operation==='archive-docs')`(shared 小工具)。
  - `src/renderer/src/App.tsx`:`maybeDocOnboard` 的无条件首导入触发改为受需求驱动信号驱动。
- **兼容**:纯行为调整,不改数据模型。既有手动重扫、既有已 populate 的登记表不受影响。含 archive-docs 的工作流照旧能用(扫描时机前移,不再靠运行到该节点才补)。
- **不在本 change**:「预制 archive-docs 退兜底、优先用项目自带归档(opsx)」归**步骤 2 `workflow-from-habits`** 的 skill 打磨(与本 change 互补:本 change 决定「扫不扫」,步骤 2 影响「工作流用不用 archive-docs」)。
