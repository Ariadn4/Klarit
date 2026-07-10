## Why

现有全局 agent 只是「新建需求」的最小接缝：只会 `create`（建卡）、只看用户当次输入的一段自由文本、没有全盘视野，也无法多轮对话或被程序化调用。但 `docs/project-goals.md` 里全局 agent 的定位是**需求编排 + 用户头牌入口**——有全盘视野（项目目标 + 所有卡 + 关系图），把用户的自由意图解读成成套【卡操作】，并作为别处（单卡对话 / 门自由输入）识别出「塑造需求」后的**升级目标**。本 change 把那条最小接缝扩成完整的需求编排 agent，补齐这条升级链的落点。

## What Changes

- **全盘视野**：全局 agent 的上下文从「一段自由文本」扩为**项目所有卡的活现状摘要 + 关系图 + 项目目标 / 生效宪法**（限本项目、有 token 预算与显式截断）。
- **自由对话 + 意图识别 → 调技能产出卡操作**：全局 agent 是一个**自由对话助手**（像 Claude Code 那样）——能自由聊天/讨论/答疑；**回复永远是第一位**、纯聊天是有效轮次（不是失败）。当它**识别到可执行意图**时，按对应**技能**（`create` 新建 / `adjust` 改 / `split` 拆 / `merge` 并 / `relate` 关系 / 新建项目）的输出格式产出成套【卡操作】。技能说明**内联进 agent 的 prompt**（单 agent 会话核·技能内联），各技能格式即该操作的单一来源。
- **破坏性收边（约束）**：结构性 ops（split/merge/adjust/relate）**只作用于「待办列」的卡**（leaf 未开始/无 `activeRunId` + container 卡）；已离开待办的卡（进行中/已暂停/等待决策/已完成）**不做跨卡结构操作**，改为**建议新建需求**。⇒ split/merge 只发生在「未跑卡」间，天然免除分支/产物重分配。
- **全局对话面板（新用户入口）**：一个常驻面板，用户多轮跟全局 agent 聊（「我想要 X」/「把 A、B 合并」/「这卡拆两半」），**可多开**、会话**持久化到 userData**、多轮经原生续接（`--resume`）接上。与现有「待办列 + 创建·描述想法」**并列保留、共用编排核**。
- **全局对话是永远可用的入口（不以绑定项目为前提）**：用户把它当作单一、随时可开的全局入口，不预设「当前在哪个项目」，会混着提当前项目的需求与「要做个新东西」的新项目需求。因此面板**无需绑定项目即可打开、agent 随时可起**；会话**按项目分开**（每个项目各有各的会话，未绑定窗口用独立作用域），不同项目窗口互不串。
- **意图落位（当前项目 / 新项目）**：编排的全盘视野**仍限当前窗口绑定的那个项目**（agent 永不看别的项目的卡，故天然不会跨项目误操作）。当意图属于当前项目 → 直接编排其卡；当意图是**一个新项目**（或当前未绑定项目）→ agent **提议新建项目**，用户确认后**选一个目录**建/导入项目（复用现有 `importProject`），随即把该批需求 `create` ops **自动种入新项目**。
- **提案 → 人确认 → 应用**：卡操作以**提案**呈现（泛化自 decompose 审阅流），逐 op 校验、破坏性 ops（merge/split/删卡）二次确认；用户确认后经 cardStore 应用。
- **对话可选 agent/模型**：全局对话面板可**按会话**选用哪个编程 agent（claude/codex/cursor）与哪个模型，**覆盖全局默认**；缺省沿用全局默认。选择随会话持久化。
- **聊天内容可复制**：聊天消息文字**可选中**；**右键消息弹上下文菜单**——「复制该消息」（复制整条消息文字）；有文字选区时另给「复制选中的文字」。复用既有 `copyText` 剪贴板通道。
- **可被程序化调用**：暴露 `orchestrate(intent, projectId, conversationId?) → 提案 ops` 编排核，供将来单卡对话 / 门自由输入识别出「塑造需求」时上抛调用（本 change 只建能力 + 全局 agent 自身聊天入口，**别处上抛的接线不在本 change**）。
- **卡库新原语**：`requirement-card-store` 补 `addRelation` / `removeRelation` / `splitCard` / `mergeCards`（维护 INVERSE 双向边、待办门控），供 apply-ops 派发。

**红线**：全局 agent **只读代码、绝不写代码**（它只编排卡）；卡操作**不直接落盘**——agent 只提案、人确认、cardStore 应用（与单卡红线一致）；全盘视野**限当前项目**（不看别的项目 → 不能对着当前项目的 agent 谈另一个已有项目的活，只能编排当前项目或提议新建项目）。

## Capabilities

### New Capabilities
- `requirement-orchestration`: 编排核——全盘视野装配（卡活现状摘要 + 关系图 + 目标/宪法 + token 预算，**限当前项目**）、卡操作 schema（create/adjust/split/merge/relate + 破坏性收边门控）、**新项目提议**（意图属新项目时产出 `suggestedProject` + 种入 create ops）、注入式 ops producer（真=流式续接 runner，测试=假全局 agent）、`orchestrate(intent, projectId, conversationId?)` 程序化接口。
- `global-agent-chat`: 全局对话入口——常驻对话面板（**无需绑定项目即可打开、可多开/多标签**）、会话**按项目分开**持久化到 userData（未绑定用独立作用域；消息历史 + 最近 sessionId + **本会话选用的 agent/模型**）、多轮经续接阶梯接上，聊天驱动 `orchestrate` 并把提案交审阅流；**面板可按会话选 agent/模型（覆盖全局默认）**。
- `card-ops-review-apply`: 审阅→apply-ops——把 decompose 的「审阅候选→落库」泛化为「审阅 ops 提案→应用」：ops diff 预览、逐 op 校验（目标存在/无环/typeId 在册/预取名不撞）、破坏性 ops 二次确认、`applyOps` 派发到 cardStore；**新项目提议确认后：选目录建/导入项目（复用 `importProject`）→ 种入 create ops**。

### Modified Capabilities
- `global-agent`: 从「『新建需求』产出者的最小接缝」扩成「需求编排 + 用户入口」——补全盘视野、意图→成套卡操作、破坏性收边红线、可程序化调用；仍恪守只读、只提案、限本项目。
- `requirement-card-store`: 新增关系边增删原语（`addRelation`/`removeRelation`，维护 INVERSE）与复合结构原语（`splitCard`/`mergeCards`，仅作用未跑卡、纯管理态、不碰 git），供 apply-ops 派发。

## Impact

- **主进程**：新增编排服务（`orchestrate` 核 + board-context 装配 + card-ops schema/校验）；`global-agent.ts` 扩接缝；`card-store.ts` 补关系/拆并原语；新增会话持久化存储（`userData/conversations/`）；复用 `agent/runner.ts` + `continuation.ts`（脱 worktree、只读姿态）驱动全局 agent。
- **IPC/preload**：新增 orchestrate / 会话增删读 / applyOps / 提交外部 ops 通道。
- **渲染层**：新增全局对话 dockview 面板（多开）+ ops 提案审阅 UI（泛化自 `NewRequirementFlow`）；遵 `docs/brand` 语义令牌、深浅双主题。
- **共享类型**：新增 `CardOp` 联合、`OrchestrationProposal`、`Conversation`/`ConversationMessage`、`OpIssue` 等。
- **不影响**：现有 decompose「描述想法」入口用户可见行为不变（内部落库路可改走 applyOps）；不碰 git / 代码写入；不触及运行中后台 agent。
