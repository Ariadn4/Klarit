## Why

我们跟 agent 之间只有一条边界——一次无头子进程启动。这条边界上有两件事没做对：**进去的东西没验身份，出来的东西没留全。**

**进去的方向：起的可能不是真 CLI。**

`src/main/agent/runner.ts:57` 与 `src/main/agent-runner.ts:128` 都是：

```ts
spawn('claude', args, { cwd: spec.cwd, shell: isWin, ... })
```

裸命令名 + Windows `shell: true`。cmd.exe 解析命令时**先看当前目录**，而当前目录正是需求卡的 worktree——一个由外部 agent 往里写代码、内容可能来自导入的第三方项目的目录。仓库根放一个 `claude.cmd`，起来的就是它。

讽刺的是路径我们早就查到过：`src/main/agents.ts:15` 用 `where`/`which` 探测，但 `stdio` 全 ignore，只留下「有没有」、把路径丢了。

同一处还有第二个洞：`shell: true` 时 Node 在 Windows 上**不给 args 加引号**，直接拼成 `cmd.exe /d /s /c "<command> <args...>"`。而 `adapter.ts:96` 的 `splitExtra` 把 `extraArgs` 按空白切开塞进 argv，注释写的是「工作流作者可信输入」——但 `workflow-onboarding` / `workflow-from-habits` 之后，工作流已经是 **agent 自动 author 出来的**了。那句注释描述的信任模型已经不成立，`extraArgs` 里一个 `&` 就能拼出第二条命令。

**出来的方向：留痕是有损的，而续接靠它重建。**

- `runner.ts:39` 的 `historyPath`（原始流式记录落盘）**定义了，但引擎从来没传过**——全量 stream-json 落地即蒸发。
- 于是 `engine.ts:872` 的续接兜底只能去读 `outputBuffer` 里的**展示文本**。而那份文本已经被 `adapter.ts:92` 削过：`system` / `tool_result` **整类丢弃**、`tool_use` 的目标**截到 80 字**，之后再 `slice(-8000)`。续接重建时喂回给 agent 的是「我调过 Edit，路径大概是…」——它看不到自己读到过什么、命令跑出了什么。这正是 `agent-execution`「续接阶梯」第 2 层赖以工作的东西。
- `runner.ts:97` 的 stdout 读取没有任何节流：逐 token 一行的 NDJSON → 逐条 `emit op-chunk` → IPC 推送 + 渲染层 store 里对该桶做**全量字符串拼接**。一个跑几十分钟的 agent 节点会把 IPC 频率和渲染层内存一起顶上去。

三条都不是「将来会怎样」，是现在这样。

## What Changes

- **agent CLI 以解析出的绝对路径启动**：探测（`agent-detection`）从「有没有」升级为「在哪」——留下绝对路径。解析 MUST 在受控工作目录下进行（`where` 自身也搜当前目录），结果 MUST 是绝对路径、MUST 指向真实文件、MUST NOT 落在任何项目 / worktree 目录内。启动时用这个绝对路径，MUST NOT 把裸命令名交给 shell 解析。
- **argv 不经 shell 字符串拼接**：`.exe` 直接 spawn（不走 shell，参数按数组传，无拼接面）；`.cmd` / `.bat` 必须过 cmd.exe，则由我们自己逐项加引号。
- **透传参数收紧**：`extraArgs` 的来源已从人手写变成 agent 生成，MUST 拒绝含 shell 元字符的项。**不做 flag 白名单**——那与既有「`extraArgs` 透传」契约冲突且清单必然过时；本 change 只封死「一个参数变成第二条命令」这条路。
- **子进程环境净化**：显式关掉 ANSI 着色（`NO_COLOR` / `FORCE_COLOR=0`）并剔除会让 CLI 误判终端能力的变量（`WT_SESSION` 等）。否则同一版本从桌面图标启动和从 Windows Terminal 启动，agent 输出的干净程度不同——`<pre>` 里会冒出 `[38;2;…` 且**只在部分用户机器上复现**。
- **原始流式记录全量落盘 + 续接从它派生**：接上 `historyPath`，把 agent 的原始输出流逐行原样落盘（与 `output-buffer` 的展示文本**并存、职责不同**，不合并、不互相取代）。续接阶梯第 2 层的「喂回历史」改从这份原始记录派生，不再吃展示文本的二次损失。
- **流式推送合批 + 回看窗口**：主进程侧按时间窗合并 `op-chunk` 再推送；渲染层每桶只常驻尾部窗口，往上回看走既有 `readRunOutput` 读盘。MUST NOT 用「输出超上限就杀进程」这类粗暴护栏——长会话必然触发。

## Capabilities

### Modified Capabilities

- `agent-detection`: 探测结果从 `{id, name, models}` 扩为带**可执行绝对路径**；新增路径解析的安全约束（受控工作目录、绝对、真实文件、不得落在项目目录内）。
- `agent-execution`: 新增「以绝对路径启动、argv 不经 shell 拼接、透传参数与环境变量的边界」与「流式推送合批与回看窗口」；「所有 agent 运行全量留痕」改为要求**原始流保真**（而非只有展示转写）；「续接阶梯」第 2 层的喂回历史改为**从原始记录派生**。

## Impact

- **依赖 / 复用**：建立在 `agent-detection`（探测已经在调 `where`/`which`，只是丢了路径）、`agent-execution`（adapter / runner / 续接阶梯）之上。复用 `runner.ts` 里**已经写好但没接线**的 `historyPath`。
- **代码**：`src/main/agents.ts`（探测留路径 + 护栏）、`src/shared/agents.ts` + `src/shared/types.ts`（`DetectedAgent` 带路径）、`src/main/agent/runner.ts`（绝对路径启动、env 净化、合批、接 `historyPath`）、`src/main/agent-runner.ts`（同一套启动约束，别写第二份）、`src/main/agent/adapter.ts`（`splitExtra` 校验）、`src/main/engine/engine.ts`（传 `historyPath`、喂回历史改读原始记录）、渲染层输出 store（尾部窗口）。
- **兼容**：**agent 的行为与产出完全不变**——同一个 CLI、同一套 argv 语义、同一份握手契约。变的是「怎么找到它、怎么把参数交给它、把它吐的东西留多少」。既有断点、既有输出桶、既有工作流定义都不受影响。
- **风险**：解析不到绝对路径的 agent（装法特殊、只在某个 shell 的 alias 里）会从「能跑」变成「未检测到」。这是**故意的**——起不确定身份的东西比不起更糟。缓解是解析失败时给出可辨认的原因（不是笼统的「未安装」），并留手工指定路径的口子作为后续。
- **不在本 change**：
  - **产出记录的 UI 升格**（可折叠的工具调用时间线、本节点改动文件汇总、按轮次分段）——那要建在 `run-timeline-view` 之上（该 change 已于本 change 之前落地，撞车风险已消除，但 UI 升格仍不在本 change 范围）。本 change 只负责**把原料完整地留下来**，怎么展示等 `run-timeline-view` 落地后单独提。
  - **交互式 PTY**（xterm + node-pty）。我们要的是可编排、可判定成败的无头执行，PTY 给的是一屏给人眼看的 ANSI 字符，拿不到 `tool_use` / `session_id` 这类结构化事件。方向相反，不引入。
  - **命令节点的 spawn**（`command-run.ts:74`）——命令节点的本意就是「跑这条 shell 命令」，信任模型与「起一个已知身份的 CLI」不同，不套用本 change 的约束。
  - **固定安装路径候选表**（如 `%APPDATA%\npm\claude.cmd`）。主路径是 `where`/`which` 给的绝对路径加护栏；维护一张会过时的候选表收益不足，PATH 未命中时的补充留待需要时再提。
  - `extraArgs` 的 flag 白名单（理由见 What Changes）。
