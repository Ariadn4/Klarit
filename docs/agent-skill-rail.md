# 全局 agent 的产出 rail（skill → 结构化产出 → 校验 → 人审 → 落地）

这份文档记全局 agent 一条**稳定的架构约束**：它的每项「帮用户干活」能力都骑在同一条 rail 上，而不是各自造一套产出逻辑。给全局 agent 加新能力时，**默认往这条 rail 上加一个骑手**，别另起炉灶。

## 这条 rail 长什么样

```
用户在 GlobalChat 说一句话
        │
        ▼
  编排核 orchestrate(intent, projectId, conversationId?)
        │  装配上下文（全盘卡视野 + 关系图 + 项目目标/宪法 + 可选工作流摘要…）
        │  把各能力的 skill 段就地拼进同一个 prompt
        ▼
  真实调用用户配置的默认 agent CLI（只读姿态、复用用户订阅、不自建模型通道）
        │
        ▼
  解析回复为结构化产出（parseOpsReply 一类判别式）
        │
        ▼
  校验（不旁路）；失败按能力约定处理（丢进 issues / 修好再报）
        │
        ▼
  产出提案（OrchestrationProposal）——只提案、不落盘
        │
        ▼
  人在 UI 审阅、确认
        │
        ▼
  系统落地（applyOps 落卡库 / workflow-store.save() 存工作流 / …）
```

## 骑在上面的能力（骑手）

| 能力 | skill 来源 | 结构化产出 | 校验 | 落地目标 |
|---|---|---|---|---|
| **orchestrate**（编排卡） | 内联 system prompt | `ops`（create/adjust/split/merge/relate） | `card-ops` 逐 op 校验 + 容错修复 | 卡库（`applyOps`） |
| **decompose**（新建需求特例） | 工作流指令 → 全局覆盖 → 由类型注册表自动生成 | 候选卡批 | `validateCandidateBatch` | 卡库（经 create ops） |
| **suggestedProject**（提议新建项目） | 内联 system prompt | `suggestedProject` + 一批 create ops | 按所选工作流类型集校验 | 建/绑项目 + 种卡 |
| **author-workflow**（写/改工作流） | 由数据模型自动生成（`buildAuthorWorkflowSkill`） | `workflow`（完整 `WorkflowDefinition` + 可选 baseId） | `validateWorkflow` + `checkBranchPairing`，修好再报 | 工作流库（`workflow-store.save()`） |

## 技能的三种形态与「安装进 CLI」

Klarit 里「技能」（skill）是一段可复用的 agent 指令。**同一套形态既用于工作流 agent 节点的驱动指令，也用于 Klarit 自己驱动全局 agent 的流**（分解 / 写工作流 / 编排人格）。三种承载形态：

| 形态 | 是什么 | 何时用 |
|---|---|---|
| **inline** | 写死在节点里的一段临时 prompt 文本 | 一次性、不复用的指令 |
| **外部技能文件（file）** | 用户提供/导入的一份 skill markdown，物理放在**工作流包内**（相对包路径） | 团队自带、随包版本化流通的技能 |
| **已装技能（installed）** | 引用用户的编程 CLI 里**已经安装**的技能，**按名字调用**（如 Claude Code 的 `opsx:explore`）；Klarit 不嵌入、不指路径，运行时让 CLI 自己 invoke 它 | 复用 CLI 生态里现成的技能，不把内容搬进包 |

**关键原则：引用已装技能时，只给名字，不臆测其行为/产物、不指本地路径。** 运行时 agent（Claude Code / Codex / Cursor…）自带它已装的技能与工具，Klarit 只需按名字点它。写死相对路径或臆测「这个技能只产出某个 .md」都是错的（这正是 dogfood 里 `opsx:explore` 被误解的根因）。

**Klarit 自己的全局对话技能，应当作为「已装技能」安装进用户使用的 CLI**——而不是每轮把技能文本内联进 prompt。这样：
- CLI 原生按名字调用，prompt 更瘦、技能文本不重复占上下文；
- 用户能看到 / 改 / 自己调这些技能（它们就在用户的 CLI 里）；
- 工作流节点与 Klarit 流引用技能的方式**统一**（都按名字）。
- **回落**：CLI 没有「已装技能」机制时，回落到内联合成（现状），不回归。

安装由**按 CLI 的适配器**负责（Claude Code → 写进其技能目录；其它工具 → 各自机制或回落内联）；Klarit 在合适时机把自带技能幂等安装/更新进用户当前默认 agent 的 CLI。

## 不可动摇的红线（每个骑手都得守）

1. **只读、绝不碰代码/git**。全局 agent 只编排**管理态**（需求卡、工作流），写代码是后台执行 agent 的活。驱动它的运行以只读姿态进行，系统**不消费**它对文件的任何写。
2. **只提案，人确认后才落地**。agent 提议 → 人确认 → 系统执行。产出在确认前不落盘。
3. **限当前项目、不跨项目**。全盘视野只含当前窗口绑定的那个项目；未绑定项目仍可对话，并可提议新建项目承载。
4. **skill 从单一来源来，永不与校验器漂移**。凡是能自动生成的 skill，就从数据模型的单一来源生成（`buildDecomposeSkill(types)` 从类型注册表、`buildAuthorWorkflowSkill()` 从引擎操作集/执行者联合/校验约束），别手写一份会跟校验规则对不上的 skill 文本。
5. **校验不旁路**。产出一律过既有校验闸；不合法的不静默回落、不当合法用，按能力约定要么进 issues 供人审、要么修好再报问题（半成品不丢）。
6. **一次调用完成自路由**。agent 在一轮内于「自由聊天 / 产 A / 产 B」之间自选（各能力 skill 内联在同一 prompt 里），自然语言 `reply` 永远第一位；纯聊天是有效轮次、不算失败。

## 给全局 agent 加一个新能力的配方

1. **写 skill**：能自动生成就从数据模型单一来源生成一个 `buildXxxSkill()`（shared 纯函数），拼进编排 prompt。
2. **加产出字段**：在 `OrchestrationProposal` 与解析器（`parseOpsReply` 一类）里加一个判别分支，收敛为该能力的结构化产物。
3. **接校验闸**：复用该产物已有的校验函数；定失败 UX（丢 issues 还是修好再报）。
4. **加提案 UI**：在审阅面板加一个与既有 proposal 平行的呈现 + 人确认动作；能复用既有编辑器/预览就复用（如工作流复用 `WorkflowEditor` 只读态）。
5. **接落地通道**：人确认后经该管理态自己的存储落地（卡库 / 工作流库 / …），只此一处写盘。
6. **守红线 + 测试先行**：只读、只提案、限本项目、校验不旁路；先写测试确认先红后绿。

## 相关代码（现状锚点）

- 编排核：`src/main/orchestrate-service.ts`、产出者 `src/main/orchestrate-producer.ts`（`parseOpsReply`）
- 分解：`src/main/decompose-service.ts`、`src/shared/decomposition.ts`（`buildDecomposeSkill`）
- 工作流数据模型与校验：`src/shared/workflow.ts`（`validateWorkflow`/`checkBranchPairing`/`workflowSummary`）
- 工作流存储：`src/main/workflow-store.ts`（`save`）
- 面板：`src/renderer/src/components/GlobalChatPanel.tsx`、`src/renderer/src/stores/globalChat.ts`

对应 OpenSpec 能力：`global-agent`、`requirement-orchestration`、`global-agent-chat`、`card-ops-review-apply`、`workflow-authoring`。
