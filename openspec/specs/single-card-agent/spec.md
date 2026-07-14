# single-card-agent Specification

## Purpose
定义每张需求卡常驻的**只读单需求 agent**——用户咨询/干预该卡的入口。对齐 `docs/project-goals.md`「三层 Agent 结构」中单需求 agent「只读、不可多开（每张需求卡一个）、可见范围仅该需求卡资料及其在各涉及成员仓的对应分支、可干预该需求卡的工作」的定位。它以只读姿态驱动、绝不亲自执行；一轮输出三岔之一（reply / 本卡干预提议 / 上抛塑造需求信号，各类技能内联进同一 prompt）；查进度靠限本卡的只读上下文装配；本卡执行干预由 agent 提议、引擎/store 执行；讨论意图上抛全局编排塑造需求；会话按卡持久化、一卡一个不可多开、可清空、咨询轮可中止；以注入式只读产出者驱动并在失败时优雅降级。

## Requirements

### Requirement: 每卡一个只读单需求 agent

系统 SHALL 为每张需求卡提供一个**常驻的单需求 agent** 作为用户咨询/干预该卡的入口，对齐 `docs/project-goals.md`「三层 Agent 结构」中单需求 agent「只读、不可多开（每张需求卡一个）、可见范围仅该需求卡资料及其在各涉及成员仓的对应分支、可干预该需求卡的工作」的定位。该 agent MUST：

- **只读、绝不亲自执行**：以只读姿态驱动（`assembleAgentPrompt({ readOnly: true })`，不给可写范围/产出段），引擎对它 MUST NOT 跑越界检测、MUST NOT 每节点提交；它 MUST NOT 触碰代码/git、MUST NOT 亲自执行任何工作。它唯一的「作用」是**经引擎/store 的干预**与**上抛全局编排**（见下），而非直接改状态或写文件。
- **一卡一个、不可多开**：一张卡至多一个常驻会话（见「单需求 agent 会话按卡持久化」），其可见范围/scope MUST 只限**这张卡**（该卡资料 + 其各涉及成员仓分支）。要全盘视野 MUST 上抛全局（见「讨论意图上抛塑造需求」），MUST NOT 在单卡内自行查看别的卡。
- **经中转**：其干预 MUST 经引擎、其编排 MUST 经 `orchestrate`，MUST NOT 直连别的 agent。

#### Scenario: 单需求 agent 以只读姿态驱动

- **WHEN** 为某张卡拉起其单需求 agent
- **THEN** 其 prompt 不含「可写范围」与「产出」两段、标明只读，引擎不对其运行跑越界检测或每节点提交，它不产生任何代码 commit

#### Scenario: scope 只限本卡

- **WHEN** 用户在某卡的单需求 agent 里问及别的卡
- **THEN** 该 agent 只据本卡资料/分支作答或**上抛全局**，不自行读取或操作别的卡

#### Scenario: 只读不碰代码

- **WHEN** 单需求 agent 处理任意咨询或意图
- **THEN** 它未改动任何项目代码/git，系统不消费其文件写；一切「作用」经引擎干预或上抛编排达成

### Requirement: 单需求 agent 一轮的三岔输出（自由对话·技能内联）

单需求 agent SHALL 是**自由对话助手**（镜像全局 agent 的「单 agent 会话核·技能内联」）：自然语言回复永远第一位（`reply`）；纯咨询/查进度/讨论是**有效轮次**（不产干预、不上抛、不算失败、不显占位）。一次 agent 调用/轮，其输出 SHALL 是一个判别联合，三岔之一：

- **只回复**（`{ reply }`）——查进度/答疑/讨论；
- **回复 + 本卡干预提议**（`{ reply, interventions: [...] }`）——识别到「本卡怎么执行」的意图，按干预技能产结构化 op（见「本卡执行干预由 agent 提议、引擎执行」）；
- **回复 + 上抛信号**（`{ reply, upshift: { intent } }`）——识别到「塑造需求」意图，发上抛信号（见「讨论意图上抛塑造需求」）。

各类技能说明 SHALL **内联进同一 agent 的 prompt**（单一来源）。单需求 agent MUST NOT 自行产出卡操作（它无全盘视野、卡操作需全项目校验）——「塑造需求」它只发 `upshift` 信号，由系统转调 `orchestrate`。

#### Scenario: 纯咨询轮只回复

- **WHEN** 用户问「这卡现在跑到哪了」
- **THEN** agent 给出自然语言进度作答，不产干预、不上抛，不显「本轮没产出」占位

#### Scenario: 识别本卡执行意图产干预提议

- **WHEN** 用户说「先暂停这卡」/「倒回到写测试那步重做」
- **THEN** agent 在回复之外产出对应的本卡干预 op（暂停/倒回…）交确认，而非自行执行

#### Scenario: 识别塑造需求意图发上抛信号

- **WHEN** 用户说「其实还要再加个导出需求」
- **THEN** agent 产出 `upshift` 信号（携该意图），系统据此转调 `orchestrate`，agent 本身不产卡操作

### Requirement: 查进度的只读上下文装配

系统 SHALL 为单需求 agent 装配一份**限本卡的只读上下文**，供其回答进度与讨论，至少含：

- **卡活现状**：标题、描述、类型、生命周期状态、关系边；
- **运行断点**：当前节点、阶段、最远进展节点（`furthestNodeId`）、各声明产出完成状态、门把进度（复用运行断点 `getRunState`）；
- **产物溯源**：`deriveLineage` 派生的「各节点生产了哪些产物」（`renderLineage` 渲染）；
- **各涉及成员仓分支 diff**：该卡在每个涉及成员仓的 `git diff <base>..<branch>` 概要。

装配 SHALL 受**预算约束**：超预算时按确定性顺序截断（尤以分支 diff 为先），并**显式标注被省略的量**（不静默截断）。上下文 MUST **限本卡**（不含别的卡/别的项目）。卡未运行（无 `activeRunId`）时，上下文给出卡活现状并标明「尚未运行、无运行断点/溯源/分支」。

#### Scenario: 上下文含活现状 + 断点 + 溯源 + 分支 diff

- **WHEN** 为一张运行中的卡装配单需求 agent 的读上下文
- **THEN** 上下文含该卡活现状、运行断点（当前节点/阶段/最远进展/门进度）、产物溯源、各涉及成员仓的分支 diff 概要，且不含别的卡

#### Scenario: 超预算时显式截断

- **WHEN** 分支 diff 或内容超出预算
- **THEN** 装配按确定性顺序截断并标注「省略 N…」，不静默丢弃

#### Scenario: 未运行卡的上下文

- **WHEN** 为一张尚未运行的卡装配读上下文
- **THEN** 上下文给出卡活现状并标明尚未运行、无运行断点/溯源/分支，不报错

### Requirement: 本卡执行干预由 agent 提议、引擎/store 执行

单需求 agent 对「本卡怎么执行」的意图 SHALL 收束为一组**本卡干预 op**（`interventions`），每个 op 自描述其动作与载荷。agent 只**提议**——实际执行 MUST 经引擎/store，agent MUST NOT 直接改运行态或写文件。干预动作覆盖：

- **暂停 / 恢复**：无损，经 `engine.pause`/`engine.resume`；**可直接执行**（非破坏性）。
- **倒回到指定节点 K**（可带注入指令）：经 `engine.reenter(runId, K, 指令)`（复用内容驱动回退的**重入不重置**，见 `content-driven-rollback` / `engine-execution`）；**破坏性 MUST 人确认**后才执行。
- **就地向当前执行节点注入新指令**：经 `engine.inject(runId, 指令)`（限本卡范围）；**MUST 人确认**后执行。
- **（可选）改任务资料**：改本卡字段（title/description/typeId），经既有 `cardsUpdate`。

破坏性干预（倒回/注入/结构性改动）MUST 在执行前请用户确认；非破坏性（暂停/恢复）MAY 直接执行。干预目标节点 K 由 agent 以**节点 id** 引用（读上下文已含节点断点），系统据此映射到引擎方法；引用不存在的节点 MUST 被拒绝并给可读原因。

#### Scenario: 暂停恢复可直接执行

- **WHEN** 用户经单需求 agent 提议暂停本卡并应用
- **THEN** 经 `engine.pause` 暂停，无须破坏性二次确认

#### Scenario: 倒回节点须确认后经引擎重入

- **WHEN** agent 提议「倒回到节点 K 并注入新指令」，用户确认
- **THEN** 系统经 `engine.reenter(runId, K, 指令)` 重入 K 前向修复（不 git reset、不撤下游），未确认前不执行

#### Scenario: 就地注入须确认

- **WHEN** agent 提议向当前执行节点注入一条新指令，用户确认
- **THEN** 系统经 `engine.inject(runId, 指令)` 把指令注入当前节点执行者会话并重跑；未确认前不执行

#### Scenario: 引用不存在的节点被拒

- **WHEN** 干预 op 的目标节点 id 不在本卡工作流节点里
- **THEN** 系统拒绝该干预并给可读原因，不执行

### Requirement: 讨论意图上抛塑造需求

单需求 agent 识别到**塑造需求**（新增/扩范围/牵动别卡/新建）的意图时 SHALL **上抛全局**——系统据 `upshift` 信号转调编排核 `orchestrate(intent, projectId)`（见 `requirement-orchestration`），得到 `OrchestrationProposal`（ops 提案）。该提案 SHALL 在**本卡对话内**呈现（作为 agent 消息携带的提案），并复用 `card-ops-review-apply` 的审阅→`applyOps` 流确认应用。单卡 agent MUST **不裁决**该意图落在哪张卡（它无全盘视野），交由全局裁决；**歧义时倾向上抛**（让全局裁决「其实属本卡/该新建」）。上抛轮 = 单卡分类 + 全局编排两次 agent 调用。

#### Scenario: 塑造需求上抛出 ops 提案

- **WHEN** 用户在某卡对话说「还要加个需求 X」，agent 判为塑造需求
- **THEN** 系统转调 `orchestrate` 出 ops 提案，提案呈现在本卡对话内，经 `applyOps` 审阅确认后看板出现新卡

#### Scenario: 单卡不自行裁决落卡

- **WHEN** 意图可能属本卡、也可能该新建
- **THEN** 单卡 agent 不自行决定，上抛全局由 `orchestrate` 裁决产出对应 ops

#### Scenario: 歧义倾向上抛

- **WHEN** 卡对话里的意图在「本卡执行」与「塑造需求」间含糊
- **THEN** 单需求 agent 倾向上抛全局，而非强行当本卡干预处理

### Requirement: 单需求 agent 会话按卡持久化且不可多开

系统 SHALL 把每张卡的单需求 agent 会话**持久化到用户数据目录**（`userData`，不入 git，随云同步走），复用既有会话持久化机件（消息历史 + 最近 agent 会话 id + 可选本会话选用 agent/模型）。该会话 MUST **一卡一个、不可多开**——以**卡标识作会话 id**（稳定、唯一），每次打开该卡都续上**同一条**会话，不提供「新建会话」。会话与**全局对话会话物理隔离**（各自的存储桶/作用域），MUST NOT 相互串扰或污染对方列表。多轮 SHALL 走**原生续接**优先的既有阶梯（`--resume`，失败回落历史重建）。

#### Scenario: 同一张卡续上同一会话

- **WHEN** 用户关闭又重开某卡的单需求 agent
- **THEN** 续上该卡原有会话历史，而非开新会话，且不提供「新建会话」

#### Scenario: 会话不可多开

- **WHEN** 同一张卡被多次打开对话
- **THEN** 始终是同一条会话（同一稳定会话 id），不产生并存的多条

#### Scenario: 与全局对话物理隔离

- **WHEN** 用户既有全局对话、又有若干卡的单需求 agent 会话
- **THEN** 卡会话不出现在全局对话列表，全局会话也不出现在任何卡的咨询区，互不串扰

### Requirement: 单需求 agent 会话可清空

系统 SHALL 允许用户**清空某卡的单需求 agent 会话**：清除其**消息历史**并**断开原生续接**（清除最近 sessionId，使下一轮不再 `--resume` 旧会话），但**保留会话本身**（id 仍为 cardId、不删会话）与该会话已选的 agent/模型。清空后该卡咨询区回到**空态**、可重新开聊；清空 MUST 在渲染层经**二次确认**后才执行（不依赖原生弹窗）。清空只作用于**该卡**会话，MUST NOT 影响别的卡或全局对话。

#### Scenario: 清空该卡会话的消息与续接

- **WHEN** 用户在某卡咨询区确认「清空对话」
- **THEN** 该卡会话消息清空、最近 sessionId 清除（下一轮全新起），会话本身与所选 agent/模型保留，咨询区回到空态

#### Scenario: 清空只作用于本卡

- **WHEN** 清空卡 A 的会话
- **THEN** 卡 B 的会话与全局对话不受影响

### Requirement: 咨询轮可被中止

系统 SHALL 使**进行中的咨询轮可被中止**：暴露一个按卡的中止入口，中止时**杀掉该卡当前正在跑的咨询 agent 进程**（复用运行器的 kill），使该轮尽快结束、运行回到可输入态。中止 MUST 只作用于**该卡**当前这一轮（不影响别的卡、不影响已完成的历史轮）；无进行中的轮时中止为 no-op、不报错。中止后该轮 MAY 不追加内容或只保留已产出的部分。

#### Scenario: 中止杀掉当前咨询 agent

- **WHEN** 某卡咨询轮进行中，触发中止
- **THEN** 该卡当前咨询 agent 进程被杀、该轮结束，运行回到可输入态

#### Scenario: 无进行中轮时中止为 no-op

- **WHEN** 某卡当前没有进行中的咨询轮，触发中止
- **THEN** 为 no-op、不报错

### Requirement: 注入式只读产出者与优雅降级

系统 SHALL 以**注入式只读产出者**驱动单需求 agent——**真实实现**复用脱 worktree、只读姿态的流式续接 runner（`agent/runner.ts`+`continuation.ts`），把 agent 回复解析为三岔输出（reply/interventions/upshift）。产出者 MUST 可被替换为**假实现**（测试注入固定的三岔输出，不依赖真 CLI）。未配置 agent、调用失败/超时、或回复不可解析时 MUST **优雅降级**为「只回复（附可读提示）、无干预、无上抛」，不报错、不崩溃。

#### Scenario: 真实只读续接驱动出三岔输出

- **WHEN** 已配置默认 agent，用户在卡对话发一条意图
- **THEN** 系统以只读续接驱动 agent，解析其回复为 reply/interventions/upshift 之一

#### Scenario: 假产出者供测试

- **WHEN** 测试注入返回固定三岔输出的假单卡 agent
- **THEN** 咨询核据其产出走通「意图→查进度/干预提议/上抛」全链路，不触真 CLI

#### Scenario: 调用失败优雅降级

- **WHEN** 未配置 agent 或调用失败/超时/不可解析
- **THEN** 咨询核返回仅含可读提示的回复，无干预、无上抛，不报错、不崩溃
