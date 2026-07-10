## Why

工作流里 agent 节点编辑界面(`WorkflowEditor.tsx` 的 `NodeDetail`)只让用户填**节点自己那段 prompt**,但 agent 真正收到的是「节点 prompt + 宪法 + 可写范围 + 产出/模板 + 客观门 + 运行时注入的需求卡」拼出来的**完整 prompt**。用户看不到这个完整体,无从判断自己写的指令在全局上下文里到底长什么样、宪法有没有生效、产出/门有没有被正确告知 agent。

更关键的是:**目前代码里根本没有把这些层拼成 agent 完整 prompt 的地方**。agent 节点还是占位(`workflow.ts:247`「占位,将来由 agent 干活」),唯一存在的拼装是分解流程的 `buildDecomposeMessage`(`agent-runner.ts:31`),与工作流节点无关;宪法虽有 `deriveEffectiveConstitution`(`rule-pack.ts:128`)却从没被拼进任何 agent prompt。所以「查看完整 prompt」这个按钮,本质是逼我们**先定义** agent 节点到底提交什么——这个定义会成为将来 agent 执行器的事实契约。

## What Changes

- 新增一个**纯函数拼装器** `assembleAgentPrompt`(住 `src/shared/`):给定一个 agent 节点 + 该项目的生效宪法 + 已解析的产出模板内容,确定性地产出该节点提交给 AI 的**完整 prompt 文本**。
- 拼装层次(固定顺序):**回复语言 → 宪法 → 节点 prompt → 需求卡占位 → 可写范围 → 产出/模板**。
  - **回复语言**:据设置里的界面语言(`zh`/`en`)要求 AI 用对应语言回复与产出,恒在、置最前。
  - **需求卡用占位槽**(决策 A):编辑器看到的是模板、没有具体卡,故在卡位置插一个显式占位标记,并**说明运行期会注入哪些字段**(标题/类型/描述/关系),诚实区分模板期与运行期。
  - **产出/模板拼进去**:以引导语开头(这些是要产出的文件、按模板结构写、删 `<!-- -->` 写作指引注释),每个产出标清路径 + 必选/可选 + 模板内容;规则库引用 MUST 解析成实际内容再拼。
  - **执行配置(工具/模型/额外参数)与客观门不进 prompt 文本**——执行配置是 CLI 调用形态;客观门(自动校验由 gate 自动跑、人工评审是给人的按钮)不是给 agent 的指令。
- agent 节点编辑界面(`NodeDetail`)的顶栏(与保存同行)新增一个 **file-text 图标按钮**,仅在执行者类型为 `agent` 时呈现;点击弹出**只读模态**展示拼装出的完整 prompt(反映当前正在编辑的、未保存的节点状态)。
- 文件模式(「使用文件」)的节点 prompt 在预览前 MUST 先读出 skill 文件内容再拼(复用 `readSkillFile`)。
- **单一来源约束**:此拼装器 MUST 是将来 agent 执行器实际拼 prompt 所用的同一个函数——预览即可执行的契约,二者不得各拼一套。

## Capabilities

### New Capabilities
- `agent-prompt-assembly`: 确定性纯函数把一个 agent 节点拼成提交给 AI 的完整 prompt(回复语言 + 宪法 + 节点 prompt + 需求卡占位 + 可写范围 + 产出/模板),需求卡以显式占位表示并说明注入字段、产出带引导语、执行配置与客观门不入文本、模板引用解析为内容,且此拼装器为预览与将来执行器的单一来源。

### Modified Capabilities
- `workflow-editor`: 新增「查看 agent 节点完整 prompt」预览——agent 节点详情顶栏的 file-text 图标按钮打开只读模态,经 `agent-prompt-assembly` 渲染当前(含未保存)节点的完整 prompt。

## Impact

- **新增代码**:`src/shared/agent-prompt.ts`(`assembleAgentPrompt` 纯函数 + 占位/分节常量)及其单测;预览模态组件;file-text 按钮接入 `DetailHeader`(经可选 action 槽,仅 agent 节点)。
- **新增 IPC**:一个「解析并拼装某节点完整 prompt」的预览查询(主进程侧解析生效宪法 + 读 skill 文件 + 解析产出模板引用后调纯函数),或在渲染层组合已有 `effectiveConstitution` / `readSkillFile` / 规则库数据后调纯函数——二选一在 design 决策。
- **复用既有**:`deriveEffectiveConstitution`(`rule-pack.ts:128`)、`effectiveConstitution` IPC(`index.ts` ~660)、`readSkillFile`(`PackageFileField` 已用,`WorkflowEditor.tsx:215`)、规则库 `output-template` 解析、`BranchPairingDialog` 的 portal 模态写法、品牌设计令牌。
- **不改动**:工作流/规则包持久化格式、节点数据模型(`types.ts` 的 `WorkflowNode`/`AgentInstruction` 不变)、分解流程的 `buildDecomposeMessage`。
- **为将来铺路**:`assembleAgentPrompt` 落地即是 agent 执行器的 prompt 拼装契约,执行器落地时直接复用、并在卡位置注入真实需求卡。
- **测试**:拼装器层次顺序/占位/模板解析/空层省略的纯函数单测;预览只对 agent 节点呈现、反映未保存状态、文件模式读内容的组件测试。
