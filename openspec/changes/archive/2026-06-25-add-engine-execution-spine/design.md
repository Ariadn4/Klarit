## Context

工作流数据模型已落地(`shared/workflow.ts`:`ENGINE_OPERATIONS`、`validateWorkflow`、`checkBranchPairing`、`createDefaultWorkflow`;`shared/types.ts`:`NodeExecutor` 判别联合)。`git.ts` 目前**只读、同步**(`makeGitRunner` 用 `execFileSync`,`probeGit`/`listBranches`/`listWorktrees`)。IPC(`main/index.ts` + `preload/index.ts`)**全是 `ipcRenderer.invoke` 请求/响应**,外加两个 `on()` 事件通道(`fileTreeChange`、`themeChanged`)。

运行模型的**概念**已写在 `docs/project-goals.md`:运行断点(当前节点 + 产出完成态 + 门把进度 + commit SHA)、失败与中断表、统一决策机制、内容驱动回退、暂停/恢复(关软件自动暂停、重开自动恢复)。本变更不发明新概念,而是给这套概念**第一根只用 git 操作的可执行脊柱**。

关键现实约束:**需求卡数据模型尚未落地**(`shared/workflow.ts` 注释:「card 未落地」)。故引擎不能把运行挂在卡上——运行以 `runId` 标识、断点按运行独立持久化;将来卡模型落地再把运行关联到卡。

## Goals / Non-Goals

**Goals:**
- 阶段状态机运行模型 + 运行态(`running`/`waiting-decision`/`paused`)+ 断点恢复,从一开始就**异步/可取消/可恢复**。
- 引擎执行器:8 个引擎操作建成**幂等 `ensure-*` 调谐器**,reconcile-by-probe。
- 失败**永不静默卡住**:成功 / 有限次重试 / 终局失败抛**固定选项决策**三归宿;人工评审门复用同一回路。
- `git.ts` 写侧四件套 + 合并 + 推送 + junction 链接/防御性解链,纯函数 + 结构化结果、可独立测。
- 一次性触发的 IPC + 开机自动恢复;引擎持有运行、渲染层只触发与观察。
- 两个默认工作流(本地直合 / PR 模式),hermetic smoke(本地裸仓当 origin)。

**Non-Goals:**
- 不实现 `agent`/`command`/`subworkflow` 执行器(留 proposal 2/3/4);本变更内它们被跳过。
- 不绑需求卡数据模型(运行按 `runId` 独立)。
- 不做自由输入决策、跨卡升级、决策的全局 agent 解读(无 agent 时不可能)。
- 不做真正的 GitHub PR(`gh pr create/merge`);PR 模式默认工作流用「push + 人工门 + 本地合并 + push main」骨架。
- 不做内容驱动回退 / 产物溯源图(那要产出与 agent 节点)。
- 不本地化引擎文案、不改持久化的 `workflow.yaml` 结构。

## Decisions

### 决策 1:引擎操作 = 幂等 `ensure-*` 调谐器(reconcile-by-probe)

不把操作建成动作(`createBranch`),建成**确保某状态成立**的调谐器:先探测 git/fs 实际状态,已达目标即 no-op,否则补齐。

```
ensure-分支       分支在且基点对?      → 跳过 : 创建
ensure-worktree   worktree 在该路径该分支? → 跳过 : (prune/repair 残留) → add
ensure-junction   junction 在且指向对?  → 跳过 : (清残留) → 链接
ensure-已合并     分支已并入目标?       → 跳过 : (检 MERGE_HEAD,在途则 abort) → merge
ensure-已推送     远端分支已是本地 HEAD? → 跳过 : push
ensure-无worktree worktree 已没?        → 跳过 : (防御性解 junction) → remove → prune
ensure-无分支     本地分支已没?         → 跳过 : (级联清检出它的 worktree) → branch -d
ensure-无云端分支 远端分支已没?         → 跳过 : push --delete
```

理由:**这一招让「可恢复」近乎免费**。断点只需记「当前节点 + 阶段」,恢复 = 重跑当前阶段;不管上次跑了 0%/50%/100%,幂等收敛,无需写前日志(git 自身状态即日志,探测即可)。「按难场景设计」就落在每个 ensure 的 reconcile 步里(prune/repair、merge-abort、清残留 junction)。

代价:每个操作要先探测、要处理「已存在/已不在/半成品」三态。但这正是鲁棒性所在,值得。

### 决策 2:取消/中断的边界——引擎操作跑到底,暂停只在阶段边界生效

引擎操作是确定性 git 命令(亚秒到数秒),**不被中途打断、不发起澄清式交互**。暂停/恢复是一个**协作式标志**,引擎在**阶段边界**检查:置位就持久化断点并停,**不杀 git 子进程**。

理由:省掉 AbortSignal 穿线、杀子进程、onCancel 补偿一整套复杂度。异步 git 运行器因此只需 `(args) => Promise<{code,stdout,stderr}>`(用 `execFile`),**不需要 signal**——等将来 agent 节点要杀 PTY 时再加。merge 冲突这类脏中间态由 ensure-已合并 自己的 reconcile(`git merge --abort`)收拾,不是用户取消触发的。

将来 agent 节点的 executing 阶段**可**被中途打断(杀 PTY),恢复时 phase 仍落 `executing`、用 `--resume` 续接——阶段模型不变,只是「executing 能否被打断」按执行器类型走。

### 决策 3:阶段状态机——断点做成阶段粒度,现在就定死

一个节点的执行是一台阶段状态机,每个阶段边界写断点:

```
进节点 → [executing] 跑执行者 ─检查点→ [gate 0] ─检查点→ [gate 1] ─…→ [done] 进下一节点
        引擎: 幂等 ensure        gate: 跑检查,过则进下一道,挂则抛决策
```

```
断点(按运行持久化, userData/engine-runs/<runId>.json):
  { runId, workflowId, repoContext, currentNodeId,
    phase: 'executing' | { gate: k } | 'done',
    pendingDecision?: <固定选项决策>,
    state: 'running' | 'waiting-decision' | 'paused' }
```

恢复 = 读断点 → 跳 (节点, 阶段) → 续跑。重跑当前阶段永远安全:executing→重跑幂等 ensure;gate k→已过的 0..k-1 跳过、从第 k 道续。

理由:引擎-only 节点只用到 `executing`(无门)这一平凡子集,但**现在就按完整阶段粒度建**,这样 proposal 2/3/4 加 agent 节点(executing 变长、gate 变非空、可中途打断)时,resume 机器一行不用改。这正是 project-goals 运行断点「门把进度(已过哪几道/停在哪道)」的落地。

### 决策 4:失败四归宿——自动 / agent 自愈 / 人工拍板,流程永不静默卡住

**铁律**:任一停顿都有出路,运行绝不停在不可见、无继续路径的死结。结果归宿有四:

```
成功 ───────────────────────────────────────────▶ 进下一阶段
自动处理(瞬时锁/网络抖→重试;环境性缺失→跳过)──── 自动解决 ─▶ 继续
技术性失败(合并冲突/测试没过/越界写入)──────────▶ 交给 agent 自愈(future)
                                                  → 卡上展示给 agent 的 prompt;agent 修完→重跑当前节点(幂等)续上
意图/破坏性/凭据类停顿(删未合并/强推/无远端…)───▶ 抛【人工决策】
                                                  → 运行进入 waiting-decision(可见、有前进选项)
```

**两条铁规**:

1. **决策选项一律"前进式"**——每个选项都让流程继续(继续/跳过本节点/重做/换法),**没有「中止」「暂不处理」这类死结**。彻底放弃某需求是卡级别的另一回事(future),不混进节点决策。
2. **能自动就别问、能 agent 就别问人**——只有"涉及意图取舍 / 破坏性 / 凭据环境"这类人不点头机器不敢动的才抛人工。

**统一决策 schema**(失败决策、人工门、future 的 agent 提问都走它)。**文案全是 i18n key + 参数,引擎不写死语言**,渲染层按当前选中语言翻译(切语言实时跟随);**git 原始英文输出只进 `raw` 字段供开发/测试排查,正式 UI 绝不渲染**:

```
EngineDecision {
  source
  sourceKind: 'engine' | 'agent'      // 决策来源;UI 据此派生"自填选项"(agent 才给,引擎处理不了开放答案)
  titleKey, titleParams?               // 背景说明的 i18n key + 插值参数(如 { address }/{ node })
  options: [{ id, labelKey, detailKey?, recommended? }]   // 前进式可点选项(文案皆 key)
  multi?: boolean                       // 单选/多选
  input?: { labelKey, placeholderKey? } // 可选填空(如「远端仓库地址」)
  raw?: string                          // 原始底层输出(git stderr 等)——仅 dev/test 展示,正式 UI 不渲染
}
decideRun(runId, { optionId? | optionIds? | text? })
```

**本变更只产生 `sourceKind: 'engine'` 的决策**(纯 git、无 agent)。`allowCustom`(自填选项)由 UI 从 `sourceKind==='agent'` 派生,引擎来源永不给。`guidance`(指导文案,如怎么配凭据)是 **agent** 的活,引擎不写、不假装指导。决策文案不倒 git 英文原文——用户只看 `titleKey` 翻出的干净说明;push 失败把当前远端地址作 `titleParams.address` 带出,让重填时一眼看出"是这个地址失败了"。

**本变更里会真实发生的停顿(全 engine、全前进式):**

| 停顿 | 前进式选项 |
|---|---|
| PR 评审门 | `通过`(打回连同回退基建留 future,不写死回退节点) |
| push 非快进 | `拉取变基后重推`(荐) / `强推覆盖远端` / `跳过推送` |
| push 无远端 | 〔填:远端地址〕配置并推送 / `跳过推送` |
| push 认证失败 | `我已配好凭据,重试`(荐) / `跳过推送` |
| 删未合并分支 | `先合并再删`(荐) / `直接删除丢弃` / `保留分支,跳过该节点` |
| open-worktree 路径被占 | `删占位重建` / `递增尾号重建`(引擎自动加序号) |
| remove-worktree 被占 | `我已关程序,重试`(荐) / `强制删除` / `跳过,保留 worktree` |

删本地分支统一用 `git branch -d`(未合并即拒绝),把「防丢未合并工作」白送成护栏:`-d` 拒绝 → 抛上表决策,绝不静默 `-D`。

**接 agent 的口子(本变更只留、不实现):**
- 决策的 `sourceKind` 字段(本变更恒 `engine`)——agent 决策一进来,自填/路由分支有处可挂。
- **"重跑当前节点"即 future agent 回调的落点**:agent 修完(如解完冲突并提交)→ 引擎重跑该节点的 ensure → 因幂等,这次自然通过 → 续上。不需要新状态/新协议。
- 技术性失败(冲突/测试/越界)的 agent 路由与 prompt **在本变更不实现**——它们是 agent 干活的下游产物,纯 git 流程里不会自然发生(空 feature,merge 恒 noop)。分类与 prompt 写在「agent 自愈分类」一节当 proposal 2 的输入。

理由:用户明确——流程不能因错误莫名卡住,但也不能动不动打扰人。四归宿 + 前进式选项 + 统一 schema,既保证可继续,又把人类的注意力只留给真正需要拍板的。

### 决策 5:人工评审门复用同一决策回路(本变更只上「通过」)

PR 模式的「人工评审」门走**同一个** `EngineDecision`(`sourceKind: 'engine'`)、同一个 `waiting-decision` 态、同一套断点恢复、同一个 `engine:decide` 回应——背景「分支已 push,请评审」+ 选项 `通过`。

**打回不在本变更**:打回要回退到哪个节点,需按配置的工作流 + 内容判断(内容驱动回退 + 产物溯源),那整套基建属 future,不在本变更硬塞一个会写死实现节点的假打回。所以本变更评审门只有 `通过` 一个前进动作(人类 go 检查点)。

理由:为失败处理建的统一决策回路,几乎白送人工门;打回连同回退基建一起留给后续。

### agent 自愈分类(本变更不实现,作 proposal 2 输入)

技术性失败交 agent 自愈;每条配一段给 agent 的 prompt(future 注入会话时带上需求卡活现状、可写范围等公共输入):

- **合并冲突**:「把 `{branch}` 合并进 `{base}` 冲突,文件 `{files}`。理解两侧意图,产出既保留主干又保留本分支功能的合并结果并提交;互斥处保留双方并标注;无法判定的上抛人工。」(届时引擎合并冲突**不再 abort**,保留冲突态交给 agent。)
- **push 非快进的整合**:「`fetch` 后把本地变基到 `origin/{branch}` 之上,变基冲突按合并冲突规则解决,完成后重推,不得强推。」
- **客观门失败**:「检查 `{check}` 退出码 `{code}`,输出 `{output}`,定位并修复使其通过,只动相关代码,守可写范围与测试先行。」
- **越界写入**:「你改了可写范围外的 `{files}`(已被引擎还原),改用范围内方式实现或说明为何须扩大范围,然后重做本节点。」

### 决策 6:删除类操作自愈级联,而非机械配对逆操作

- **删 worktree**:删之前**无条件**浅扫 worktree 树,用 `lstat` 找出每个 reparse point(junction/symlink),`fs.unlink` 它本身,**绝不往里递归**;扫净后才 `git worktree remove`/删目录,再 `git worktree prune`。这样越过软件、AI 私自建的 junction 也兜得住——「绝不递归进 reparse point」是安全支点(永远不会顺着 junction 走进真 node_modules 删掉它)。
- **删本地分支**:用 `git branch -d`;若分支仍被某 worktree 检出(git 会拒删),`ensure-无分支` **级联**先 `ensure-无worktree` 清掉它,再删分支。

理由:create 侧**显式拆分**(开 worktree、关联环境是有意的独立设置节点,失败隔离 + 可配「链什么」);teardown 侧**自愈级联**(鲁棒、自给自足)。设置要显式,拆除要兜底。校验层仍**提醒**(`open-worktree ⇒ remove-worktree`)但级联是安全网,vibe coder 怎么连都不撞 git 天书报错。

### 决策 7:junction 用 `fs.symlink(target, path, 'junction')`,探测用 `lstat`+`readlink`

不 shell 调 `mklink`。Node 的 `fs.symlink(..., 'junction')` 在 Windows 造目录 junction、不要管理员;`lstat().isSymbolicLink()` + `readlink()` 给 ensure-junction 的幂等探测(在且指向对→跳过;指向错→清+重链)。

理由:无外部进程、跨平台一致(非 Windows 退化为普通 symlink,测试照跑)、探测即原语。

### 决策 8:引擎操作词表 4 → 8 + 复合别名;能力声明随之扩

新词表:`create-branch`、`open-worktree`、`link-env`、`merge-branch`、`push-branch`、`remove-worktree`、`delete-branch`、`delete-remote-branch`。旧 `delete-branch-worktree` 作**复合别名**(引擎执行时 = remove-worktree + delete-branch),保证既有种子包不破。

能力声明(`producesOutputs`/`supportsGate`/`supportsWritableScope`):全部 `producesOutputs=false`、`supportsWritableScope=false`(确定性 git,不交付文档、不写业务文件);`supportsGate` 仅 `push-branch=true`(天然的人工评审点),其余 `false`。

分支配对校验:`create-branch` 存在 ⇒ 须有 `delete-branch` **或** 复合别名 `delete-branch-worktree`。

理由:对齐两个默认工作流的节点序列;别名保兼容;能力声明让编辑器在 push-branch 节点提供门把配置。

### 决策 9:本地直合 vs PR 模式 = 两个默认工作流,共用前半段

```
共用:  建分支 → 开worktree → 关联环境 → [实现占位(本变更跳过)]
本地直合:           → 合并 → push main → 删worktree → 删本地分支
PR 模式:            → push 需求分支 → [门:人工评审] → 合并 → push main
                    → 删云端分支 → 删worktree → 删本地分支
```

push(至少推 main)进**两个**默认——连本地模式也要把主干推上去备份。真正的 `gh pr create/merge` 不在本变更,PR 模式先用「push + 人工门 + 本地合并 + push main」的纯引擎+门骨架,可在本地裸仓上 hermetic smoke。

理由:用户明确要两个默认来「测得出来」;push 提成引擎操作(而非等 command 执行器),使两个默认在本变更内就能端到端跑。

### 决策 10:一次性触发的 IPC——引擎持有运行,渲染层只触发与观察

```
invoke engine:start(RunRequest) → { runId }   // 触发一次,立即返回(不 await 整个运行)
invoke engine:pause(runId) / engine:resume(runId)
invoke engine:decide(runId, optionId)          // 回应 waiting-decision / 人工门
invoke engine:getRunState(runId)               // 挂载时回灌 UI
on     engine:progress(evt)                     // 节点/阶段进入退出、操作输出、需要决策(第3个事件通道)
```

`RunRequest = { workflowId, repoPath, branch?, ... }`(不绑卡)。运行生命周期归引擎(main)所有,断点持久化到 userData;**渲染层 await 一个长 invoke 会在关窗时变孤儿,故绝不让它持有运行**。开机 `whenReady` 时引擎扫持久化运行,把 `running` 的自动续跑(对齐 project-goals「重开自动恢复」)。

理由:与既有约定一致(invoke + `on()` 事件,如 `fileTreeChange`);把长任务的所有权放对地方,关窗/崩溃不丢运行。

### 决策 11:非引擎执行者在本变更内 no-op 跳过

引擎执行循环识别全部四类执行器,但本变更只实现 `engine`;遇 `agent`/`command`/`subworkflow` 节点,发一条「执行器未落地,跳过」进度事件并直接过到 done 阶段。

理由:让含「实现占位」(agent)节点的默认工作流仍能端到端跑完 git 生命周期 smoke;proposal 2/3/4 把跳过替换为真实执行,运行循环结构不变。

## Risks / Trade-offs

- [ensure 探测把简单操作变重/有边界情形(半成品 worktree、在途 merge)] → 每操作显式覆盖三态(在/不在/半成品),reconcile 用 `worktree prune`/`worktree repair`/`merge --abort`;测试针对每种半成品态。
- [防御性解链扫描在大 worktree 上慢,或漏判 reparse point] → 只浅扫(命中 reparse point 即停、不递归),正常 worktree 树规模可控;以「绝不递归进 reparse point」为安全不变量,而非「扫得全」为正确性前提——即便漏一个,也只是后续 remove 失败抛决策,绝不误删 junction 目标。
- [push 类操作引入网络/认证不确定性,污染 hermetic 测试] → 测试用本地 `git init --bare` 当 origin,push/删云端分支全本地、确定;真实远端/`gh` 的不确定性留给后续 command 升级。
- [运行不绑卡,将来绑卡要改 IPC/断点形状] → `RunRequest`/断点用「运行上下文」抽象,卡落地后增一个 `cardId?` 关联字段即可,不改阶段状态机/决策回路核心。
- [词表扩展 + 别名让校验/编辑器/能力声明多处要改] → 别名集中在一处映射;能力声明纯函数 + 表驱动,新增操作只改表;校验只动配对逻辑一处。
- [固定选项不够覆盖某些终局失败] → 每操作至少给「中止」兜底(中止 = 运行停在 waiting-decision、不前进、不破坏现状);未枚举的失败回落为「重试 / 中止」通用决策,绝不静默。

## Migration Plan

1. **先写测试(先红)**:① git 写侧四件套/合并/推送/junction 防御性解链(临时仓 + 本地裸仓);② ensure 幂等(同操作连跑两次,第二次 no-op、状态不变);③ 阶段状态机断点恢复(跑到某节点 kill,重启从断点续);④ 失败→固定决策路由(造冲突/未合并/非快进,断言抛对应固定选项、运行进 waiting-decision、`decide` 后按选项续);⑤ 两个默认工作流端到端 smoke(含中途关闭重开)。
2. **git.ts 写侧 + junction**:异步运行器 + 四件套 + 合并 + 推送 + 链接/防御性解链,纯函数返结构化结果;跑 ① 转绿。
3. **引擎执行器 + 运行模型**:ensure-* 调谐器、阶段状态机、断点持久化、失败三归宿 + 决策回路、暂停/恢复;跑 ②③④ 转绿。
4. **词表 + 默认工作流 + 校验**:`ENGINE_OPERATIONS` 4→8 + 别名、能力声明扩展、`checkBranchPairing` 更新、`createDefaultWorkflow` 出两个默认、种子种入两个;跑相关单测转绿。
5. **IPC + 自动恢复**:注册 `engine:*` handler + `engine:progress` 事件 + preload 暴露;`whenReady` 扫运行自动续;跑 ⑤ 转绿。
6. **收尾**:`npm run typecheck` + `npm run test:run` 全绿;dogfood `npm start`(不监听源码)在临时项目里跑两个默认工作流,中途关软件重开验证恢复。
- 回滚:词表别名保兼容、能力声明是元数据不入文件、运行持久化是新增独立目录——去掉引擎 IPC 注册与种子第二默认即回到现状,无 `workflow.yaml` 结构变更、无数据迁移。

## Open Questions

- 「关联环境」默认 junction 什么?最可能是各成员仓的 `node_modules`(让 worktree 能 `npm start` 验收)与多仓的兄弟成员仓——本变更把「链什么」做成 `link-env` 节点的可配参数,默认集待 dogfood 校准。
- push main 的远端来源:复用 `probeGit` 读到的 `origin`?无 origin 时本地模式的 push main 直接走「跳过 push」固定决策(不阻断交付)。
- 复合别名 `delete-branch-worktree` 是长期保留,还是给一次性数据迁移把旧种子包改写成新两节点?本变更先保留(零迁移),迁移可作后续 polish。
