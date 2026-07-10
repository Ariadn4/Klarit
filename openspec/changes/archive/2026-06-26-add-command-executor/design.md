## Context

脊柱(`add-engine-execution-spine`)已落地:阶段状态机(`executing → gate k → done`)、按 runId 持久化的断点、8 个幂等 ensure 的 git 执行器、失败四归宿 + 统一前进式决策(i18n key、人工门复用、接 agent 的 `sourceKind` 口子)、一次性触发的 IPC + 开机自动恢复。但运行循环里只有 `engine` 节点真跑:`engine.ts` 的 `runExecuting` 对 `agent`/`command`/`subworkflow` 发「未落地」事件并直跳 `done`;`evalAutoGate` 是恒 `true` 的桩;人工门只抛 `通过` 决策、动作按钮无处执行。

脊柱**决策 2** 明说:引擎(git)操作亚秒完成、跑到底、不被打断,故异步运行器 `(args)=>Promise` 不带 signal、`pause` 只在阶段边界置标志;但同处预留——「将来 agent 节点的 executing **可**被中途打断(杀 PTY),阶段模型不变,只是『executing 能否被打断』按执行器类型走」。`command` 是兑现这条预留的**第一个**执行者:测试/构建可能跑几分钟,暂停/取消一个在跑的命令是真需求。

两条现状约束塑造本设计:① 需求卡模型仍未落地,运行按 runId 独立(沿用脊柱);② 现有 `start()` 直接 `return drive(bp)`(把整个运行 await 完),`pause()` 从 store `load` 出**另一个** `RunBreakpoint` 副本置 `paused` 再 `save`——这在 git 秒级下「够用」,但与 `drive` 持有的内存 `bp` 是两个对象,长命令下 `drive` 跑完会用自己的 `bp` 覆盖回 `running`(竞态),且 `await startRun` 会挂住渲染层数分钟、关窗即孤儿。`command` 逼这两处一并修对。

## Goals / Non-Goals

**Goals:**
- 可取消的 shell 命令运行器:`spawn` + shell 跑任意命令、流式 stdout/stderr、退出码、取消即**杀整棵进程树**;纯函数式、结构化结果、可独立测。
- `command` 节点真跑:在节点 worktree 执行、async/可取消/可恢复,复用阶段状态机与决策回路。
- **重跑护栏 = 可选前置检查命令**(reconcile-by-probe):有则探现状、已完成跳过;无则默认重跑。中断恢复直接重跑即安全,**零用户判断**。
- 客观门真跑:`inline` 裸命令 + `ref` 引用规则库 `objective-check`,退出码即过/不过,失败走前进式门决策。
- 人工门动作按钮可执行:经新 IPC 在 worktree 跑命令、流式回显、可停;不混进前进式选项。
- 运行模型补强:非阻塞 `start/resume/decide`、内存活运行登记、`pause` 真杀子进程并在边界落 `paused`(修竞态)。
- 流式 `op-chunk` 进度事件,三处共用。

**Non-Goals:**
- 不实现 PTY / `agent` / `subworkflow`(仍跳过,留后续 change)。
- 不强制 command 的 `writableScope`(对任意命令做 diff-revert 属 agent 越界自愈,future);不校验 outputs 齐全(基线门 future)。
- 不绑需求卡(运行按 runId);不改 `workflow.yaml` 既有结构(只增可选 `check`)。
- 不做命令的「后置成功校验」(只做前置探测,匹配「前置检查」语义);不自动判别命令幂等性(无法可靠探测,故护栏为软提示而非强制)。
- 不本地化用户自定义文案(动作按钮 label、命令串本身是用户数据)。

## Decisions

### 决策 1:可取消命令运行器——`spawn` + shell + 流式 + 进程树 kill,新建独立模块

新建 `src/main/command-run.ts`,与 `git-write.ts` 并列。签名:

```
runCommand(command: string, opts: {
  cwd: string
  signal?: AbortSignal
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void
}): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }>
```

- **走 shell**:命令是任意 CLI 串(`npm test`、`npm run build`),必须由 shell 解析。沿用 `agent-runner.ts` 既有模式 `spawn(command, { shell: true, cwd })`(Windows 用 `cmd`,POSIX 用 `sh`)。
- **流式而非 buffered**:用 `spawn`(`stdout/stderr` 的 `data` 事件)而非 `execFile`(一次性回调),边收边 `onChunk` 推增量、同时累积全量供终态摘要;`close` 拿退出码。这是「长命令也能实时看输出」「`npm start` 这种永不退出也能回显」的前提。
- **取消即杀进程树**:`shell:true` 下杀父 shell 会在 Windows 留下孙子(node)进程。`signal.abort()` 时:Windows 走 `taskkill /pid <pid> /T /F`(`/T` 连子孙),POSIX 用 `spawn(..., { detached: true })` 建进程组、`process.kill(-pid, 'SIGTERM')`(超时升 `SIGKILL`)杀整组。**内联实现,不引第三方依赖**(`tree-kill` 等)——逻辑仅十余行、与既有 spawn 风格一致、避免供应链面。
- **永不抛**:与 `makeAsyncGitRunner` 一致,失败以非零 `code` 表达;`killed` 标记被取消(供上层区分「真失败」与「被打断」)。

**取舍**:`execFile`+`{signal}` 更简单但无法流式、且 `shell:true` 下取消同样漏杀子孙;故用 `spawn` + 显式树 kill。引 `tree-kill` 省跨平台细节,但多一个运行期依赖、收益不抵——内联即可。

### 决策 2:重跑护栏 = 可选前置检查命令(把 command 变成可探测的 ensure)

引擎对 git 一直是 reconcile-by-probe(「分支建好了吗?→ 建好跳过」),这让恢复近乎免费。`command` 破坏了这点——任意命令引擎探不了状态。**把探测权交给作者**:`command` 执行者加可选 `check`:

```
{ kind: 'command'; command: string; check?: string }

执行 command 节点的 executing:
  有 check → 跑 check;退出 0(已完成)→ no-op 跳过(不重复执行)
                       非零(未完成)→ 才跑 command
  无 check → 直接跑 command(默认重跑)
```

这正是 `ensure-*` 的形状:**「确保 (check 通过),靠跑 (command)」**。中断恢复时 `drive` 照常重跑 `executing`——有 `check` 的命令(部署/迁移)因探测而幂等收敛、不重复;无 `check` 的(测试/构建)重跑本就无害。**因此本设计不需要新断点字段、不需要「重跑还是跳过」的人工决策**(脊柱「重跑当前阶段永远安全」对 command 也成立)。

软件无法可靠判别命令幂不幂等,故护栏**不强制**,只在编辑器命令输入处软提示(见决策 8)。

**取舍**:① 中断后弹「重跑/跳过」问用户——被否,用户判断不了「上次部署成功没」,且若我们能判断就该自己处理;② per-node `rerunSafe` 布尔——被否,部署可能成功也可能没成功,统一重跑/不重跑都不对;③ 前置检查命令——选中:把「现状」量化成一条退出码,引擎据实自动收敛,与既有 ensure 哲学同构。

### 决策 3:运行非阻塞化 + 内存活运行登记 + `pause` 真杀子进程(修脊柱竞态)

`command` 使「一次运行可跑数分钟」成真,逼现脊柱两处将就:

**触发与「等结果」分离**:`start/resume/decide` 触发后台驱动,但同时给出一个**到停点即 resolve 的 awaitable**,让「不想等」(IPC/渲染层)与「想要结果」(测试/任何同步调用方)各取所需:

```
引擎内存态(非持久):
  active: Map<runId, { abort: AbortController; paused: boolean }>

start(req):  → { runId, settled: Promise<RunBreakpoint> }
resume / decide(runId, ...): → { runId, settled: Promise<RunBreakpoint> }
  落初始/更新断点 → persist → 后台 drive(bp);settled 在运行 park 时 resolve
  settled 的 resolve 条件 = 运行进入停点:done / waiting-decision / paused / aborted

IPC 层(main/index.ts):
  const { runId } = engine.start(req); return engine.getRunState(runId)  // 只回当前断点,绝不 await settled
  (长命令运行不挂渲染层、关窗不产生孤儿调用;渲染层后续靠 onEngineProgress 事件刷新)

测试 / 想要结果的调用方:
  const { settled } = engine.start(req); const bp = await settled        // 等到下一个停点

pause(runId):
  active.get(runId) → 置 paused=true + abort.abort()  // 真杀在跑的子进程
  无活运行(已在边界)→ 直接落 paused

drive 循环:
  每个阶段边界 check active[runId].paused → 落断点 + state='paused' + 退出循环(park → settled resolve)
  runExecuting 把 active[runId].abort.signal 透传给 runCommand
  命令被 kill 返回 { killed:true } 且 paused → 不抛决策,phase 维持 executing,state=paused
```

`drive` 持有唯一权威 `bp`;`pause` 不再 `load` 出第二副本去和它打架,而是发信号让 `drive` 自己在边界落盘——**消除覆盖竞态**。`settled` 在每次进 park 时 resolve(下一次 `resume`/`decide` 重新给出新的 `settled`)。`resume` 重新进入 `drive`,有 `check` 的命令探测后收敛、无 `check` 的重跑。

**取舍**:① 让 `drive` 仍 await、`pause` 仍写副本——git 秒级掩盖得了,command 分钟级必翻车(覆盖 + 孤儿),故必须改;② `start` 只回 `runId`、想要结果的轮询 `getRunState`——测试写起来噪声大且竞态(轮询时机),不如 `settled` 一个 Promise 干净;③ `start` 返回 `{runId, settled}`——选中:`settled` 不跨 IPC(Promise 不可序列化),IPC 只取 `runId`、渲染层走事件,测试 `await settled`,三方解耦。引入内存态打破「纯断点恢复」的纯粹性,但内存态只承载**进行中**的取消句柄(进程不在了自然没有「在跑的命令」可杀),崩溃/重启后无活进程、`resumeAll` 重新 `drive` 即可,持久化语义不变。

### 决策 4:command 非零退出 → 人工前进式兜底决策(不自动重试)

非零退出 = 技术性失败(测试没过/构建炸)。脊柱四归宿里它属**归宿 3「交给 agent 自愈」**(future,无 agent)。无 agent 时落**人工前进式兜底**:`commandFailed` 决策,选项 `{ 重试 / 跳过本节点 }`,`raw` 带命令 + 退出码 + 末段输出供 dogfood 排查。

- **绝不自动重试**:非零退出**不是** transient(`locked`)——重试一个失败的测试无意义。只有运行器**拉起失败**(命令不存在等)才可能短重试,但默认也按失败决策处理,不混进瞬时重试。
- `sourceKind` 仍 `engine`;agent 落地后这条**天然升级**成 agent 自愈路由(`source` 不变、`sourceKind→agent`、派生自填),口子已在脊柱留好。
- **被 kill ≠ 失败**:`killed` 为真不进此路(见决策 3)。

### 决策 5:客观门(auto-gate)从桩接成真跑——结构化返回 + inline/ref 双解析

`evalAutoGate` 从 `async () => true` 改为真跑门命令,返回**结构化** `{ pass, code, output }` 而非 `bool`(引擎据此富化决策与发 `op-chunk`):

```
gate.check.kind === 'inline' → 直接跑 check.command
gate.check.kind === 'ref'    → 解析规则库 objective-check 条目得命令再跑
cwd = worktreePath(回落 repoPath);走可取消 runner(测试门也能几分钟、可 pause)
code === 0 → pass → 过本道门
code !== 0 → buildAutoGateDecision(富化 { command, code } + raw 输出)→ retry / skip-gate(已存在)
```

`ref` 解析复用 `previewAgentNodePrompt` 已有的规则库解析先例,引擎运行期注入 `rulePacks` 解析依赖(`getObjectiveCheckCommand(ref) => string | null`);引用条目在本机缺失时按缺失上报(发 `skip` 或失败决策),不崩。

**取舍**:只做 inline、ref 留后续——被否(用户要两种都做);代价是引擎运行期引入规则库依赖,但解析逻辑已存在、注入即可,测试面可控。

### 决策 6:人工门动作按钮——独立 IPC,不混进前进式选项

动作按钮(`gate.actions: [{label, command}]`)点击是「跑命令看输出、**但不推进运行**」,与「选项一律前进式」是正交的两件事——塞进 `options` 会破坏铁律。故:

```
manual gate 决策携带:actions: [{ label, index }]  // 命令留主进程,UI 按 index 触发
新 IPC:runGateAction(runId, actionIndex): Promise<{ code: number }>
  → 取当前节点该 manual gate 的第 index 个 action.command
  → 在 worktree 跑、流式 op-chunk 回显、可停(复用决策 1/3 的 kill,登记到 active 的独立动作句柄)
```

典型「启动 app」=`npm start` 永不退出 → 必须流式回显 + 可停(动作命令独立于运行主循环,有自己的 abort 句柄;pause 运行不杀动作,反之亦然,各自停)。`EngineDecision` 加可选 `actions?` 字段承载(仅 manual gate 给),向后兼容。

**取舍**:把 action 做成 `multi` 选项或带 `isAction` 标的 option——污染前进式语义、UI 要特判,不如独立 IPC 干净。

### 决策 7:流式输出 = 新增 `op-chunk` 进度事件,三处共用

`EngineProgressEvent` 加:`{ kind: 'op-chunk'; runId; nodeId; stream: 'stdout'|'stderr'; chunk: string }`。命令节点 / 客观门 / 动作按钮的 `runCommand.onChunk` 都发它;`op-output` 退化为**终态摘要**(`{ outcome, code, detail }`)。渲染层(dogfood 卡)累积 `op-chunk` 实时回显、`op-output` 收尾。

**取舍**:把全量塞进一次性 `op-output.detail`——`npm start` 永不退出就永远收不到、长测试看不到进度;故必须流式。

### 决策 8:编辑器软提示——引导加前置检查,不强制、不暗示部署

工作流编辑器 `command` 节点设置块加「前置检查命令」输入 + 软提示:

> 如果这条是非幂等命令(跑一次生效后,重跑会重复或产生副作用,比如数据库迁移、版本号自增、发送通知等),建议在前方新增一条「前置检查命令」,这样中断恢复时不会重复执行。

**例子刻意避开部署/发布**——那类方向上做成引擎操作(一等公民),拿它们当例子会反向暗示用户「部署该写成命令」。文案进 zh/en 同键。

### 决策 9:能力/约束按 command 是「执行者 kind」定位

`command` 是执行者 kind、不是 engine operation,`engineOpCapabilities` 不适用(那是 engine-op 元数据)。command 节点的 outputs/writableScope/gate 是**节点级**字段、对所有 kind 本就开放,无需新能力表。cwd 统一 `worktreePath`(回落 repoPath),对齐 project-goals「活在 worktree」。

### 决策 10:超时是**每条命令**的可选属性,全局默认无超时

超时不绑在节点上,而是绑在**每一条被执行的命令**上——一个命令节点里至少有三类独立命令,各自可设或不设时限:

```
命令节点主命令   timeoutSec?   例:30 秒
同节点客观门     timeoutSec?   例:20 秒(或留空=不限)
门把动作命令     timeoutSec?   例:留空(npm start 长驻,本就不该超时)
```

字段落点(均可选、缺省=无超时,**全局默认即无超时**):
- `command` 执行者:`timeoutSec?`(管主命令;前置 `check` 通常是秒级探测,v1 不单设其超时)。
- 客观门把(`{ kind:'auto', check, targets?, timeoutSec? }`):`timeoutSec?` 落在门项上,`inline`/`ref` 一视同仁(`ref` 的时限在**使用点**而非规则库条目里——同一条检查在不同工作流可有不同时限)。
- 门把动作(`GateAction`):`timeoutSec?`。

**超时语义**:到点即**杀整棵进程树**(复用决策 1 的取消),算作失败(非用户主动暂停,故 `killed` 但**抛决策**而非落 `paused`):命令节点 → 前进式「命令超时」决策 `{重试 / 跳过本节点}`;客观门 → 「检查超时」前进式决策 `{重试 / 跳过此检查}`(标题与普通不通过区分);动作命令 → 仅终止并在输出回显「已超时」,不抛运行级决策(动作本就在主循环之外)。校验:`timeoutSec` 若声明 MUST 为正数。

**取舍**:① 全局超时——被否,会误杀 `npm start` 等合法长驻;② 节点级单一超时——不够,同节点主命令与客观门常需不同上限;③ 每条命令可选超时——选中,粒度对齐用户心智、`npm start` 留空即不超时、无人值守时仍有逐命令安全网。`check` 不单设超时是有意收敛(秒级探测、避免字段爆炸),需要再补属后续。

### 决策 11:命令节点常驻「进入下一节点 / 中止并进入下一节点」+ 后台化

command 节点是「跑到退出」的执行者,但长驻命令(起服务、起 app)不会自己退出。除自动归宿(退 0 推进 / 非零失败决策 / 超时决策)外,command 节点在 `executing` 进行中 SHALL 常驻两个**手动控件**:

```
进入下一节点(转后台)   不杀命令、把它移入「后台命令」登记,运行直接推进到下一节点(跳过本节点剩余门把)
中止并进入下一节点      杀掉命令(进程树)后推进到下一节点(跳过门把)
```

两者都「进下一节点」=**跳过本节点剩余门把**(用户要越过整个节点)。后台化的命令**继续流式输出**(op-chunk 照旧)。后台命令以**可重启记录**(命令+节点+标识)**持久化进断点** `RunBreakpoint.background`,内存里另持活进程杀句柄。生命周期:**用户中止/运行终局** → 杀进程 + 清记录;**暂停** → 杀进程但**留记录**、**恢复**按记录**重新拉起**(暂停=一切静止、恢复=后台也回来);**app 退出**(=关软件自动暂停)→ 杀进程留记录、重开按记录恢复(对齐「重开自动恢复」)。卡上据 `bp.background` 列「后台命令」可查看输出 + 中止。**超时跟随到后台**:节点若声明了超时,转后台后超时仍生效(记录带 `timeoutSec`,后台按它重新计时,到点杀进程+摘记录,旁路不抛决策)——作者设的"最长别超过 X"不被转后台绕过。**为何暂停杀后台而非冻结**:跨平台无干净的进程冻结,故「静止」=杀、「恢复」=按记录重启(服务重启即可);无法对任意进程断点续传。**为何持久记录**:否则恢复/决策/重开重建活运行态时后台句柄丢失成孤儿、且无从重启。

实现:`runCommand` 增 `onStart(handle:{kill})` 暴露杀句柄;引擎 `execCmd` 用 `Promise.race(runP, detachDeferred)`——detach 触发即把杀句柄移入 `background`、提前 resolve(**不**走 abort、不杀),`runP` 继续在后台跑(流式不断,最终 resolve 被忽略)。abort-advance 走 abort 杀掉。三种打断用 `active` 上的标志区分:`paused`(→paused)/`advance:'abort'`(杀+推进)/`advance:'detach'`(转后台+推进)。新 IPC:`advanceCommand(runId,{mode})`、`listBackground(runId)`、`stopBackground(runId,bgId)`。

**取舍**:① 把长驻服务只塞进人工门动作按钮——不够(命令节点本身常需「起了就走」);② 引入「后台/sidecar 服务」完整生命周期(就绪探测、跨节点依赖、自动收尾)——过重,留后续;③ 每个命令节点常驻两控件 + 简单后台登记——选中:轻、直给用户掌控,卡上留查看/中止入口。

### 决策 12:客观门失败——按「原因 + 节点类型」分流,且给用户**可读原因**(检查输出)

客观门未过的处理对齐失败四归宿,按**失败原因**与**当前节点执行者类型**分流:

```
门报错(非零退出):
  节点是 engine / command → 直接交用户          // 确定性工作,重跑无益(无 AI 改它);属四归宿「人工拍板」
  节点是 agent / subworkflow → 重跑整个节点(≤3 次)再交用户  // 技术性失败交 agent 自愈的占位
                                                  // (本 change 这两类执行被跳过、门暂触发不到,为未来留口)
门超时:
  一律自动只重跑客观门(≤3 次)再交用户          // 超时多为抖动/慢,重跑可能就过;属四归宿「自动处理」
```

自动重跑的计数与历史按「这张卡在这道门」累计、**持久化进断点** `gateLog: Record<'<nodeId>:<gateIndex>', GateAttempt[]>`(关重开不丢、满 3 仍准),门通过即清零。`MAX_GATE_RETRY = 3`。

**给用户可读原因**:决策不再向用户显示**退出码**(像 git 英文 stderr 一样属开发噪音,vibe coder 无从理解,只进 `raw`)。改为把**检查命令自己的输出**(它打印的失败详情,如「哪条测试没过」)放进决策的 `reason` 字段、由 UI 渲染给用户。更进一步的「AI 原因解读」属未来(接 agent)。决策选项:`重跑此检查 / 重跑本节点 / 跳过此检查`;升级(超时多次)时附 `gateHistory`(每次原因/粒度,不含退出码)。

**取舍**:① 门一失败一律自动重跑——错了:确定性命令重跑是空转,且违背四归宿(技术性失败该给 agent/人,不是「自动重试」;自动重试只配给瞬时类);② 一律立即问人——超时这种抖动不该打扰;③ 按原因+节点类型分流——选中:确定性失败立即给人(将来给 agent)、超时自动重试兜底、原因用「检查输出」而非退出码。

## Risks / Trade-offs

- [进程树 kill 内联实现跨平台漏杀(Windows 孤儿 node、POSIX 进程组边界)] → Windows `taskkill /T /F`、POSIX `detached + 杀进程组` 双路覆盖;`SIGTERM` 超时升 `SIGKILL`;测试用「自起子进程的脚本 + 取消后断言子孙皆灭」。
- [`shell:true` + 用户命令串的注入面] → 命令串是**工作流作者**自填的可信输入(非终端用户运行期输入),与 `agent-runner` 同信任级;不接受运行期任意拼接,故 shell 解析可接受。
- [非阻塞 start/resume/decide 后,渲染层拿到的是「初始」断点,后续靠事件刷新] → `App.tsx` 已订阅 `onEngineProgress` 并每事件回灌 `getRunState`,异步模型 UI 侧已就位;dogfood 卡只需补动作按钮/流式回显。
- [内存活运行登记与持久断点不一致(崩溃丢内存态)] → 内存态只存**取消句柄**(进程已随崩溃消失,无可杀者);`resumeAll` 按持久断点重 `drive`,有 `check` 的命令探测收敛,无 `check` 的重跑——与脊柱恢复语义一致。
- [无 `check` 的不幂等命令崩溃后重复执行] → 这是作者未加护栏的已知代价(软件判不了幂等性);编辑器软提示尽到引导;部署/发布引导走引擎操作。
- [`ref` 客观门把规则库依赖带进引擎运行期] → 复用既有解析、注入式依赖、缺失按上报不崩;测试注入假 rulePacks。
- [流式 `op-chunk` 高频事件压垮 IPC] → runner 端按行/小块节流累积(`onChunk` 合并),renderer 累积渲染;长输出截断展示(保留末段),全量只进终态摘要的 raw。

## Migration Plan

1. **先写测试(先红)**:① `command-run` 退出码/stdout/stderr 捕获、非零退出、cancel 杀进程树(自起子进程脚本);② command 节点执行 + 前置检查跳过(check 退 0→no-op、退非零→跑;无 check→跑);③ command 非零退出抛 `commandFailed` 决策、`decide(retry/skip)` 续跑;④ auto-gate inline + ref 真跑(过/不过路由);⑤ 动作按钮 `runGateAction` 跑命令 + 流式 + 停;⑥ `pause` 真杀在跑命令、`resume` 重跑(含有 check 的收敛);⑦ 非阻塞 start 立即返回 + 事件驱动。
2. **command-run.ts**:可取消运行器 + 树 kill;跑 ① 转绿。
3. **shared/types.ts**:`command` 加 `check?`、`EngineProgressEvent` 加 `op-chunk`、`EngineDecision` 加 `actions?`、`KlaritApi` 加 `runGateAction`;typecheck。
4. **engine.ts + decisions.ts**:活运行登记、非阻塞 start/resume/decide、`pause` abort、runExecuting 接 command + 前置检查、`evalAutoGate` 真跑(inline+ref)、`commandFailed` 决策、`op-chunk` 发射、动作执行;跑 ②③④⑥⑦ 转绿。
5. **workflow-definition 校验**:`check` 声明则非空;跑校验单测。
6. **IPC + preload**:注册 `runGateAction`、转发 `op-chunk`、注入 rulePacks;跑 ⑤ 转绿。
7. **renderer**:dogfood 卡动作按钮 + 流式回显 + 停;编辑器 check 输入 + 软提示;locales zh/en 新键。
8. **收尾**:`npm run typecheck` + `npm run test:run` 全绿;dogfood `npm start` 在临时仓跑一个带 command 节点(配 inline auto-gate)的工作流,验收通过/失败决策 + pause 杀命令 + 恢复。
- **回滚**:`check` 可选、`op-chunk`/`actions` 为增量可选字段、`command-run.ts` 独立新增——去掉 command 分支(回落跳过)+ `evalAutoGate` 复位为桩即回现状,无 `workflow.yaml` 结构变更、无数据迁移。

## Open Questions

- 动作按钮命令(如 `npm start`)的进程在「过门/运行结束」时是否自动收尾,还是留给用户显式停?倾向:动作进程独立于运行生命周期,用户显式停(或关窗时引擎兜底杀所有活动作进程)——dogfood 校准。
- `op-chunk` 的节流粒度(按行 / 按字节 / 时间窗)与 dogfood 卡的输出缓冲上限,先给保守默认(按数据块 + 末 N 行展示),真机调。
- (已定,见决策 10)超时做成**每条命令**的可选属性、全局默认无超时;`check` 的独立超时 v1 不做,留后续。
