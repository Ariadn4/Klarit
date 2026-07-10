## Context

三层 agent 里全局（编排）与后台执行已归档；单需求 agent 只切过一薄片——gate-reject（`2026-07-09-gate-reject-content-rollback`）里的**只读回退判定 agent**（一次性吐决策、无对话/常驻）。全局编排（`2026-07-11-global-agent-orchestration`）明确「别处上抛的接线不在本 change」。本 change 把薄片长成完整咨询层并补上抛接线。

底子几乎全现成，B4 主要是**接线**：

- **只读 agent 拉起**：`prepareHealAgentForRun`（`src/main/index.ts:245`）已支持 `kind:'rollback-judge'` → `assembleAgentPrompt({readOnly:true})`（省略可写范围/产出段），引擎对只读 agent 跳过 scopeGuard/每节点提交（`engine.ts` runRollbackJudge）。
- **回退重入 + 向 K 注入**：`reenterFromRollback`（`engine.ts:1289`）拨回 K、重锚 K..N 基线、`forwardFix` 注入「修复前向」、`drive` 前向重流；`ensure-*` 幂等复用分支/worktree。目前只经 `decide` 的 `:rollback-confirm` 分支可达。
- **产物溯源 + 断点**：`deriveLineage`/`renderLineage`（`engine/lineage.ts`）、`getRunState` 断点（currentNode/phase/furthestNodeId/门进度）。
- **编排上抛**：`orchestrate(intent, projectId)`（`orchestrate-service.ts`）+ `applyOps`（`apply-ops.ts`）+ ops 审阅组件；`orchestrate-producer.ts` 已示范「脱 worktree、只读、续接」驱动一个 agent 并解析结构化输出。
- **会话持久化**：`conversation-store.ts`（append/truncate/setSessionId/setAgentModel + `launchContinuation` 续接阶梯，双后端注入式）。
- **decide 自由输入路由**：`engine.ts:1607` decide——manual-gate+freeText → runRollbackJudge；其它 engine+freeText → runDispositionAgent。
- **卡详情面板**：`requirement-card-detail` 已有单卡决策区、命令输出分桶回看。

约束：测试先行（假只读单卡 agent 注入三岔输出、假 orchestrate 返提案，同既有假 adapter 模式，不依赖真 CLI）；只读绝不亲自执行；干预/编排经中转；破坏性须人确认；UI 遵 `docs/brand` 语义令牌、深浅双主题。

## Goals / Non-Goals

**Goals:**
- 每卡一个常驻只读单需求 agent（不可多开、scope 单卡），自由对话·技能内联，一轮**三岔输出**（reply / interventions / upshift）。
- ① 查进度：装配「活现状 + 运行断点 + 产物溯源 + 各仓分支 diff」的只读上下文作答。
- ② 本卡干预（agent 提议、引擎/store 执行、破坏性须确认）：暂停/恢复（直接）、倒回 K（可带注入）、就地注入当前节点、（可选）改卡字段。
- ③ 讨论上抛：塑造需求 → 转调 `orchestrate` → ops 提案在卡对话内审阅 `applyOps`。
- ④ 门自由输入上抛接线：门/失败决策自由输入先经单卡分类，塑造需求引流 orchestrate（不消费门），其余原样直下。
- 复用 `reenterFromRollback` 提为用户可发起的 `engine.reenter`；新增 `engine.inject`；干预活跑运行先安全挂起。
- 每卡会话复用 conversation-store（新桶、id=cardId）；卡详情面板咨询区复用全局对话/决策面板组件。
- 测试先行、typecheck + test:run 全绿、dogfood 全链路可验收。

**Non-Goals:**
- AI 托管（自动代替决策/自动应用 ops）。
- 全局 agent 干预运行中后台 agent（另一块能力）；subworkflow；重模型回退。
- 单卡 agent 读代码做深度分析（读上下文 = 活现状+断点+溯源+分支 diff）。
- 「重置到节点起始态、下游作废重生」的重回退模型（沿用重入不重置）。
- 单卡 agent 自行产卡操作或裁决落卡（无全盘视野 → 一律上抛全局）。

## Decisions

### D1：单卡 agent = 只读咨询核·技能内联，一轮三岔输出

**选择**：镜像全局 agent 的「单 agent 会话核·技能内联」（global-agent 决策 10）。一次 agent 调用/轮，prompt 内联「查进度 / 本卡干预 / 上抛塑造需求」三类技能，输出解析为判别联合 `{reply} | {reply, interventions[]} | {reply, upshift{intent}}`。纯咨询是有效轮次（不算失败、不留占位）。

**理由**：与全局一致的心智与解析形态；1 调用/轮延迟低；技能内联保「各动作格式单一来源」。单卡 agent **产不了卡操作**（无全盘视野、ops 需全项目校验）——塑造需求只发 `upshift` 信号，由系统转调 `orchestrate`。

**替代**：调度器 + 独立技能 agent（动作时多次调用、复杂）——留后续。

### D2：读上下文 = 活现状 + 断点 + 溯源 + 分支 diff，预算截断

**选择**：装配限本卡的只读上下文：卡活现状（复用 `prepareHealAgentForRun` 的 card 块）+ `getRunState` 断点（当前节点/阶段/`furthestNodeId`/产出/门进度）+ `renderLineage(deriveLineage(...))` + 各涉及成员仓 `git diff <base>..<branch>` 概要。预算截断（diff 优先截），显式标「省略 N…」（同 board-context no-silent-caps）。

**理由**：这正是「查进度」要的四件事，且全部现成可派生。分支 diff 最重 → 最先截。

**权衡**：diff 现算有开销，但只在咨询轮跑、可接受（同 deriveLineage 的取舍）。

### D3：干预动词 → 引擎方法映射；agent 只提议

**选择**：
| 动词 | 落点 | 确认 |
|---|---|---|
| 暂停/恢复 | `engine.pause`/`resume`（已有） | 直接 |
| 倒回 K（可带注入） | **新 `engine.reenter(runId,K,指令)`** 包 `reenterFromRollback` | 破坏性·确认 |
| 就地注入当前节点 | **新 `engine.inject(runId,指令)`** 设当前节点 pendingAnswer + 重跑 executing | 确认 |
| 改卡字段 | `cardsUpdate`（已有） | 轻确认 |

agent 只产 `interventions[]`（自描述、节点以 id 引用），渲染层确认后调对应 IPC。**倒回与就地注入分设两方法**（用户选择）——`reenter` 覆盖「倒回到更早节点前向修复」，`inject` 覆盖「不倒回、只给当前正在跑的节点补一句」；语义不同、心智清晰。

**理由**：`reenterFromRollback` 已实现「重入不重置」全部语义，`reenter` 只是把它提为用户可发起入口（原仅 `:rollback-confirm` 可达）；`inject` 复用 `pendingAnswer`+续接 delta 机制。agent 只提议、引擎执行 = 恪守「只读、不亲自执行」红线。

**替代**：只做 `reenter`（把「就地注入」当 `reenter(当前节点)`）——语义含糊（会重锚基线、当作回退），弃。

### D4：干预活跑运行先安全挂起再改断点

**选择**：`reenter`/`inject` 若作用于**正在 drive** 的运行，先复用 `pause` 的阶段边界机制（abort 前台/后台活进程、保留可重启记录与续接 token、落 `paused`），再重锚基线/设注入、再 `drive`；已 parked/paused 则直接改。

**理由**：断点是驱动循环的共享可变态，活跑时直接改会与 drive 竞态。pause 已能安全落边界（消除「pause 写副本被 drive 覆盖」竞态），干预串在其后即安全。

**权衡**：干预有一次「等到阶段边界」的延迟——但这正是「安全挂起」的语义，可接受。

### D5：每卡会话复用 conversation-store，id=cardId、独立存储桶

**选择**：复用 `conversation-store`，**另起一个 baseDir 桶** `userData/card-conversations`（与全局对话 `userData/conversations` 物理隔离）；scope=projectId、**会话 id 恒 = cardId**。打开某卡永远 `get(projectId, cardId)`（不存在则 `create`），无「新建会话」。

**理由**：一行新持久化代码不写就得到「一卡一个、不可多开」（id 固定）+「不污染全局对话列表」（独立桶）+ 续接/选型/编辑重试全复用。契合 project-goals「暂停即安全挂起：存活现状+会话历史」。

**替代**：同桶不同 id 前缀（`card:<id>`）——全局对话 `list(projectId)` 会扫到卡会话，需额外过滤，弃。新建独立会话库——重复 conversation-store 逻辑，弃。

### D6：塑造需求上抛 = 单卡分类 + 全局编排两次调用

**选择**（用户选定「接受 2 次」）：单卡 agent 只读只分类，判为塑造需求 → 发 `upshift{intent}` → 主进程转调 `orchestrate(intent, projectId)`（跑**全局** agent、带 board 上下文）出 ops 提案 → 提案作为 agent 消息的 `proposal` 落卡对话（同全局对话消息形态）→ 复用 `applyOps` 审阅确认。歧义倾向上抛。

**理由**：层级诚实——单卡只读只看一卡一支，绝不越权编排；全局才有全盘视野裁决落哪张卡（「其实属本卡/该新建」）。上抛轮 = 2 次调用（非上抛轮仍 1 次）。

**替代**：单卡直接把原话塞 orchestrate（省一次）——单卡「先用本卡上下文判一次」的意义弱化、易误上抛闲聊，弃。

### D7：门自由输入分类前置，塑造需求引流、不消费门；偏置与卡对话相反

**选择**（用户选定「先分类再分派」）：在既有 decide 自由输入路由前加一道**单卡 agent 分类**。判为塑造需求 → 上抛 `orchestrate`、ops 提案交审阅、**MUST NOT 消费该决策**（门/失败决策仍 pending，用户随后另行 pass/驳回/处置）；判为非塑造需求 → **原样直下**既有路径（manual-gate → runRollbackJudge；失败 → runDispositionAgent）。**偏置反置**：卡对话里歧义→上抛；**门语境歧义→留在本地（当驳回/处置）**，只有明确塑造需求才引流。

**实现落点**：分类作为一道**不消费决策的旁路**——沿用「门动作按钮不推进运行」的既有正交模式（`requirement-card-detail`）：新增一条「问 agent / 上抛」旁路 IPC，跑分类，塑造需求则 orchestrate，**不调 `decide`**（故不清 pendingDecision、不推进）。真驳回/处置仍走原 `decide(text)` → 既有路由，字节不动。

**理由**：把「不消费门」做成独立旁路，而非塞进 `decide` 内造「不消费」分支，**既有回退判定/处置这条紧闭环零改、零回归**；只新增「引流塑造需求」这一小撮。门语境反偏置避免含糊驳回意见被误当新需求打乱回退。

**替代**：分类塞进 `decide()` 内、塑造需求时 re-raise 同一 pendingDecision——改动热路径、易回归回退判定，弃。

### D8：只读注入式 producer，复用脱 worktree 续接 runner

**选择**：单卡 agent 的 producer 复用 `orchestrate-producer.ts` 的形态——脱 worktree、只读姿态、流式续接 runner（`agent/runner.ts`+`continuation.ts`），把回复解析为三岔输出。注入式：测试用假 producer 返固定三岔（不触真 CLI）。未配置/失败/不可解析 → 优雅降级为「只回复+可读提示」。

**理由**：与 orchestrate-producer 同源（流式展示 + session 捕获 + `--resume` 续接），单一来源「怎么只读地多轮驱动一个 agent」；假注入满足测试先行。

## Risks / Trade-offs

- **只读无法 OS 强制** → readOnly prompt + 收窄工具 + 不消费文件写 + 引擎跳过 scopeGuard/提交（同回退判定 agent）；测试用假 producer 不涉真写。
- **干预活跑运行竞态** → D4 先安全挂起再改断点；复用 pause 的边界落 paused，不硬杀中途。
- **门分类回归既有回退/处置** → D7 把分类做成不消费决策的旁路、既有 `decide` 路由零改；门语境反偏置（歧义留本地）+ 先测试锁定「明确驳回仍走回退判定」。
- **上抛 2 次调用延迟** → 只在塑造需求轮翻倍；纯咨询/干预轮仍 1 次；可接受（换层级诚实）。
- **单卡 agent 挑错节点/引用不存在节点** → 干预 op 目标节点 id 须在本卡节点集内，否则拒绝给可读原因；破坏性干预人确认这一步兜底。
- **分支 diff token 爆** → 确定性截断（diff 优先截）+ 显式标「省略 N…」。
- **会话与看板刷新** → 卡会话（card-conversations 桶）与 card store 独立；applyOps 后统一刷看板。

## Migration Plan

1. **共享层**：加单卡 agent 三岔输出类型（reply/interventions/upshift）+ 干预 op 联合 + 只读咨询 prompt 契约（技能内联）+ 读上下文装配纯函数骨架（先测试）。
2. **engine**：`reenter`/`inject` 提为公开方法（`reenter` 复用 `reenterFromRollback`，加节点校验；`inject` 设当前节点 pendingAnswer+重跑）+ 干预前安全挂起（复用 pause 边界）——先测试（假 runner/内存 store）。
3. **咨询核**：单卡 agent 咨询服务（读上下文装配 + 注入式只读 producer + 三岔解析 + 干预映射 + upshift→orchestrate 接线），假 producer 先测试；真 producer 接脱 worktree 只读续接 runner。
4. **会话**：card-conversations 桶 + id=cardId 打开/续接（复用 conversation-store，先测试）。
5. **门上抛**：分类旁路 IPC（不消费决策）+ 塑造需求→orchestrate；回归测试守「明确驳回仍走 runRollbackJudge、失败仍走 disposition」。
6. **IPC/preload**：单卡对话（每卡会话 CRUD/发消息/续接、干预应用）、`engineReenter`/`engineInject`、门分类旁路。
7. **渲染层**：卡详情面板咨询区（对话 + 查进度 + 干预确认 + ops 提案审阅），复用全局对话/决策面板组件；语义令牌、深浅双主题、i18n。
8. `npm run typecheck` + `test:run` 全绿；dogfood（`npm start` 不监听源码）验收：跑到一半的卡开对话 →① 问进度得答复；② 倒回节点 K 并注入→确认→引擎回退+K 重做；③「还要加个需求 X」→上抛→orchestrate 建卡提案→applyOps→看板新卡。

**回滚**：咨询核/会话桶/咨询区均为新增；`reenter`/`inject` 为新公开方法（`reenterFromRollback` 内部实现不变）；门分类为旁路（关掉即回既有行为）。

## Open Questions

- 只读工具收窄的具体 `--allowedTools`（各 adapter 差异）——真 producer 落地期撞真 CLI 校准，先以「不消费文件写」兜底（同 orchestrate-producer）。
- 分支 diff 概要的粒度（`--name-only` 文件清单 vs 带 hunk 摘要）——先 name-only + 预算，dogfood 观感后调。
- 咨询区在卡详情面板的具体版式（对话区与决策区上下并列 vs 标签切换）——UI 实现期定，不影响能力契约。
- 「改卡字段」干预是否本 change 落地（Non-blocking 可选项）——先留接口，视 dogfood 优先级定。
