## ADDED Requirements

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

## MODIFIED Requirements

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
