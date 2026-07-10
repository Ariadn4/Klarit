## 1. 测试先行(先红)

- [x] 1.1 拼装器纯函数单测:全层齐备时按固定顺序产出(宪法 → 任务 → 需求卡占位 → 可写范围 → 产出 → 客观门),断言各分节标志性文案与顺序
- [x] 1.2 需求卡占位测试:无论是否有卡数据,卡位置恒为显式占位标记(决策 A)
- [x] 1.3 模板解析测试:产出模板为 `ref` 时拼入已解析的 `output-template` 内容;为 `none` 时注「无模板」;ref 解析不到时降级提示而不崩
- [x] 1.4 客观门测试:auto(inline 命令 / 解析后的 ref 命令)与 manual(动作按钮 文案→命令)分别正确拼入;门为空时整节省略
- [x] 1.5 空层省略测试:宪法为空 / 可写范围为空(注「整条分支可写」)/ 产出为空 / 门为空时,各自按约定省略或给默认说明,不留空标题
- [x] 1.6 单一来源/确定性测试:同一输入多次调用产出逐字相同(纯函数,无 `Date.now`/随机)
- [x] 1.7 预览组件测试:仅 `executor.kind === 'agent'` 的节点详情顶栏出现 file-text 按钮;engine/command/subworkflow 不出现
- [x] 1.8 预览组件测试:点击按钮打开只读模态、展示拼装结果;反映当前(含未保存)编辑中的节点 prompt/可写范围
- [x] 1.9 文件模式测试:节点 prompt 为 file 形态时,预览先读 skill 文件内容再拼;读失败时该层显错不崩

## 2. 拼装器(纯函数,单一来源)

- [x] 2.1 新增 `src/shared/agent-prompt.ts`:`assembleAgentPrompt(input)` + 分节标题/占位常量;输入含 节点 prompt 已解析文本、生效宪法、可写范围、产出(含已解析模板内容)、客观门(含已解析 ref 命令)
- [x] 2.2 实现层次顺序与空层省略(决策 2);需求卡恒为占位(决策 3);执行配置不入文本
- [x] 2.3 跑 1.1–1.6 转绿

## 3. 预览数据备齐(主进程 IPC)

- [x] 3.1 新增预览 IPC(如 `previewAgentNodePrompt(workflowId, node)`):主进程解析当前项目生效宪法(复用 `deriveEffectiveConstitution`)+ file 模式读 skill 文件 + 解析产出模板规则库引用 → 调 `assembleAgentPrompt` → 返回字符串(决策 4)
- [x] 3.2 preload 暴露该 IPC;`types.ts` 补 IPC 契约类型(不改 `WorkflowNode`/`AgentInstruction` 数据模型)

## 4. 编辑界面接入

- [x] 4.1 `DetailHeader` 加可选 `extraActions?`,渲染在保存按钮左侧同一行(其它详情页不传、行为不变)
- [x] 4.2 `NodeDetail` 仅当 `node.executor.kind === 'agent'` 时传入 file-text(lucide `FileText`)`IconButton`,点击打开预览模态
- [x] 4.3 预览模态组件:portal + scrim `bg-black/50` + `bg-paper` 卡 + `role="dialog"`/`aria-modal` + 滚动 `<pre>` 只读展示 + 关闭(照 `BranchPairingDialog`);调 3.1 IPC、传当前编辑中的节点
- [x] 4.4 一行说明点明「需求卡运行时注入、执行配置另经 CLI」(避免误读预览为运行全量)
- [x] 4.5 仅用语义令牌、深浅双主题、遵循 `docs/brand`;新增界面文案走 i18n(zh/en)
- [x] 4.6 跑 1.7–1.9 转绿

## 4.5 dogfood 反馈调整（拼装契约修订）

- [x] 4.5.1 客观门移出 prompt:去掉 `# 客观门` 层与 `resolveGate`(自动校验由 gate 自动跑、人工评审是给人的按钮,非 agent 指令);更新 spec/design/proposal
- [x] 4.5.2 产出加引导语 + 文件框架 + 模板围栏:每个产出 `## 产出文件：路径（必选/可选）`,模板原文用 ```` ```markdown ```` 围栏包住 + 前导语(说明删 `<!-- -->`);路径为空给「未指定路径」
- [x] 4.5.3 需求卡改为按字段分子标题(## 标题/类型/描述/关系)+ 每字段一行运行期注入槽,把卡注入结构钉死
- [x] 4.5.4 新增「回复语言」层:据设置 `language`(zh/en)要求 AI 用对应语言回复,恒在置最前;主进程传入 `settings.language`
- [x] 4.5.5 更新拼装器单测覆盖以上四点,转绿

## 5. 校验与收尾

- [x] 5.1 `npm run typecheck` 与 `npm run test:run` 全绿
- [x] 5.2 dogfood:`npm start`,打开某工作流 agent 节点 → 点 file-text → 确认模态展示回复语言/宪法/任务/需求卡字段槽/可写范围/产出,且改 prompt 后重开预览能反映未保存改动
- [x] 5.3 dogfood:非 agent 节点(engine 等)确认无此按钮;深浅主题各看一遍模态配色稳定
