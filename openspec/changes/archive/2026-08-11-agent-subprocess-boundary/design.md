# 设计：一条边界，两个方向

## 为什么这些能凑成一个 change

表面上是「安全修一修 + 留痕补一补」两件事。它们能放一起，是因为**都发生在同一个接缝上**：`runInvocation` 那次 `spawn`。进去的是 argv 和 env，出来的是 stdout 流。这个接缝现在有两份实现（`agent/runner.ts` 与 `agent-runner.ts`），两边都得改——分成两个 change 就要动同一处代码两遍，且第二遍很容易只改一份。

## 进的方向

### 不是「加个校验」，是「把路径带出来」

现在的探测（`agents.ts:12`）已经在跑 `where claude`，只是 `stdio` 全 ignore、只看退出码。修法不是在 spawn 前插一道检查，而是**让探测的产物从布尔变成路径**——路径一旦是解析链上的唯一产物，「起了个假 CLI」这件事就在类型上没地方发生了。

`DetectedAgent` 带上路径后，`spawn` 侧就不再有「命令名」这个概念。

### `where` 自己也搜当前目录

这条容易漏。`where.exe` 的搜索范围是「当前目录 + PATH」，不是只有 PATH。所以解析本身必须在**受控工作目录**下跑（不能是任何项目 / worktree 目录），否则护栏在探测这一步就已经被绕过了。

今天 `makeAgentProbe` 用的是 `execFileSync` 不带 `cwd`，继承的是应用自己的 cwd，碰巧不在用户仓里——但这是**巧合不是设计**，要显式钉住。

配套护栏（照抄 NoteLoom 那套，它们是互补的、缺一条就漏）：

- 结果必须是绝对路径
- 必须 `isFile()` 为真
- 必须落在合理的可执行位置——**不得落在任何已注册项目 / worktree 目录内**
- 扩展名必须是 `.exe` / `.cmd`（Windows）

### `.exe` 与 `.cmd` 要分开处理，因为 Node 的引号规则不一样

Windows 上 `CreateProcess` 起不了 `.cmd`，必须经 cmd.exe。而 Node 在 `shell: true` 时的行为是：把 `command` 和 `args` 用**空格直接 join**，塞进 `cmd.exe /d /s /c "…"`，并设 `windowsVerbatimArguments`——**不加任何引号**。

所以两条路：

| 可执行形态 | 起法 | 注入面 |
|---|---|---|
| `.exe`（claude 原生安装器） | 直接 `spawn(absPath, args)`，**不走 shell** | 无——args 是数组，不经字符串 |
| `.cmd`（npm 安装） | 必须过 cmd.exe，由**我们自己**逐项加引号 | 引号规则由我们控制 |

优先走 `.exe` 那条——它不只是更安全，是**结构上没有拼接**。`.cmd` 那条无法避免，那就把引号规则收进一处、单测覆盖含空格 / `&` / `"` 的参数。

### `extraArgs`：封拼接，不封 flag

`splitExtra` 现在按空白切分直接进 argv。两种收紧方式：

1. **拒绝含 shell 元字符的项**（`& | ; < > ^ " '` 等）
2. **flag 白名单**

选 1，不做 2。理由：既有 spec 明写 `extraArgs` 透传、模型值不做清单校验，白名单会跟这个契约打架，而且任何白名单都会在下一次 CLI 更新后过时——过时的白名单会把合法用法挡掉，用户的反应是找个绕过去的口子，最后比没有更糟。

方式 1 封死的是「一个参数变成第二条命令」。至于 `--mcp-config ./x.json` 这类**语法合法但语义危险**的 flag，那是「agent author 出来的工作流该被审到什么程度」的问题，属于 `workflow-authoring` 的审阅闸，不该在 argv 层解决。

### 环境净化：为什么删 `WT_SESSION` 是这里最反直觉的一条

我们不渲染 ANSI，看起来跟配色无关。但反过来是问题：CLI 若认为自己在 24-bit 终端里，就会往 stream-json 的文本字段里塞 `ESC[38;2;r;g;b`，而 `CommandOutputView` 是个 `<pre>`——用户看到的是一屏 `[38;2;…`。

`WT_SESSION` 特别阴，因为它不是色深声明，是「我跑在 Windows Terminal 里」这句话。用户双击图标启动没这个键，从 Windows Terminal 敲命令启动就有——**同一个版本两种输出，且互相复现不了**。这类 bug 的排查成本远高于修它的成本。

显式设 `NO_COLOR=1` / `FORCE_COLOR=0`、删 `WT_SESSION` / `COLORTERM`，把输出锁成纯文本。

## 出的方向

### 两份记录，职责不同，不合并

| | 存什么 | 给谁看 | 已有 |
|---|---|---|---|
| `output-buffer` 分桶 | `displayFromStreamLine` 转写后的**展示文本** | 人（`CommandOutputView`）、`run-timeline-view` 展开 | 是 |
| 原始流记录（`historyPath`） | agent stdout **逐行原样**（claude 即 stream-json NDJSON） | 机器：续接重建、将来的工具时间线 | 字段有，没接线 |

会想合并成一份。不要——两边的正确取舍相反：展示要压缩（`tool_result` 全量刷屏没法看），重建要保真（`tool_result` 恰恰是 agent 需要知道的「我读到了什么」）。合成一份就必然有一边将就。

存两份的代价是磁盘，而磁盘是这里面最便宜的东西。保留口径跟 `output-buffer` 一致，同生共死。

### 续接兜底的实际损失

现在 `engine.ts` 的 `rebuildPrompt` 一带（本文写作时在 872 行，`run-timeline-view` 落地后约 889 行——按内容定位、别认行号）走的是：`outputBuffer.read()` → `slice(-8000)` → 拼进 rebuild prompt。这条链上叠了三层损失：

1. `adapter.ts:92` 把 `system` / `tool_result` 整类丢掉
2. `adapter.ts:83` 把 `tool_use` 的目标截到 80 字
3. `slice(-8000)` 再砍一刀

于是走到兜底层的 agent 收到的是「我调过 Edit，路径大概是 src/main/engine/engi…」。它知道自己动过手，不知道动了什么、看到了什么。

改成从原始记录派生后，转写规则由**重建这个用途**自己定（保留 `tool_result` 摘要、保留完整路径），跟展示用的转写解耦。截断仍然需要（prompt 有长度），但截断策略要按事件边界切、优先保留工具动作与结果，不是无脑砍尾。

注意 spec 里第 2 层写的是 "readable transcript"——原始 NDJSON 直接糊进 prompt 不合适，仍要转写，只是**转写的输入**从展示文本换成原始流。

### 背压：合批就够，不抄 seq/ack

NoteLoom 做 seq/ack + 高低水位，是因为他们要在渲染跟不上时**暂停 PTY**。我们不需要——无头子进程没有「一屏」的概念，我们也不想让 agent 因为 UI 慢而停下来。

我们的实际瓶颈是两处：IPC 消息频率（逐 token 一条），和渲染层 store 里那个只增不减的字符串。对应两个措施：

- 主进程侧按时间窗（量级 ~50ms）把同桶的 chunk 合并成一条再 `emit`。落盘照旧逐行、不受合批影响——崩溃半路的保真度不能拿去换 UI 流畅。
- 渲染层每桶只常驻尾部窗口，超出部分丢弃；用户往上回看时走既有 `readRunOutput` 从盘上读。这条正好接上 `CommandOutputView` 已经有的 seed 机制。

明确不做「输出超上限就杀进程」——长会话必然触发，那不是护栏是定时炸弹。

## 边界

- **不碰产出记录的 UI**。`run-timeline-view` 正在定义时间线怎么长，现在动会撞车。本 change 交付的是原料完整且可信；消费它的界面等那个 change 落地后单独提。届时的形状应该是**结构化事件的时间线**（工具调用可折叠、改动文件汇总、按续接轮次分段），而不是把结构化事件重新压成一屏字符——那是终端因为拿不到别的才做的事，我们拿得到。
- **不引入 PTY**。区别不在实现难度，在拿到什么：PTY 给一屏 ANSI，无头 stream-json 给带类型的事件。我们的编排、门动作、回滚、血缘全建在后者上。
- **两处 spawn 必须共用一套启动约束**（`agent/runner.ts` 与 `agent-runner.ts`）。这是本 change 最容易留下半拉子的地方——只改引擎那份、把分解 / 全局对话那份漏掉，等于没修。实现时抽一个共用的「按 `DetectedAgent` 起进程」函数，两边都走它。
