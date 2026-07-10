## Why

引擎脊柱、命令执行器、卡模型 + 看板 run 集成、多仓卡分支都已归档，但 **agent 节点在 `engine.ts` 的 `drive()` 里仍是 no-op**（第 649-653 行，`emit 'skip'`）——工作流一遇到 agent 节点就跳过，AI 从不真正写代码。周边基建（`assembleAgentPrompt` 拼 prompt、`agent-detection` 扫 agent、`agent-runner` 无头缝、`command-run` 可取消 spawn、`board.ts:runDot` 紫点派生、`AgentStructuredOutput{repos}` / `fromUpstream` 类型口子）已散落就位却无人点火。本 change 让 agent 节点真正跑起来，并顺带白送 agent 节点自愈。

## What Changes

- **agent 执行器落地**：`drive()` 里 agent 节点的 no-op 换成真执行——无头 spawn 拉起 agent CLI，在需求卡的**成员仓 worktree** 里跑，喂 `assembleAgentPrompt` 拼好的完整 prompt（宪法 + 节点 prompt + 需求卡活现状 + 可写范围 + 产出 + **新增的引擎交互协议**），流式回显、可取消。
- **adapter 层（3 个 agent 外壳）**：claude / codex / cursor，声明式接口把 `{toolId, model, extraArgs}` 翻成各家无头启动命令（免交互写文件 flag、模型 flag、结构化输出 flag）。**只接 agent 外壳，不接模型/后端**（GLM 等无独立 agent CLI，是模型不是外壳，留后续）。
- **agent↔引擎哨兵/握手协议**：`worktree/.klarit/handshake.json` 为**唯一真相源**（`status: need-decision | done | failed` + `decision` + `repos[]` + `note`）；stdout 只做流式展示、绝不解析控制状态。引擎进程退出时读握手；**握手缺失 = 乐观 done、交给门兜底**（容忍第三方 CLI 不完美遵守协议）。
- **续接机制（就高不就低阶梯）**：① 原生 resume 首选（接 agent 自己盘上会话，管崩溃半路）→ ② 自存历史重建兜底（把 op-chunk→output buffer 正式定义为「崩溃可存活的增量自存会话记录」，adapter 无关，抗未来没 resume / resume 失败的 agent）→ ③ 重跑本节点最粗兜底；三层底下永远垫 worktree 文件。自存**边跑边增量落盘**（不等干完，否则崩溃半路活现状为空）。
- **agent 节点自愈（白送）**：门失败 / 产出缺失 / 越界 / agent 运行时提问 → 续接回喂原 agent 注入失败详情重做，**限次** → 超限抛 `sourceKind='agent'` 决策落单卡（复用 B1 的 RunDecisionPanel），选项取自握手的 agent 自填选项 + 自由输入。
- **可写范围越界后置检测 + 每节点提交**：节点完成时比对每成员 git 改动集 vs `可写范围 ∪ 产出路径`，越界文件确定性还原到节点起始基线、范围内保留 → 带详情喂回重做（限次）→ 超限抛决策（**必含「放宽可写范围」选项**）。还原后引擎**提交范围内改动**、断点记 commit SHA（代码隐式产出的溯源锚点，也当下一节点越界基线）。
- **多仓由一个 agent 跨仓承担**：同一 agent 节点面对多个目标仓时，由**一个** agent 统一干活——引擎把各目标仓的 worktree 一并交给它（多目录，如 claude `--add-dir`），紧耦合改动一个脑子做完、要并行它自起子 agent；越界检测/每节点提交仍按每个目标仓各自成立。「agent 不直连、走引擎中转」约束的是**跨节点/跨需求**，同节点多仓不受此限、不为其造跨 agent 协商机制。
- **点火 hook**：看板紫点随 agent 节点停留 `executing` 自动点亮（`runDot` 已就绪，看板零改动）；agent `done` 时从握手填 `bp.upstreamOutputs[nodeId].repos`，供下游 `target=fromUpstream` 运行时收窄。

## Capabilities

### New Capabilities
- `agent-execution`: agent 执行器与 agent↔引擎合约——adapter 层接口（3 家外壳的无头 start/resume + 多目录翻译）、握手文件协议（真相源 + 缺失降级）、续接三层阶梯、自愈回喂与 `sourceKind='agent'` 决策、可写范围越界后置检测 + 每节点提交、同节点多仓由一个 agent 跨仓承担的编排。

### Modified Capabilities
- `engine-execution`: `drive()` 里 agent 节点由 no-op 改为调用 agent 执行器；「agent 节点重跑 `executing`」语义由「从头」改为「续接」；断点新增**每目标仓节点起始 SHA / 每节点提交 SHA**、**每节点 agent 会话续接 token / attempts**；`resumeAll` 认出并续接崩溃半路的 agent 节点。
- `agent-prompt-assembly`: `assembleAgentPrompt` 新增一节「引擎交互协议」——教 agent 写握手文件 + 声明 `{repos}`；预览与执行同源（协议节恒在，与需求卡占位/真值无关）。
- `repo-targeting`: agent 节点按 `target` 解析的成员子集**由一个 agent 跨仓承担**（engine 节点仍逐成员扇出）；`target=fromUpstream` 由「类型口子」变为**运行时真收窄**——消费上游 agent 节点 `done` 时写入 `upstreamOutputs[nodeId].repos` 的涉及仓判定。

> 单卡决策面板无需改：`sourceKind='agent'` 决策通过既有决策结构的 `options`（agent 自填选项）+ `input`（自由输入）字段承载，`requirement-card-detail` 的「单卡决策在详情面板内呈现」已泛化渲染二者。agent 决策的构造归 `agent-execution` / `decisions.ts`。

## Impact

- **依赖**：**不引入 node-pty**（三家 CLI 全部无头可跑、无需 TTY）；复用 `command-run.ts` 的杀进程树/流式/可取消与 `agent-runner.ts` 的喂 prompt 形态。
- **前置**：`add-engine-execution-spine`、`add-command-executor`、`card-persistence-board-run`、`multi-repo-card-branching`、`show-card-worktrees`（均已归档）——脊柱、命令执行器、运行绑卡、多仓扇出、每成员 `MemberDerived` 与 `bp.members` 均已就位。
- **代码**（预估）：
  - `src/main/agent/`（新）：adapter 接口 + claude/codex/cursor 三家实现、握手文件读写、续接选择逻辑、增量自存会话持久化。
  - `src/main/engine/engine.ts`：`drive()` agent 分支落地、agent 节点续接/重跑、越界检测 + 每节点提交编排、`resumeAll` 续接 agent 节点、`decide()` 把选中项续接注入。
  - `src/main/engine/decisions.ts`：新增 `sourceKind='agent'` 决策构造器（越界含「放宽可写范围」选项）。
  - `src/shared/agent-prompt.ts`：新增「引擎交互协议」节 + 握手 schema 常量。
  - `src/shared/types.ts`：`RunBreakpoint` 新增每目标仓节点起始 SHA / 每节点提交 SHA / 每节点 agent 续接 token / attempts 字段；握手结构类型。
  - `src/main/git-write.ts` / `git.ts`：越界还原（`checkout <sha> -- <file>`）、节点起始 SHA 读取、范围内提交（如缺则补）。
  - 渲染层无需改：agent 决策复用既有 RunDecisionPanel 的 `options`/`input` 渲染。
- **测试**：测试先行；PTY/agent 交互用**假 adapter + 假握手文件**注入来测（同引擎既有 `runCommand` 注入模式），不依赖真 CLI。
- **验收**：dogfood 建卡 → 激活含 agent 节点工作流 → 运行 → 紫点亮、agent 在 worktree 真改文件 → 制造客观门失败看 agent 自愈回喂 → 过门到完成。
