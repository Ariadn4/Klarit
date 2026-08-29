# agent-execution Specification

## Purpose

agent 执行器与 agent↔引擎合约：无头 adapter 层把 agent 节点声明式翻译成一次无头 CLI 启动（首发 claude/codex/cursor，只接外壳不接模型），在需求卡的成员仓 worktree 里跑；握手文件为结构化交互的唯一真相源；续接「就高不就低」阶梯（`--resume <sessionId>` + 喂回历史兜底）；agent 节点自愈回喂与 `sourceKind='agent'` 决策；可写范围越界后置检测 + 每节点提交；同一节点多仓由一个 agent 跨仓承担。
## Requirements
### Requirement: 无头 adapter 拉起 agent CLI 在 worktree 干活

系统 SHALL 提供一个 **adapter 层**，把 agent 节点的执行配置 `{toolId, model, effort, extraArgs}` 声明式翻译成一次**无头（非交互）**的 agent CLI 启动。一个 agent 节点由**一个 agent** 承担其**全部目标成员仓**的工作——引擎 MUST 把该节点各目标成员仓的 worktree 目录一并交给这个 agent（如 claude `--add-dir` 追加工作目录），使它能在这些仓间做紧耦合改动、必要时自行起子 agent 并行；引擎不为「同一节点的多仓」拆成多个 agent。首发 MUST 支持三个 agent 外壳：`claude`、`codex`、`cursor`；adapter 接口 MUST 可扩展以容纳后续外壳。adapter MUST NOT 接入模型/后端（如经 base-url 改写的第三方模型）——本能力只接 agent 外壳、不接模型。

adapter 翻译 MUST 满足：

- **无头运行、无需 TTY**：经管道 stdio 启动（复用可取消 spawn 运行器的杀进程树 / 流式 / 可取消能力），不依赖伪终端。
- **免交互写文件**：注入各家「自动批准工具/编辑」的开关，使 agent 能在无人值守下写文件（如 `claude --dangerously-skip-permissions`、`codex --sandbox workspace-write --ask-for-approval never`、`cursor -p --force --trust`）。
- **选模型经 flag**（非环境变量）；模型值为**任意非空字符串**（含 `opus` 等「自动最新」别名），adapter MUST 原样透传、不校验其属于某清单；`extraArgs` 透传。
- **effort 按家翻译**：effort 取统一枚举 `low | medium | high | xhigh | max | ultracode`。claude MUST 把前五档翻成 `--effort <level>`（全档直传）；**`ultracode` 档不是 `--effort` 取值，claude MUST 改为把 `ultracode` 关键词注入喂给 agent 的文本开头**（start 的 prompt 与 resume 的注入文本均注入），且 MUST NOT 传 `--effort`。codex MUST 翻成 `-c model_reasoning_effort=<level>`，其档位止于 high，`xhigh`/`max`/`ultracode` MUST 收敛为 `high`（就近取该家最高档，不报错）；cursor 及其它不支持 effort 的外壳 MUST 忽略该字段（不注入参数、不报错、不降级）。effort 未设置时 MUST NOT 注入任何 effort 参数（用各家自身默认）。
- **流式输出**：agent 的 stdout/stderr MUST 边收边流式回显，详情面板展示该 agent 的实时输出。一个 agent 节点一条输出流（一个 agent 跨目标仓工作），无需按成员仓分流。

启动失败（外壳未装 / 拉起即崩 / 声明的模型不可用）MUST 归「技术失败」，按失败归宿处理（有限次重试 → 超限抛决策），MUST NOT 静默降级。

#### Scenario: 无头拉起并在目标仓 worktree 写文件
- **WHEN** 引擎执行一个 agent 节点，`target=all`、卡 `repos`=[web, api]、`toolId=claude`
- **THEN** adapter 无头启动**一个** `claude`（带免交互写文件与选模型 flag），把 web、api 两个 worktree 都交给它（如 `--add-dir`），agent 在两仓间改动文件、stdout 流式回显

#### Scenario: effort 按家翻译成对应 flag
- **WHEN** 一次 agent 启动解析出 `effort=high`，外壳分别为 claude 与 codex
- **THEN** claude 的 argv 含 `--effort high`，codex 的 argv 含 `-c model_reasoning_effort=high`

#### Scenario: codex 对超出档位的 effort 收敛为最高档
- **WHEN** 一次 codex 启动解析出 `effort=max`（或 `xhigh`）
- **THEN** codex 的 argv 含 `-c model_reasoning_effort=high`（收敛为该家最高档），claude 同配置则为 `--effort max` 直传

#### Scenario: ultracode 档经提示词关键词注入而非 flag
- **WHEN** 一次 claude 启动解析出 `effort=ultracode`
- **THEN** argv 不含 `--effort`，喂给 agent 的文本以 `ultracode` 关键词开头（start 与 resume 皆然）；codex 同配置收敛为 `-c model_reasoning_effort=high`，cursor 忽略

#### Scenario: 不支持 effort 的外壳静默忽略
- **WHEN** 一次 cursor 启动解析出 `effort=high`
- **THEN** cursor 的 argv 不含任何 effort 参数，启动照常进行、不报错

#### Scenario: effort 未设置不注入参数
- **WHEN** 全局默认 effort 未设置且节点未声明 effort
- **THEN** 任何外壳的 argv 均不含 effort 参数

#### Scenario: 清单外模型 id 原样透传
- **WHEN** 一次 claude 启动的模型值为建议清单外的字符串（如 `opus` 别名或新模型 id）
- **THEN** adapter 把该值原样翻成 `--model <值>`，不做清单校验

#### Scenario: 声明的外壳不可用归技术失败
- **WHEN** agent 节点声明 `toolId` 对应的 CLI 未安装或拉起即崩
- **THEN** 引擎按技术失败处理（有限次重试后抛人工决策），不静默改用别的外壳

#### Scenario: adapter 不接模型/后端
- **WHEN** 用户希望用某第三方模型（无独立 agent CLI）
- **THEN** 本能力不提供该路径（只接三家 agent 外壳），不通过 base-url 改写把模型伪装成外壳

### Requirement: agent↔引擎握手文件为结构化交互的唯一真相源

agent 与引擎之间的**结构化交互** MUST 走**握手文件**：引擎为每个节点运行指定一个**在 worktree 之外的绝对路径**（`userData/engine-runs/handshakes/<runId>/<nodeId>.json`），经协议层注入告诉 agent 写那里；引擎 SHALL 在 agent 进程退出时读取它。**握手 MUST NOT 落 worktree**——否则会污染代码仓、被越界检测/每节点提交误纳入。引擎 MUST 让 agent 可写该路径（如把握手目录一并作为 agent 的额外工作目录）。握手结构 MUST 含：`status`(`need-decision` | `done` | `failed`)、可选 `decision`(供 `need-decision`：`options[]`、`multi`、是否允许自由输入 `freeInput`)、可选 `repos`(涉及成员仓判定)、可选 `note`(给人看的小结)。

stdout/流式输出 MUST 仅用于**展示**（`op-chunk` 回显），引擎 MUST NOT 从 stdout 解析控制状态——避免 ANSI/工具输出污染导致误判。

**握手缺失即乐观 `done`**：agent 退出但未写握手文件时，引擎 MUST 当作 `status=done` 继续（进越界检测 → 门把），以容忍第三方 CLI 不完美遵守协议；真正的未完成由客观门与越界检测兜底触发自愈。

#### Scenario: 退出时读握手判定去向
- **WHEN** agent 进程退出且引擎指定的绝对路径处存在握手文件
- **THEN** 引擎按其 `status` 决定去向：`done` 进越界检测/门把、`need-decision` 抛决策、`failed` 触发自愈回喂

#### Scenario: 握手缺失按乐观 done 继续
- **WHEN** agent 进程退出但未写握手文件
- **THEN** 引擎按 `done` 继续；若产出缺失或客观门未过，由既有归宿触发自愈重做（而非静默通过）

#### Scenario: stdout 不作控制状态解析
- **WHEN** agent 在 stdout 打印形似哨兵的文本，但未写握手文件
- **THEN** 引擎只把该文本流式展示，不据其推进/抛决策（控制状态只认握手文件）

### Requirement: 续接采「就高不就低」的阶梯

当引擎需要重新推进同一 agent 节点（自愈回喂、回答决策、崩溃/关软件后恢复）时，续接 SHALL 按可用性择优走阶梯，底下永远垫 worktree 内已落盘的文件：

1. **原生 `--resume <sessionId>`（首选）**：引擎 MUST 从 agent 的流式输出抓取其**会话 id**（如 claude stream-json 的 `init` 事件 `session_id`），存进断点 `agentRuns[nodeId].session`。续接时用**具体 session id** 精确续接（`claude --resume <id>` / `codex exec resume <id>` / `cursor --resume <id>`），MUST NOT 用「续最近一条」（`--continue`/`--last`）——否则「暂停A、暂停B、恢复A」会接错会话。此层接上 agent 自己盘上的完整会话（带记忆），最高保真、覆盖崩溃半路。
2. **喂回历史记录重建（兜底）**：无 session id、或原生续接拉起失败时，引擎 MUST 用已增量自存的会话记录重拼 prompt——「完整任务 + 你之前的执行记录如下：<记录> + 续接说明」——全新 `start`。此层 adapter 无关，抗未来没 resume / resume 失败的 agent。

   本层喂回的历史 MUST 由**原始流记录**派生，MUST NOT 直接取用界面展示转写。喂入 agent 的仍是可读文本（原始 NDJSON 不直接入 prompt），但该文本的**转写规则由重建这一用途自行决定**，MUST 保留工具动作的完整目标与工具结果要点——它们正是 agent 判断「我已经做过什么、看到过什么」的依据。

   受 prompt 长度所限需要截断时，截断 MUST 按事件边界进行并优先保留工具动作与其结果，MUST NOT 简单按字符数截尾。
3. **worktree 文件永远垫底**：无论走哪层，agent 起来都能读到已落盘的真实改动，据现状继续。

引擎的自存会话记录 MUST **边跑边增量落盘**，MUST NOT 等 agent 干完才存——否则崩溃/关软件卡在半路时自存为空、无从重建。续接选择逻辑 MUST 收敛为**一处判定**，统一覆盖自愈回喂、回答决策、崩溃恢复三个场景。

#### Scenario: 按 session id 精确续接，不接错会话
- **WHEN** 同时有多张卡的 agent 被暂停（会话 A、B…），用户恢复其中某一张
- **THEN** 引擎用**该节点断点里存的 session id** `--resume` 精确续接那条会话，而非「最近一条」

#### Scenario: 崩溃半路优先原生 --resume 接真实会话
- **WHEN** agent 跑到一半时应用崩溃/关机，随后应用重启、引擎恢复该 agent 节点
- **THEN** 引擎用断点里存的 session id `--resume` 接上 agent 盘上会话（带记忆）继续，而非从头重来

#### Scenario: 无 session/resume 失败则喂回历史记录重建
- **WHEN** 需续接但没抓到 session id、或原生 `--resume` 拉起失败
- **THEN** 引擎用自存的会话记录重拼「完整任务 + 喂回历史 + 续接说明」全新拉起，续上工作

#### Scenario: 喂回的历史来自原始记录而非展示转写
- **WHEN** 走兜底层重建，而该次运行的展示转写已折叠掉工具结果、截断了工具目标
- **THEN** 喂回 agent 的历史文本由**原始流记录**派生，含完整的工具动作目标与工具结果要点，MUST NOT 沿用展示转写的折叠与截断

#### Scenario: 超长历史按事件边界截断
- **WHEN** 原始流记录长度超出可喂入 prompt 的预算
- **THEN** 按事件边界截断并优先保留工具动作与其结果，MUST NOT 按字符数直接截尾

#### Scenario: 自存边跑边落盘故崩溃半路仍可重建
- **WHEN** agent 运行期间引擎持续增量落盘其会话记录，运行在半路被关闭
- **THEN** 恢复时自存记录含到关闭前为止的内容（非空），可据其重建上下文

### Requirement: agent 节点自愈回喂与超限升级决策

agent 节点的技术性失败——**客观门未过、必选产出缺失/格式不符、可写范围越界、agent 运行时经握手提问**——MUST 走 **agent 节点自愈**：引擎**续接原 agent**（按上条阶梯），把失败详情（哪道门/哪个产出/哪些文件越界/用户对提问的决定）注入其续接 prompt，令其重做。自愈 MUST **限次**（复用引擎既有按「运行×节点」的重试计数与持久化）。

超限后 MUST 抛人工决策，且该决策 `sourceKind` MUST 为 `agent`（区别于引擎自身失败的 `engine` 来源）；决策 MUST 携带背景说明与前进式选项，选项**取自握手中 agent 自填的选项**，并 MUST 附**自由输入**（`agent` 来源的决策允许开放答案，转交原 agent 解读）。用户提交后，引擎 MUST 把选中项/自由文本经续接注入回原 agent 续跑。

由于一个 agent 节点只有**一个** agent（跨其全部目标仓工作），自愈时引擎续接**这一个** agent 即可——它掌握本节点全部涉及仓的全局，跨仓失败由它自行定位修复，**不存在「门失败该退给哪个成员 agent」的归因问题**。

#### Scenario: 客观门失败续接回喂原 agent 重做
- **WHEN** 某 agent 节点的客观门未过且重试未达上限
- **THEN** 引擎续接原 agent、注入「哪道门为何没过」的详情令其重做，不新拉一个临时 agent

#### Scenario: 自愈超限升级为 agent 来源决策
- **WHEN** agent 节点自愈达到重试上限仍未过
- **THEN** 引擎抛 `sourceKind='agent'` 的人工决策（含背景、agent 自填选项、自由输入），落该卡详情面板

#### Scenario: 决策答复经续接注入原 agent
- **WHEN** 用户对 agent 来源决策选定某项或填入自由文本并提交
- **THEN** 引擎把该答复经续接注入原 agent 续跑，而非丢弃或另起会话

#### Scenario: 多仓节点门失败续接同一个 agent 修复
- **WHEN** 一个 agent 节点跨 web、api 工作完成后节点级客观门失败
- **THEN** 引擎续接**这一个** agent、注入门失败详情，由它跨 web/api 定位修复，无「退给哪个成员」的归因问题

### Requirement: 可写范围越界后置检测与还原

agent 节点完成执行时，引擎 SHALL 对**每个成员仓** git 改动集与该节点**实际可写范围**（`writableScope ∪ 所有产出路径`；`writableScope` 为空即整条工作分支可写）比对，作为一道引擎自动加的基线门把（无需配置）。越界文件（改动落在实际可写范围外）MUST 被**确定性还原到该节点起始基线**（还原到节点起始 commit），MUST NOT 依赖 agent 自觉；实际可写范围内的合法改动 MUST 保留（若其依赖被撤文件而残缺，交由后续测试/客观门自然挡下重做）。

越界 MUST 带「哪些文件越界」详情喂回原节点自愈重做，**限次**；超限 MUST 抛决策，且选项 MUST 含**「放宽可写范围」**（越界常因范围声明过窄，缺此选项会陷死循环）。

为支持还原与基线，引擎 MUST 在节点起始时记录**每成员的起始 commit SHA**于断点，并在恢复时沿用（不重算）。

#### Scenario: 越界文件还原、范围内保留
- **WHEN** agent 节点声明可写范围为 `docs/`，完成时却改了 `src/x.ts`（越界）与 `docs/y.md`（范围内）
- **THEN** 引擎把 `src/x.ts` 还原到节点起始基线、保留 `docs/y.md`，并带越界详情喂回重做

#### Scenario: 越界超限抛决策含「放宽可写范围」
- **WHEN** 越界自愈达到重试上限
- **THEN** 引擎抛人工决策，选项集合中含「放宽可写范围」

#### Scenario: 起始 SHA 记于断点且恢复沿用
- **WHEN** agent 节点开始执行时引擎记下每成员起始 commit SHA，随后运行被关闭并恢复
- **THEN** 恢复沿用已记的起始 SHA 作还原基线，不因重启重算而漂移

### Requirement: agent 节点完成后按节点提交范围内改动

引擎 SHALL 在 agent 节点**越界还原之后**，把该节点在每成员仓的**实际可写范围内**改动提交为一次 commit，并把 commit SHA 记于断点（作为该节点代码隐式产出的溯源锚点，亦作下一节点越界检测的起始基线）。无范围内改动的成员仓 MUST 跳过提交（不产生空提交）。

#### Scenario: 完成即提交并记 SHA
- **WHEN** 一个 agent 节点完成、越界已还原、某成员仓存在范围内改动
- **THEN** 引擎在该成员仓提交这些改动，把 commit SHA 记入断点，供溯源与下一节点基线

#### Scenario: 无改动成员不产生空提交
- **WHEN** 某成员仓在本 agent 节点无范围内改动
- **THEN** 引擎跳过该成员的提交，不产生空 commit

### Requirement: agent 节点由一个 agent 跨目标仓工作

引擎执行一个 agent 节点时 SHALL 先把节点 `target` 解析为成员仓子集（复用 `repo-targeting` 的解析），再用**一个 agent** 承担该子集**全部目标仓**的工作——把各目标仓的 worktree 一并交给它（多目录），它在这些仓间做紧耦合改动、必要时自行起子 agent 并行。该 agent MUST 持有**单一**会话续接 token 与自愈计数；越界检测与每节点提交仍 MUST **按每个目标仓各自成立**（在各仓工作树内分别检测/还原/提交/记 SHA）。

**「同一节点多仓用一个 agent」的边界**：project-goals「Agent 之间不直连、走引擎中转 + 共享产物」约束的是**不同节点/不同需求**的 agent；**同一节点面对多仓时目的一致、内容紧耦合**，MUST 由一个 agent 统一承担，MUST NOT 拆成多个 agent 再为其造跨仓协商机制。跨**节点**协调仍靠共享的需求卡活现状（上游节点把方案与 `{repos}` 写入活现状、经公共输入注入下游 agent）。

agent 节点在该 agent 完成后推进门把；其间提问/失败按统一决策与自愈处理——一个 agent、一个待决策，天然契合断点单决策模型（无需按成员仓扇出多决策）。

#### Scenario: 多仓节点由一个 agent 跨仓工作
- **WHEN** 一个 agent 节点 `target=all`，卡 `repos` = [web, api]
- **THEN** 引擎拉起**一个** agent 并把 web、api 两个 worktree 都交给它，它在两仓间做紧耦合改动（可自行起子 agent 并行），完成后进门把

#### Scenario: 越界检测与提交按目标仓各自成立
- **WHEN** 一个 agent 跨 web、api 工作完成
- **THEN** 引擎在 web、api 各自工作树内分别做越界检测/还原、提交范围内改动并各记 SHA（改动由这一个 agent 造成，检测仍逐仓独立）

#### Scenario: 跨节点协调仍靠卡活现状
- **WHEN** 上游规划节点把方案写入需求卡活现状
- **THEN** 下游 agent 节点从注入的活现状读到方案，跨节点不靠 agent 直连（此约束针对不同节点，不影响同节点多仓由一个 agent 承担）

### Requirement: 人工评审门附可打开的产出物

当一个节点有**人工评审门**且该节点声明了产出时，引擎 SHALL 把该节点在主目标仓 worktree 里**已产出且存在**的产出文件（名称 + 绝对路径）随人工门决策一并给出；渲染层 SHALL 把它们列成可点链接，点击用文件查看器打开，供用户审阅产出（如规划节点的 `PLAN.md`）后再决定通过。产出文件不存在的不列。

#### Scenario: 规划节点人工评审可打开 PLAN.md
- **WHEN** 规划节点声明产出 `PLAN.md` 且已产出，随后停在人工评审门
- **THEN** 该门决策附「PLAN.md + 其绝对路径」，用户点击即用文件查看器打开审阅，满意后点通过

### Requirement: agent 结构化输出填充涉及仓供下游收窄

agent 节点 `done` 时，引擎 SHALL 从握手的 `repos` 字段填充该节点的结构化输出 `upstreamOutputs[nodeId].repos`（在卡 `repos` 内取交、持久化于断点），供下游 `target=fromUpstream` 节点运行时收窄。握手未给 `repos` 时该字段留空（下游 `fromUpstream` 按 `repo-targeting` 的缺失处理）。

#### Scenario: done 时从握手填充涉及仓
- **WHEN** 一个声明了结构化输出的 agent 节点 `done`，握手 `repos=[api]`
- **THEN** 引擎把 `upstreamOutputs[该节点].repos=[api]`（与卡 repos 取交）持久化，下游 `fromUpstream` 据此只作用于 api

### Requirement: 临时 heal agent 复用执行器

引擎为引擎/命令节点技术失败自愈拉起的**临时 heal agent** SHALL 复用本能力的 agent 执行器——无头 adapter 拉起、握手文件为真相源、续接「就高不就低」阶梯、可写范围越界后置检测、每节点提交——与 agent 节点同源,差异仅在:它是**临时**的(一次自愈生命周期,超限即弃,不绑工作流节点声明)、**读写**且 scope 到出错的**卡工作区**、其 `# 任务` 段是**引擎合成的 heal prompt**(合并冲突版 / 命令失败版)而非节点驱动指令。heal agent MUST **只**解冲突/改代码、**不自己提交**(提交由引擎确定性执行,见 `node-failure-heal`)。heal agent 的续接注入 MUST 复用统一续接判定(注入上次失败详情 / 用户对其提问的决策答复)。

heal prompt 的公共输入 MUST 复用 agent 节点的拼装(生效宪法 + 需求卡活现状 + 引擎交互协议),仅替换 `# 任务` 段:合并冲突版告知「主线已并入你当前分支、以下文件冲突、保留两侧意图解冲突、只改冲突文件、不要自己提交」;命令失败版告知「命令 X 失败、输出如下、改代码让它通过、不要自己提交、若非代码问题则经握手请求决策」。

#### Scenario: heal agent 经执行器读写拉起于卡工作区
- **WHEN** 引擎为某成员仓的合并冲突拉起临时 heal agent
- **THEN** adapter 无头启动一个读写 agent,cwd 为该成员卡工作区,喂合并冲突版 heal prompt,只解冲突不自己提交

#### Scenario: heal agent 提问复用 agent 决策通道
- **WHEN** heal agent 经握手写 `need-decision`
- **THEN** 引擎抛 `sourceKind='agent'` 决策(落该卡、选项取自 agent 自填、附自由输入),答复经续接注入回该 heal agent,不新造通道

#### Scenario: heal prompt 公共输入与节点 agent 同源
- **WHEN** 拼装 heal prompt
- **THEN** 其公共输入(宪法/需求卡/引擎交互协议)复用 agent 节点同一拼装,仅 `# 任务` 段为引擎合成的 heal 任务

### Requirement: 决策自由输入新起的读写处置 agent

当一个**无当前 agent** 的决策(引擎/命令失败、客观校验门失败;**不含人工评审门**)收到用户提交的**自由文本**时,引擎 SHALL **新起一个临时读写处置 agent**,复用同一执行器形态(读写、cwd = 卡工作区、握手/续接/越界/每节点提交),与自动 heal agent 同机器,差异仅在**由用户自由输入触发**、其 `# 任务` 段含「失败背景 + 用户自由输入 + 帮用户处理」的指令。处置 agent MUST:能改代码解决就改(**不自己提交**,引擎提交后重跑该失败操作验证);**无法用代码解决**(如 push 无远端、worktree 被占等)时,经握手 `need-decision` **解释原因并把处置建议作为新选项交回用户**,MUST NOT 硬撑乱改。处置 agent 同样只读/读写权限、留痕、prompt 可见规则与 heal agent 一致。

#### Scenario: 无当前 agent 决策的自由输入新起处置 agent
- **WHEN** 一个命令失败超限决策(无当前 agent)被用户写入自由文本并提交
- **THEN** 引擎新起一个读写处置 agent(cwd = 卡工作区),喂失败背景 + 用户自由输入,令其改代码;引擎提交后重跑命令验证

#### Scenario: 非代码可解的失败经握手解释交回选项
- **WHEN** 一个 push 无远端决策被写入自由输入,处置 agent 判断这不是代码能解决的
- **THEN** 处置 agent 经握手 `need-decision` 解释原因、把处置建议作为新选项交回用户,不擅改代码

#### Scenario: 人工评审门不触发处置 agent
- **WHEN** 一道人工评审门决策(本能力内不带自由输入框)
- **THEN** 不存在新起处置 agent 的路径(其驳回回退判定留后续)

### Requirement: 所有 agent 运行全量留痕且 prompt 随输出可见

引擎 SHALL 为**每一次** agent 运行——节点 agent、自愈续接、临时 heal agent——各记一份**可排查的运行记录**，持久化、关软件重开仍可查，至少含：**喂入的完整 prompt**、增量自存的会话记录（边跑边落盘）、握手文件内容与最终 `status`、最终归宿（done/need-decision/failed/超限回落）、所属运行/节点/成员仓、每仓起始与提交 SHA、（自愈/heal 的）第几次尝试。渲染层 SHALL 在每个 agent 的输出框**同时展示喂给它的完整 prompt**（含临时 heal agent），使 prompt 可被核对、agent 不再是黑盒。

自存的会话记录 SHALL 保存为**两份并存、职责不同**的记录，二者 MUST NOT 互相取代或合并为一份：

1. **原始流记录（保真）**：agent 子进程输出的**逐行原样**记录（结构化流式输出的外壳即其原始 NDJSON），**不裁剪、不丢弃事件类型、不截断字段**。这份是**机器**用的——续接重建与后续的结构化消费以它为源。
2. **展示转写（可压缩）**：供人阅读与界面回看的转写文本，允许折叠噪音事件、截断超长字段。

二者 MUST 均**边跑边增量落盘**，MUST NOT 等 agent 结束才写。保留与清理口径 MUST 一致（同生共死）。

之所以不合成一份：展示要求压缩（工具结果全量刷屏无法阅读），重建要求保真（工具结果恰是 agent 需要知道的「我读到了什么」），两者的正确取舍相反，合并必然牺牲其一。

#### Scenario: 每次 agent 运行留一份含 prompt 的记录
- **WHEN** 任一 agent（节点/续接/heal）运行
- **THEN** 引擎持久化一份运行记录，含完整 prompt、会话记录、握手、归宿、所属运行/节点/成员仓与 SHA，关软件重开仍可查

#### Scenario: 输出框展示完整 prompt
- **WHEN** 用户查看某 agent（含临时 heal agent）的输出框
- **THEN** 界面同时展示喂给该 agent 的完整 prompt，供核对 prompt 是否靠谱

#### Scenario: 原始流记录不丢事件类型
- **WHEN** 某 agent 的流式输出含被展示转写折叠掉的事件（如工具结果、系统事件）
- **THEN** 这些事件 MUST 完整出现在原始流记录中（展示转写中折叠与否不影响原始记录）

#### Scenario: 两份记录并存
- **WHEN** 一次 agent 运行结束
- **THEN** 该次运行既有可供人阅读回看的展示转写，也有逐行原样的原始流记录，二者均可读取

#### Scenario: 自存边跑边落盘
- **WHEN** 一个 agent 运行期间引擎持续增量落盘其会话记录，运行在半路被关闭
- **THEN** 两份记录均含到关闭前为止的内容（非空），可据其排查与（需要时）重建上下文

### Requirement: agent CLI 以解析出的绝对路径启动

一切 agent CLI 子进程——节点 agent、续接、临时 heal agent、分解 / 全局对话等无头调用——MUST 以 `agent-detection` 解析出的**可执行绝对路径**启动。系统 MUST NOT 把**裸命令名**交给操作系统或 shell 去解析。

理由是子进程的工作目录是需求卡的 worktree（内容由外部 agent 写入、可能源自导入的第三方项目），而 Windows 的命令解析**先搜当前工作目录**——交裸名等于让被管理的仓库决定起哪个可执行文件。

解析不到可信绝对路径时，该 agent 的启动 MUST 归「技术失败」（按既有失败归宿处理），MUST NOT 回落到裸命令名、MUST NOT 静默改用别的外壳。

argv MUST NOT 经由 shell 字符串拼接传递：

- 可执行形态支持直接创建进程时（如 Windows 的 `.exe`），MUST 直接以参数**数组**启动、不经 shell。
- 必须经 shell 才能启动的形态（如 Windows 的 `.cmd` / `.bat`），系统 MUST 自行对可执行路径与**每一个**参数加引号转义，MUST NOT 依赖运行时把参数以空格直接拼接的默认行为。

上述约束 MUST 收敛为**一处共用的启动实现**，供全部 agent 子进程调用点使用；MUST NOT 在不同调用点各写一份。

#### Scenario: 以绝对路径启动而非裸命令名
- **WHEN** 引擎执行一个 agent 节点，其 worktree 内存在与该 agent CLI 同名的可执行文件
- **THEN** 启动的是 `agent-detection` 解析出的绝对路径所指的 CLI，worktree 内的同名文件 MUST NOT 被执行

#### Scenario: 解析不到路径归技术失败
- **WHEN** 某 agent 节点声明的外壳无法解析出可信绝对路径
- **THEN** 该次启动归技术失败（有限次重试后抛人工决策），MUST NOT 以裸命令名重试

#### Scenario: 含 shell 元字符的参数不被拆成第二条命令
- **WHEN** 某次启动的参数中含 shell 元字符（如 `&`、`|`、`"`）
- **THEN** 该参数以字面值抵达 CLI，MUST NOT 被解释为命令分隔或产生第二条命令

#### Scenario: 全部调用点共用同一套启动约束
- **WHEN** 系统从任一路径拉起 agent CLI（节点执行、续接、heal、分解、全局对话）
- **THEN** 均经同一处启动实现，绝对路径与转义约束一致生效

### Requirement: 透传参数与子进程环境的边界

**透传参数**（`extraArgs`）的来源已从人工编写扩展为 agent 自动 author 的工作流定义，因此 MUST 被当作**不受信输入**处理：切分出的每一项 MUST NOT 含 shell 元字符，含则该次启动归「技术失败」并给出可辨认原因，MUST NOT 静默丢弃该参数后照常启动（静默丢弃会让工作流的实际行为与其定义不一致）。

系统 MUST NOT 对 `extraArgs` 施加 flag 白名单——既有「`extraArgs` 透传、模型值不做清单校验」的契约保持不变。本约束只封「一个参数变成第二条命令」这一条路。

**子进程环境**：agent 子进程的环境 MUST 被显式规整为「无着色、不声称终端能力」——MUST 关闭 ANSI 着色（如 `NO_COLOR` / `FORCE_COLOR=0`），MUST 剔除会让 CLI 误判自己运行在富终端里的变量（如 `WT_SESSION`、`COLORTERM`）。

理由：这类变量的取值取决于**用户如何启动本应用**（桌面图标 / 终端内命令），会造成同一版本下 agent 输出的转义序列有无不同，且在开发者机器上不可复现；而输出最终落进纯文本展示与原始记录，混入转义序列会同时污染二者。

#### Scenario: 含元字符的透传参数归技术失败
- **WHEN** 某工作流的 agent 节点 `extraArgs` 含 shell 元字符
- **THEN** 该次启动归技术失败并给出可辨认原因，MUST NOT 剥掉该参数后照常启动

#### Scenario: 合法透传参数照旧原样传入
- **WHEN** `extraArgs` 为不含元字符的普通参数
- **THEN** 按既有契约原样切分并传入 argv，不做 flag 清单校验

#### Scenario: 环境不随应用启动方式变化
- **WHEN** 用户分别从桌面图标与从终端内命令启动本应用，各跑一次同一 agent 节点
- **THEN** 两次子进程的着色相关环境一致，agent 输出中 MUST NOT 出现 ANSI 转义序列

### Requirement: 流式输出推送合批与回看窗口

agent 的流式输出 SHALL 以「落盘保真、推送合批、常驻有界」三条独立口径处理：

- **落盘 MUST 保真且逐行即时**：原始流记录与输出分桶的写入 MUST NOT 被合批延迟或丢弃——崩溃半路时的可重建性优先于界面流畅。
- **推送 MUST 合批**：向渲染层推送的流式增量事件 MUST 按时间窗把同一输出桶的相邻增量合并后再发，MUST NOT 逐行推送（结构化流式输出的行频可达每 token 一行）。
- **渲染层常驻 MUST 有界**：渲染层对每个输出桶 MUST 只常驻尾部有界窗口，超出部分从内存丢弃；用户向上回看时 MUST 经既有的「从引擎缓冲读取该桶」路径取回，而非在内存中无上限累积。

系统 MUST NOT 以「累计输出超过上限即终止子进程」作为保护手段——长时间运行的 agent 必然触达任何此类上限，该手段会把正常运行判为异常。

#### Scenario: 高频流式输出不逐条推送
- **WHEN** 某 agent 节点持续产生高频流式输出
- **THEN** 渲染层收到的是按时间窗合并后的增量事件，而非与输出行数等量的事件

#### Scenario: 合批不影响落盘保真
- **WHEN** 某 agent 运行期间应用被关闭
- **THEN** 原始流记录与输出桶含到关闭前为止的**逐行完整**内容，MUST NOT 因合批而缺失尾部

#### Scenario: 超出常驻窗口的历史可回看
- **WHEN** 某桶的输出远超渲染层常驻窗口，用户向上回看更早的内容
- **THEN** 系统经既有引擎缓冲读取路径取回该桶完整内容供回看

#### Scenario: 长时间运行不因输出量被终止
- **WHEN** 某 agent 节点长时间运行并累计产生大量输出
- **THEN** 子进程照常运行至其自身结束，MUST NOT 因输出量触达某上限而被系统终止

