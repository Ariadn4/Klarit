## Context

agent 节点编辑界面是 `src/renderer/src/components/WorkflowEditor.tsx` 的 `NodeDetail`(行 1027–1154):节点名/阶段/执行者类型 + `ExecutorFields`(行 366–550,agent 分支含手写/使用文件切换、prompt、执行配置)+ 可写范围 + 产出 + 门。顶栏由 `DetailHeader`(`src/renderer/src/components/ui/SettingsHeaderSlot.tsx:28-57`)渲染,右侧是「已保存」文案 + 保存 `IconButton`,经 `HeaderActions` portal 到设置面板顶栏(与关闭 X 同行)。截图红框即此处。

agent 节点的 prompt 不是顶层字段,住 `executor.instruction`(`types.ts` 的 `AgentInstruction = {kind:'inline',text} | {kind:'file',path}`);另有 `executor.exec?`(`AgentExecConfig` 工具/模型/额外参数)、`node.writableScope?`、`node.outputs`(模板可 `ref` 规则库 `output-template`)、`node.gate`(auto:命令/ref;manual:动作按钮)。

**现状缺口**:没有任何代码把这些层拼成 agent 完整 prompt。agent 节点是占位(`workflow.ts:247`);唯一拼装是分解流程的 `buildDecomposeMessage`(`agent-runner.ts:31`),拼的是「分解 skill + 用户描述 + 只输出 JSON」,与工作流节点无关。宪法侧已有纯函数 `deriveEffectiveConstitution(packs, governance)`(`rule-pack.ts:128`)产出 `EffectiveConstitutionRule[]`,并经 `effectiveConstitution` IPC(`index.ts` ~660)暴露给渲染层——但从没拼进任何 agent prompt。`project-constitution` spec 已注明「引擎对生效宪法的实际注入属引擎运行期、不在该能力范围」,本变更正是补这块的契约(以只读预览先行)。

约束沿用 CLAUDE.md:测试先行、只用语义令牌、深浅双主题、动态内容只记现状。

## Goals / Non-Goals

**Goals:**
- 一个确定性纯函数 `assembleAgentPrompt`,把一个 agent 节点拼成提交给 AI 的完整 prompt 文本,层次顺序固定、可单测。
- 需求卡以**显式占位**表示(决策 A):编辑器无具体卡,占位标记诚实区分模板期/运行期。
- 产出/模板与客观门**拼进** prompt;模板的规则库引用解析为实际内容。
- agent 节点详情顶栏一个 file-text 按钮 → 只读模态预览,反映**当前(含未保存)**节点。
- 此拼装器是预览与将来 agent 执行器的**单一来源**。

**Non-Goals:**
- 不落地 agent 执行器/不真正调用 agent(仅预览;执行器是后续变更)。
- 不把执行配置(工具/模型/额外参数)拼进 prompt 文本(那是 CLI 调用形态)。
- 不在预览里注入真实需求卡(运行期才有;此处恒为占位)。
- 不改节点数据模型、持久化格式、分解流程。
- 不做可编辑预览/不让用户在模态里改 prompt(只读)。

## Decisions

### 决策 1:拼装器为 `src/shared/` 纯函数,输入已解析的内容

`assembleAgentPrompt(input) → string`,`input` 含:agent 节点(或其拆出的 prompt 文本/可写范围/产出/门)、生效宪法 `EffectiveConstitutionRule[]`、产出模板的已解析内容映射(`{packId,itemId} → content`)、节点 prompt 的已解析文本(file 模式已读出内容)。

理由:纯函数无 fs/IPC 依赖,可与现有 `shared/workflow.ts`、`rule-pack.ts` 同层、易单测、可被主进程执行器与渲染层预览共用(单一来源)。**副作用(读 skill 文件、解析宪法治理、解析模板引用)留在调用方**(主进程或渲染层),拼装本身确定。

替代:把拼装写进渲染组件——会与将来执行器各拼一套、必然漂移,排除。

### 决策 2:层次顺序与分节(已据 dogfood 反馈调整)

固定顺序(空层省略,不留空标题):

```
# 回复语言            ← 据设置语言(zh/en)要求 AI 用对应语言回复;指令以目标语言写;恒在、置最前
# 宪法                ← 生效宪法各条(name + text),稳定顺序;空则整节省略
# 任务                ← 节点 inline 文本 / file 已读内容
# 需求卡              ← 按字段分子标题(## 标题/类型/描述/关系),每字段一行运行期注入槽;恒在
# 可写范围            ← writableScope 各条;空则说明「整条分支可写」
# 产出                ← 引导语 + 每个文件(## 产出文件：路径（必选/可选）),模板原文用 ``` 围栏包住 + 前导语
```

理由:回复语言是统管全局的元指令、置最前;宪法作公共契约其次;任务居中;需求卡占位紧随任务(运行期把卡接在任务上下文里);可写范围/产出殿后作为边界与产出约束。分节标题用中文大白话(对齐 CLAUDE.md);具体分节文案在实现期定,spec 只约束「含哪些层、什么顺序、卡为占位且说明注入字段、产出带引导语」。

dogfood 反馈带来的三处调整(相对初版):
- **客观门移出 prompt**:自动校验由 gate 自动跑、人工评审是给人点的动作按钮,都不是给 agent 的指令,放进去是噪音 → 不拼。
- **产出加引导语 + 文件框架 + 模板围栏**:裸贴模板内容(含 `<!-- -->` 写作指引、`##` 标题)AI 分不清"哪些是结构、哪些要我填",且模板标题与外层分节同级打架。改为引导语开头 + 每个文件 `## 产出文件：路径（必选/可选）` + 模板原文用 ```` ```markdown ```` 围栏包住 + 前导语(说明这是模板原文、删 `<!-- -->`);路径为空给「未指定路径」。
- **需求卡改为按字段分子标题 + 注入槽**:从一行含糊占位改为每字段一个 `##` 子标题(标题/类型/描述/关系)+ 一行 `{运行时注入：…}` 槽,把卡注入的结构钉死、预览与执行同构。
- **新增回复语言层**:据设置 `language` 要求 AI 用对应语言回复与产出。

### 决策 3:需求卡占位(决策 A),非「选卡预览」

编辑器层是模板、无运行时卡。预览恒在卡位置插占位标记,不挑真卡渲染。

理由:最诚实地区分模板期与运行期、UI 最轻、无需引入选卡器;将来执行器在同一位置用真实卡替换占位即可,契约位置一致。代价:预览看不到「卡填进去后」的最终形态——可接受(B「选卡预览」留作后续增强,不在本次)。

### 决策 4:预览数据如何备齐——主进程 IPC 一把梭

新增一个预览查询 IPC(如 `previewAgentNodePrompt(workflowId, node)`):主进程侧解析当前项目生效宪法 + (file 模式)读 skill 文件 + 解析产出模板规则库引用 → 调 `assembleAgentPrompt` → 返回拼好的字符串。

理由:把三处副作用(宪法治理、读文件、解析模板)收敛进主进程一次往返,渲染层只管「传当前编辑中的节点、拿字符串、显示」,简单且与「拼装器单一来源」一致。**传入的是当前(含未保存)节点**,故预览反映用户正在写的内容。

替代:渲染层用已有 `effectiveConstitution`/`readSkillFile`/规则库数据自行组合后调纯函数——少加一个 IPC,但把解析逻辑散在渲染层、与执行器(主进程)不同源,排除。

### 决策 5:按钮接入 `DetailHeader` 的可选 action 槽,仅 agent 节点

`DetailHeader` 加一个可选 `extraActions?: React.ReactNode`(渲染在保存按钮左侧、同一 flex 行)。`NodeDetail` 仅当 `node.executor.kind === 'agent'` 时传入 file-text `IconButton`;其它详情页(建议类型等)不传、行为不变。

理由:`DetailHeader` 多页共用,不能把按钮焊死进所有 header;可选槽既复用顶栏布局又只在 agent 节点出现。按钮用 lucide `FileText`,`IconButton`(原生 title + aria-label),与保存图标一致风格。

### 决策 6:只读模态,复用 portal 写法

预览用 portal 模态(照 `BranchPairingDialog`,`WorkflowEditor.tsx:1251`):scrim `bg-black/50`、`bg-paper` 卡、`role="dialog"`/`aria-modal`、内容区滚动的 `<pre>` 只读展示完整 prompt,关闭按钮。

理由:完整 prompt 通常很长,模态比 `PackageFileField` 那种内嵌 `<pre>` 读着舒服;portal + 令牌 + 深浅稳定的暗罩已是仓库既定模式。

## Risks / Trade-offs

- **契约会被将来执行器复用**:层次顺序/分节文案一旦定,执行器若想改格式要连带改预览(因单一来源)。缓解:把"含哪些层/顺序/卡占位"写进 spec(稳定),分节具体文案留实现层(可调),减少返工面。
- **预览 ≠ 运行真值**:卡是占位、执行配置不在文本里,用户可能误以为「这就是 agent 收到的全部」。缓解:占位文案与(可选)一行说明点明「需求卡运行时注入、执行配置另经 CLI」。
- **文件模式读盘失败**:skill 文件缺失/读不出时预览该层显错(复用 `cannotReadContent` 文案),不崩、不阻塞其它层。
