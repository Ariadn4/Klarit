## Context

引擎脊柱（`add-engine-execution-spine`）、命令执行器（`add-command-executor`）、运行绑卡（`card-persistence-board-run`）、多仓扇出（`multi-repo-card-branching`）、卡面多 worktree（`show-card-worktrees`）均已归档。当前 `engine.ts` 的 `drive()` 循环里，`command`/`engine` 节点真跑，**`agent` 与 `subworkflow` 仍 no-op**（第 649-653 行 `emit 'skip'`）。周边基建已就位却未点火：

- `assembleAgentPrompt`（`src/shared/agent-prompt.ts`）纯函数拼 prompt，预览与执行同源，但**无引擎交互协议节**。
- `command-run.ts` 提供杀进程树 / 流式 / 可取消 spawn；`agent-runner.ts` 提供无头喂 prompt 形态（分解用）。二者可复用，agent 执行**不需要 PTY**（研究确认 claude/codex/cursor 三家均无头可跑、无需 TTY）。
- `board.ts:runDot` 已对 `executing` 阶段 agent 节点派生 `violet` 紫点——只要 agent 节点**停留** executing 即自动点亮。
- 类型口子齐全：`AgentExecConfig{toolId,model,extraArgs}`、`AgentStructuredOutput{repos}`、`NodeExecutor{kind:'agent'}`、`EngineDecision.sourceKind:'agent'`、`RunBreakpoint.upstreamOutputs`、`NodeTarget.fromUpstream`、每成员 `MemberDerived`（`bp.members`）。
- 多仓模型：一卡一分支名（卡 slug）跨成员仓同名，各成员仓一条从该分支派生的 worktree；`runEngineOp` 已按成员 for 循环扇出。

约束：测试先行（先红后绿，针对公共 API，假 adapter/假握手注入）；只用语义令牌；`sourceKind` 决策文案走 i18n key。

## Goals / Non-Goals

**Goals:**
- `drive()` 的 agent 分支真执行：无头 adapter 在成员仓 worktree 拉起 agent CLI 写代码，喂含引擎交互协议的完整 prompt，流式回显。
- agent↔引擎握手文件协议（真相源 + 缺失乐观降级）。
- 续接三层阶梯（原生 resume → 自存重建 → 重跑），增量自存边跑边落盘。
- agent 节点自愈：门失败/产出缺失/越界/提问 → 续接回喂限次 → 超限抛 `sourceKind='agent'` 决策落单卡。
- 可写范围越界后置检测 + 还原 + 每节点提交（记 SHA）。
- 同一 agent 节点的多仓由**一个 agent** 跨仓承担（多目录），越界/提交仍按目标仓各自成立；`{repos}` 填充驱动 `fromUpstream`。
- 紫点点亮（零看板改动）。

**Non-Goals:**
- 引擎/命令节点自愈（→ B3）；决策的单需求/全局路由与跨卡弹窗（→ B3/B4）；全局/单需求 agent 用户主动唤起入口（→ B4）。
- subworkflow（仍跳过）；**按成员扇出多个 agent 及其并行/协商机制**（已由「一个 agent 跨仓」取代）；**node-pty 实时 stdin 注入**（留作未来能力）；模型/后端接入（智谱/两轴 shell×backend）；原生 resume 之外的性能优化。

## Decisions

### D1：无头 spawn，不引入 node-pty
三家 CLI 全部支持无头（`claude -p` / `codex exec` / `cursor-agent -p`）、经管道 stdio 运行、无需 TTY。故 agent 执行器复用 `command-run.ts` 式的流式+杀进程树+可取消 spawn，**不加 node-pty**，避开 electron 原生模块 rebuild + 跨平台预编译 + prompt-readiness 时序。PTY 实时 stdin 注入（不退出中途灌指令）留作未来能力——当前所有交互（决策/叫停/自愈）都经「进程退出 + 握手 + 续接」达成，不需要活 stdin。
*备选*：node-pty 常驻交互——否决（重、脆、当前架构用不上）。

### D2：握手文件为唯一真相源，stdout 只展示
`worktree/.klarit/handshake.json` 承载全部结构化控制状态（`status`/`decision`/`repos`/`note`），引擎进程退出时读。stdout 在 PTY-free 下仍可能被工具输出/ANSI 污染且交错，**绝不解析控制状态**，只流式推 `op-chunk` 展示。握手**缺失=乐观 done**：容忍第三方 CLI 不遵守协议，真未完成由客观门 + 越界检测兜底触发自愈。这让协议对不完美 agent 稳健降级。
*备选*：stdout 哨兵块——否决（脆）；文件+stdout 双写——过度，留后续若需存活探测再加。

### D3：续接「就高不就低」阶梯——`--resume <sessionId>` + 喂回历史兜底
一个 agent 节点一个会话（一节点一个 agent，见 D4）。**从流式输出抓 session id 存断点，续接时按 id 精确 `--resume`**（不是 `--continue`「最近一条」——否则暂停A/暂停B/恢复A 会接错）。抓不到 id / resume 失败 → 喂回**已增量自存的 readable transcript**（完整任务 + 历史 + 续接说明）全新起；worktree 文件永远垫底。dogfood 撞真 CLI 印证过：只发 delta 会让 agent 迷失，故 resume 的 inject 也交代清楚、全新起则重述完整任务。关键洞：写代码 agent 的真状态在 **worktree 文件 + 自存 transcript**，非 agent 进程内存。但**活现状是 agent 干完末尾才写**——崩溃/关软件卡半路时它为空。故：
1. **原生 resume 首选**（`claude --continue`/`codex exec resume --last`/`cursor --continue`，续 cwd 最近一次可免抓 session id）——接 agent 自己盘上增量写的会话，最高保真、覆盖崩溃半路。
2. **自存历史重建兜底**——把现有 `op-chunk → output buffer`（`userData/engine-runs/<runId>/`）正式定义为「崩溃可存活的增量自存会话记录」，adapter 无关，抗未来无 resume / resume 失败；用它 + worktree 重拼 prompt 全新 `start`。
3. **重跑本节点最粗兜底**。

自存**必须边跑边增量落盘**（复用已有分桶缓冲持久化），不等干完——否则崩溃半路自存为空。续接选择收敛为**一处判定**，统一覆盖自愈/答决策/崩溃恢复。原生 resume 之所以是首选而非唯一：用户明确要求「防未来 agent 没 resume / resume 失败」，故自存兜底必须常在。
*备选*：只靠原生 resume——否决（未来 agent 可能没有、且 resume 可能失败）；只靠自存不用原生——否决（崩溃半路自存可能不如 agent 自己的会话完整，浪费保真度）。

### D4：同一 agent 节点的多仓由**一个 agent** 跨仓承担（不按成员扇出多个 agent）
一个 agent 节点用**一个** agent 承担其全部目标仓——引擎把各目标仓的 worktree 一并交给它（claude `--add-dir` 之类多目录），它在这些仓间做紧耦合改动、要并行就自起子 agent。**关键区分**（用户澄清）：project-goals「Agent 之间不直连、走引擎中转」约束的是**不同节点/不同需求**的 agent；**同一节点面对多仓时目的一致、内容紧耦合**，理应一个 agent 干完，而不是拆成前端/后端两个 agent 再为它们造一套跨仓协商机制——那太复杂、且紧耦合下"两 agent 谈不拢"无解。

一个 agent 带来的连锁简化：**① 无「串行 vs 并行扇出」**（一个 agent，并行是它自家子 agent 的事）；**② 无「门失败退给哪个成员」归因难题**（一个 agent 知全局、续接它一个即可）；**③ 无每成员 session/输出分桶**（一节点一会话一输出流，天然契合 `pendingDecision` 单决策模型）。越界检测/每节点提交仍**按每个目标仓各自成立**（对齐 project-goals「可写范围与越界检测在各成员仓各自工作分支内分别成立」）——改动虽由一个 agent 造成，检测/还原/提交仍逐仓独立。

*备选一*：**按成员扇出多个 agent**——否决（曾是初版）。紧耦合工作被拆开后，后干的 agent 发现要改前面的仓时无法与已完成的 agent 协商，只能靠"人/门中转"，别扭；且共享门失败无法归因到某个成员 agent。一个 agent 从根上消除这些。
*备选二*：**跨仓也靠子 agent（一个 agent 跨磁盘各处的独立仓）**——三家子 agent 均在**单仓/单 cwd 内**并行，本身够不到别的成员仓；但我们正是用外壳的**多目录**能力（`--add-dir`）把多个 worktree 交给同一个 agent，让它把这些仓纳入自己的工作集，其内部要并行仍可自起子 agent。代价：多根目录逆着 agent「单仓」手感，接受（换掉一整套跨 agent 协商机制，划算）。

### D5：越界后置检测 + 每节点提交，起始 SHA 入断点
无头拉第三方 CLI 无法逐路径沙箱（且一个 agent 跨多仓写），故**节点完成时后置检测**、按每个目标仓各自成立：每目标仓 `git diff --name-only <节点起始SHA>`（含工作区）对比 `writableScope ∪ 产出路径`；越界文件 `git checkout <起始SHA> -- <file>` 确定性还原、范围内保留。还原后引擎**提交范围内改动**、记 commit SHA（溯源锚点 + 下一节点越界基线）。为此断点新增每成员**节点起始 SHA**，节点起始时记、恢复沿用（不重算，避免漂移——对齐 `show-card-worktrees` 的「派生纯函数」红线）。越界超限决策**必含「放宽可写范围」**选项。
*备选*：不提交、只 diff 工作区 vs HEAD——否决（无每节点 SHA 供溯源/下一节点基线，用户已定「每节点提交:要」）。

### D6：`sourceKind='agent'` 决策构造 + 续接注入
`decisions.ts` 现把 `sourceKind` 写死 `engine`。新增 agent 决策构造器：`sourceKind='agent'`、选项取自握手 `decision.options`、附**自由输入**（agent 来源允许开放答案）。`engine.ts:decide()` 对 agent 来源决策把选中项/自由文本经续接注入原 agent 续跑（非现有的 git 参数分支）。单卡渲染无需改——既有「单卡决策在详情面板内呈现」已泛化渲染 `options`+`input`。

### D7：adapter 接口形状
```
interface AgentAdapter {
  // cwd=主目标仓 worktree; extraDirs=其余目标仓 worktree（一个 agent 跨仓，如 claude --add-dir）
  start(prompt, cwd, extraDirs, {model, extraArgs}): AgentRun    // 无头拉起, 流式, 可取消
  resume(cwd, extraDirs, injectedPrompt, {model, extraArgs}): AgentRun | null  // 原生续接; 不支持返 null
  supportsResume: boolean
}
// AgentRun: { 流式回调, kill(), 退出 Promise } —— 复用 command-run 的句柄形态
// 握手读取与 adapter 无关（永远读 主目标仓 worktree/.klarit/handshake.json）
```
三家实现差异只在启动/续接 argv、多目录 flag 与免交互 flag。注册表键 `AgentId`（复用 `SUPPORTED_AGENTS`）。测试注入**假 adapter**（可编排退出码 + 写假握手文件），不依赖真 CLI。

## Risks / Trade-offs

- **第三方 CLI 不遵守握手协议** → 缺失乐观 done + 客观门/越界兜底触发自愈（D2）；协议节写清指令。
- **原生 resume 半路会话不完整/续接失败** → 三层阶梯自动降级到自存重建（D3）。
- **越界还原撤掉范围内改动依赖的文件** → 范围内残缺由后续测试/客观门自然挡下重做（可写范围规格既定行为）；越界超限给「放宽可写范围」避免死循环。
- **一个 agent 跨多根目录逆着「单仓」手感** → 接受（用外壳多目录能力 `--add-dir`，内部并行由 agent 自起子 agent）；换掉一整套跨 agent 协商机制，划算。
- **自存会话记录是流式展示文本（含噪音）用于重建** → 兜底层保真度低于原生 resume，但有 worktree 垫底且仅在原生续接不可用时启用；可接受。
- **免交互写文件 flag 的破坏性**（`--dangerously-skip-permissions` 等）→ agent 限定在成员仓 worktree（隔离工作树），越界后置检测 + 每节点提交把改动锁在范围内；对齐 project-goals「引擎按需分配读写权限、限定分支」。
- **claude 拒绝以 root 在非沙箱运行 `--dangerously-skip-permissions`** → dogfood/文档提示；非本 change 逻辑。

## Migration Plan

1. **类型先行（先红）**：`src/shared/types.ts` 增断点每成员 `startSha` / `agentAttempts` / 每节点 `commitSha` 字段、握手结构类型；`agent-prompt.ts` 握手 schema 常量。
2. **握手协议节（先红后绿）**：`assembleAgentPrompt` 加「引擎交互协议」层（纯函数测试：层恒在、含握手指令、确定可复现、预览执行同源）。
3. **adapter 层（先红后绿）**：接口 + claude/codex/cursor 三家 argv 翻译（免交互 flag、选模型 flag、resume argv）；假 adapter 测试替身。
4. **握手读取 + 增量自存**：进程退出读 `.klarit/handshake.json`；`op-chunk→output buffer` 增量落盘定义为自存记录。
5. **`drive()` agent 分支**：解析目标仓子集 → 把各目标仓 worktree 交给**一个** adapter.start（多目录）→ 流式 → 退出读握手 → 分流（done/need-decision/failed）。紫点随之点亮。
6. **越界检测 + 每节点提交**：起始 SHA 记断点 → diff/还原 → 提交范围内 → 记 commit SHA；越界超限决策含「放宽可写范围」。
7. **自愈 + 续接阶梯**：门失败/产出缺失/越界/提问 → 续接回喂限次 → 超限 `sourceKind='agent'` 决策；`decide()` 续接注入；`resumeAll` 续接崩溃半路 agent 节点。
8. **`{repos}` 填充**：done 从握手填 `upstreamOutputs`，`fromUpstream` 运行时收窄接上。
9. **typecheck + test:run 全绿**；dogfood 端到端验收（紫点亮→真改文件→制造门失败看自愈→过门完成）。
10. **回退**：agent 分支落地是纯增量（no-op → 真执行）；关掉/回退该分支即恢复「跳过」行为，不破坏 command/engine 既有路径。

## Open Questions

- 无（六处岔路——传输/握手/adapter/续接/越界+提交/多仓扇出——已与用户逐一敲定）。
