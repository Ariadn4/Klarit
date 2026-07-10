# 实现顺序：先用 **claude + 单仓** 把最险的假设（握手/停下提问/自愈/续接）撞真 CLI 验证（里程碑 A），再铺开三家 + 多仓（阶段 B），最后全量验收（阶段 C）。全程测试先行（先红后绿，针对公共 API；假 adapter/假握手注入测引擎，真 CLI 只在里程碑验收）。

## 阶段 A ── claude + 单仓端到端（先把核心闭环撞真 CLI）

### 1. 类型与握手 schema（先红）

- [x] 1.1 `src/shared/types.ts`：`RunBreakpoint` 新增每目标仓 `nodeStartSha`（节点起始基线）与每节点 `commitSha`（代码隐式产出锚点）、每节点 `agentSession`（单一会话续接 token）与 `agentAttempts`（每节点自愈计数）字段（可选，向后兼容旧断点）
- [x] 1.2 `src/shared/types.ts`：握手结构类型 `AgentHandshake { status: 'need-decision'|'done'|'failed'; decision?: { options; multi?; freeInput? }; repos?: string[]; note?: string }`
- [x] 1.3 `src/shared/agent-prompt.ts`：握手文件约定路径常量（`.klarit/handshake.json`）与「引擎交互协议」文案常量（固定中文，非 i18n）

### 2. prompt 引擎交互协议节（先红后绿）

- [x] 2.1 `agent-prompt.test.ts`：断言「引擎交互协议」层恒在（无论有无卡/产出）、含握手指令（status/decision/repos/note + 「stdout 仅展示」）、层序为第 7 层、确定可复现、预览执行同源
- [x] 2.2 `assembleAgentPrompt`：加第 7 层「引擎交互协议」，绿灯上条测试

### 3. adapter 接口 + claude 一家（先红后绿）

- [x] 3.1 `src/main/agent/adapter.ts`：定义 `AgentAdapter { start(prompt,cwd,extraDirs,opts); resume(cwd,extraDirs,inject,opts); supportsResume }` 与 `AgentRun` 句柄（复用 command-run 流式/kill/退出 Promise 形态）；`extraDirs` 本阶段恒空（单仓）
- [x] 3.2 假 adapter 测试替身：可编排退出码、写假握手文件、模拟 resume 支持/失败（贯穿引擎测试）
- [x] 3.3 claude adapter：`claude -p` + `--model` + `--dangerously-skip-permissions` + 结构化输出 flag；resume `--continue`/`--resume`（`supportsResume=true`）；session id 捕获或「续 cwd 最近一次」策略敲定
- [x] 3.4 adapter 注册表：按 `AgentId`（复用 `SUPPORTED_AGENTS`）解析；未装/拉起失败归技术失败（不静默换外壳）

### 4. 握手读取与增量自存（先红后绿）

- [x] 4.1 握手读取：进程退出时读主目标仓 `worktree/.klarit/handshake.json`，解析为 `AgentHandshake`；缺失/解析失败 → 视作 `status='done'`（乐观降级）
- [x] 4.2 增量自存：把 `op-chunk → output buffer` 正式定义为「崩溃可存活的自存会话记录」，确保边跑边落盘（复用现有分桶缓冲持久化），供续接第 2 层重建

### 5. 续接三层阶梯（先红后绿）

- [x] 5.1 续接选择器（一处判定）：有健康会话且 `adapter.supportsResume` → 原生 resume；否则 → 自存重建（重拼 prompt + delta + worktree）→ 最粗兜底重跑节点
- [x] 5.2 续接 delta 拼装：把「失败详情 / 决策答复 / 已做进度」注入续接 prompt（重拼走 `assembleAgentPrompt` + delta 段）
- [x] 5.3 测试：三层各自触发路径（resume 成功 / resume 失败降级自存 / 自存缺失重跑）用假 adapter 覆盖

### 6. drive() agent 分支（单仓，先红后绿）

- [x] 6.1 `engine.ts`：agent 节点 `executing` 分支替换 no-op——解析目标仓（单仓即唯一成员），记 `nodeStartSha`，`adapter.start(prompt, cwd, [], ...)` → 流式 op-chunk → 退出读握手
- [x] 6.2 握手分流：`done` → 越界检测/提交/门把；`need-decision` → 抛 `sourceKind='agent'` 决策；`failed` → 自愈回喂
- [x] 6.3 假 adapter/假握手驱动的引擎测试：agent 节点端到端跑通、紫点停留 executing、agent 完成才进门把
- [x] 6.4 确认 `board.ts:runDot` 紫点随 agent 节点停留 executing 点亮（无需改 board；补一条派生测试即可）

### 7. 越界后置检测 + 每节点提交（单仓，先红后绿）

- [x] 7.1 `git.ts`/`git-write.ts`：读节点起始 SHA、`diff --name-only <sha>`（含工作区）、`checkout <sha> -- <file>` 还原、范围内 commit
- [x] 7.2 越界检测：比对改动集 vs `writableScope ∪ 产出路径`；越界还原、范围内保留；带越界详情喂回自愈（限次）
- [x] 7.3 每节点提交：越界还原后提交范围内改动、记 `commitSha`（无改动跳过、不产空提交）；下一节点起始基线取此 SHA
- [x] 7.4 测试：越界文件被还原/范围内保留、越界超限决策含「放宽可写范围」、起始 SHA 恢复沿用不漂移、无改动不空提交

### 8. agent 自愈 + sourceKind=agent 决策（先红后绿）

- [x] 8.1 `decisions.ts`：新增 agent 决策构造器（`sourceKind='agent'`、选项取自握手 `decision.options`、附自由输入）；越界决策含「放宽可写范围」选项
- [x] 8.2 自愈路由：门失败（`engine.ts:690` isAiNode 分支）/ 产出缺失 / 越界 / 握手 need-decision → 续接该 agent 注入详情、限次（复用重试计数）
- [x] 8.3 `engine.ts:decide()`：对 `sourceKind='agent'` 决策把选中项/自由文本经续接注入原 agent 续跑（新分支，不走既有 git 参数分支）
- [x] 8.4 超限升级：自愈达上限抛 `sourceKind='agent'` 决策落单卡；测试覆盖限次→升级→答复续接注入闭环

### 9. 崩溃恢复续接（单仓，先红后绿）

- [x] 9.1 `resumeAll`/`resume`：识别处于 `running`/`executing` 的 agent 节点，走续接阶梯（优先原生 resume）而非从头新拉
- [x] 9.2 测试：agent 节点执行中「关闭」后恢复→走续接、起始 SHA 沿用、自存记录非空可重建

### ★ 里程碑 A：claude + 单仓端到端撞真 CLI

- [x] A.1 `npm run typecheck` + `test:run` 全绿（截至阶段 A 的全部先红后绿测试）
- [x] A.2 dogfood 单仓验收（真 claude，`npm start`）：建卡 → 激活含 1 个 agent 节点的单仓工作流 → 运行 → 紫点亮、claude 在 worktree 真改文件 → 制造一次客观门失败看 agent 自愈回喂 → 过门到完成
- [x] A.3 **验证最险假设并记录**：claude 无头模式是否会「停下来写握手 need-decision 并退出」？resume `--continue` 是否接对会话？据结果决定：主动提问路径保留/弱化（更靠门+自愈），resume 是否改抓显式 session id。必要时回调阶段 A 相关任务再验收

## 阶段 B ── 铺开：codex/cursor + 多仓一个 agent 跨仓

### 10. codex / cursor adapter（先红后绿）

- [x] 10.1 codex adapter：`codex exec` + `-m` + `--sandbox workspace-write --ask-for-approval never` + `--json`；resume `codex exec resume --last`（沿用阶段 A 敲定的 session 策略）
- [x] 10.2 cursor adapter：`cursor-agent -p` + `--model` + `--force --trust` + `--output-format json`；resume `--continue`
- [x] 10.3 三家 adapter 契约测试对齐（start/resume/supportsResume/流式/退出码/技术失败归宿一致）

### 11. 多仓一个 agent 跨仓（先红后绿）

- [x] 11.1 adapter 多目录：`start`/`resume` 落实 `extraDirs`——claude `--add-dir`、codex/cursor 等价多目录 flag
- [x] 11.2 `engine.ts`：agent 节点解析目标仓子集后，主目标仓作 cwd、其余作 `extraDirs` 交给**一个** agent；握手落主目标仓
- [x] 11.3 逐仓越界检测/提交：改动由一个跨仓 agent 造成，越界检测/还原/提交/记 SHA 仍**按每个目标仓各自成立**
- [x] 11.4 测试：一个 agent 跨 web/api 工作（extraDirs 带上 api）、两仓各自越界检测与提交、多仓门失败续接同一个 agent

### 12. {repos} 填充 + fromUpstream 运行时收窄（先红后绿）

- [x] 12.1 `{repos}` 填充：agent `done` 时从握手 `repos` 填 `upstreamOutputs[nodeId].repos`（与卡 repos 取交、持久化）
- [x] 12.2 `fromUpstream` 运行时收窄：下游解析目标仓取 `upstreamOutputs[上游].repos ∩ 卡 repos`；上游未产出 repos → 可见等待决策（不静默全集）
- [x] 12.3 测试：上游 agent 判定 [api] → 下游 fromUpstream 只作用 api；上游缺 repos → 下游落等待决策

## 阶段 C ── 全量验收与归档

- [x] C.1 `npm run typecheck`（tsconfig.node + tsconfig.web）全绿
- [x] C.2 `npm run test:run` 全绿（全部先红后绿的公共 API 测试）
- [x] C.3 dogfood 全量验收（真三家 + 多仓）：多仓卡 → 含 agent 节点工作流 → 一个 agent 跨仓真改文件 → 制造客观门失败看自愈 → 过门到完成
- [x] C.4 dogfood 工作流实例更新（`userData/workflows/*/workflow.yaml`）：含 agent 节点 + 一道会失败的客观门用于演示自愈
- [x] C.5 `/opsx:archive` 同步增量 spec 到主 specs
