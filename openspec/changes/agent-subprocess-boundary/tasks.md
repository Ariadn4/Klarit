# Tasks

> 设计已定：探测的产物从「有没有」升级为「在哪」（绝对路径成为启动的唯一来源）；`.exe` 直起不走 shell、`.cmd` 自行转义；`extraArgs` 封元字符不做 flag 白名单；原始流与展示转写**两份并存**、续接兜底从原始流派生；背压做合批 + 尾部窗口，不做 seq/ack、不做输出上限杀进程。
>
> **两处 spawn 必须共用一套启动实现**（`agent/runner.ts` 与 `agent-runner.ts`）——这是本 change 最容易留半拉子的地方。
>
> **不在本 change**：产出记录的 UI 升格（等 `run-timeline-view` 落地后单独提）、PTY、命令节点 spawn、固定安装路径候选表。

## 1. 探测留下绝对路径（`agent-detection`）

- [x] 1.1 写测试：探测成功 → `DetectedAgent` 带绝对路径；同一 agent 的 id/name/models 行为不变
- [x] 1.2 写测试：候选为相对路径 / 非文件 / 落在已注册项目或 worktree 目录内 → **视为未检测到**，且原因可辨认为「被护栏拒绝」而非「未安装」
- [x] 1.3 写测试：解析在受控工作目录下进行——worktree 内放同名文件时该文件不成为候选
- [x] 1.4 写测试：单个候选被护栏拒绝不影响其余 agent 的探测，整体不抛
- [x] 1.5 实现 `src/main/agents.ts`：`where`/`which` 取 stdout 拿路径（不再 ignore）、显式钉 `cwd` 为受控目录、逐条过护栏
- [x] 1.6 实现 `src/shared/types.ts` / `src/shared/agents.ts`：`DetectedAgent` 增可执行绝对路径字段

## 2. 共用的 agent 子进程启动实现（`agent-execution`）

- [x] 2.1 写测试：以绝对路径启动——cwd 内存在同名可执行文件时，起的是解析出的那个
- [x] 2.2 写测试：`.exe` 形态**不经 shell**、参数以数组传递
- [x] 2.3 写测试：`.cmd` 形态经 shell 时，可执行路径与每个参数各自加引号；含空格 / `&` / `"` 的参数以字面值抵达，不产生第二条命令
- [x] 2.4 写测试：解析不到可信绝对路径 → 归技术失败，**不**回落裸命令名
- [x] 2.5 写测试：子进程环境含 `NO_COLOR`/`FORCE_COLOR=0`，且不含 `WT_SESSION`/`COLORTERM`（父进程带这些键时亦然）
- [x] 2.6 实现共用启动函数（按 `DetectedAgent` 起进程，承载 2.1–2.5 全部约束）
- [x] 2.7 改 `src/main/agent/runner.ts` 的 `runInvocation` 走共用启动
- [x] 2.8 改 `src/main/agent-runner.ts` 的 `runAgentHeadless` 走**同一个**共用启动（分解 / 全局对话路径，勿漏）
- [x] 2.9 写测试：两处调用点的启动约束一致（同一份用例分别跑过两条路径）

## 3. 透传参数边界（`agent-execution`）

- [x] 3.1 写测试：`extraArgs` 含 shell 元字符 → 启动归技术失败并给出可辨认原因；**不**剥掉该参数照常启动
- [x] 3.2 写测试：普通 `extraArgs` 照旧按空白切分原样传入；模型值仍不做清单校验（既有契约不变）
- [x] 3.3 实现 `src/main/agent/adapter.ts` 的 `splitExtra` 校验 + 更新那句已过期的「工作流作者可信输入」注释

## 4. 原始流记录落盘（`agent-execution`）

- [x] 4.1 写测试：agent 运行 → 原始流记录逐行原样落盘，含展示转写会折叠的事件（工具结果 / 系统事件）
- [x] 4.2 写测试：运行半路中断 → 原始流记录与展示转写**均**含到中断为止的内容（非空）
- [x] 4.3 写测试：两份记录并存且互不覆盖；保留/清理口径一致
- [x] 4.4 实现 `src/main/engine/engine.ts`：为节点 agent / 续接 / heal agent 各传 `historyPath`（该字段已存在于 `AgentRunSpec`，只是从未接线）
- [x] 4.5 实现记录路径的分配与清理，与既有输出分桶同生共死

## 5. 续接兜底改从原始流派生（`agent-execution`）

- [x] 5.1 写测试：展示转写已折叠工具结果、截断工具目标时，重建 prompt 中仍含完整工具目标与工具结果要点
- [x] 5.2 写测试：原始记录超出预算 → 按事件边界截断、优先保留工具动作与结果；**不**按字符数截尾
- [x] 5.3 写测试：无原始记录（本能力上线前的运行）→ 回落既有展示转写路径，不报错、不阻断续接
- [x] 5.4 实现重建用转写（与展示用 `displayFromStreamLine` **解耦**，各自取舍）
- [x] 5.5 改 `src/main/engine/engine.ts` 的 `rebuildPrompt` 一带（按内容定位，行号已漂）：`rebuildPrompt` 的历史来源换成原始记录派生

## 6. 推送合批与回看窗口（`agent-execution`）

- [x] 6.1 写测试：高频流式输出 → 渲染层收到的事件数远少于输出行数（按时间窗合并）
- [x] 6.2 写测试：合批**不影响**落盘——中断时落盘内容逐行完整、无尾部缺失
- [x] 6.3 写测试：渲染层每桶常驻内容有界；超界后经 `readRunOutput` 仍能取回完整内容回看
- [x] 6.4 写测试：长时间大量输出的运行不被系统终止（无输出上限杀进程）
- [x] 6.5 实现主进程侧同桶时间窗合批（落盘路径绕过合批）
- [x] 6.6 实现渲染层输出 store 的尾部窗口 + 与 `CommandOutputView` 既有 seed 机制衔接

## 7. 收尾

- [x] 7.1 `npm run typecheck` 两套干净 + `npm run test:run` 全绿（本 change 落地后 1826 passed / 141 files）
- [ ] 7.2 dogfood：本机跑一张真卡的 agent 节点，确认 —— 起的是绝对路径的 CLI（可由日志/进程核对）、输出无 ANSI 转义、原始记录落盘非空、长跑不卡界面
- [ ] 7.3 dogfood：手工制造一次 resume 失败走兜底层，核对喂回的历史含工具目标与结果
