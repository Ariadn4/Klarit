## Context

新建需求的主入口(描述想法 → 分解 → 审阅 → 创建)是**批内自洽的孤岛**:分解 agent 的输入只有描述文本,候选卡的关系边被 `validateCandidateBatch` 校验成**只能引用本批**(`allNames`)。于是「把在跑任务设为前置、让新需求 `blocked_by` 它」在主入口做不了。

数据模型本身支持跨卡 `blocked_by`/`blocks`(`CardRelation.target` 是任意卡 id),而**编排路**(全局 agent + `card-ops.validateOps`)早已把全盘喂进去、能跨卡 `relate`。但两条路各写了一份关系边合法性判断,已经漂移:`validateOps` 的 `relate` 对 `blocks`/`blocked_by` 目标**只查存在、不查状态**,能给一张在跑卡凭空补前置门;`validateCandidateBatch` 则**没有成环检测**。

关键约束:`blocked_by` 是 `todo-auto-scheduler.isAutoEligible` 的**硬门**——一张卡只要有任一 `blocked_by` 目标未「已完成」就不会被自动启动。所以一条判错的依赖边不是无害标签,而会让卡**静默罢工**。这既是能力缺口,也是可靠性问题。

## Goals / Non-Goals

**Goals:**
- 新建流程能让候选卡向**现有卡**建依赖(尤其 `blocked_by` 在跑卡),由 AI 在看得到全盘时自动判断。
- 关系边合法性收成**单一来源**,分解路与编排路共用;`relate` 的 blocks 状态门洞随之补上。
- 确立不变量:一条 `blocks` 边**引入时**目标须未跑(`未开始 && !activeRunId`);`blocked_by → 在跑卡`放行。
- 复核窗把跨卡依赖门**显式呈现、可编辑**——因为它有调度硬门,人得看得见。

**Non-Goals:**
- **不**把分解路重构成 `CardOp[]` 流——两个入口产物形状本就不同(`CandidateCard[]` vs `CardOp[]`),只统一到「边合法性谓词」这层。
- **不**改 `blocked_by` 硬门的判定口径,**不**改调度并发/填槽逻辑。
- **不**追溯校验既有已落库边。
- **不**做文件级/语义级的依赖智能推断——只让 AI 基于全盘摘要判断。

## Decisions

### 决策 1:统一在「单条边合法性谓词」这层,不在「op 流」这层

抽 `isRelationEdgeLegal(edge, from, universe, registry)` 作纯逻辑单一来源,`validateCandidateBatch` 与 `validateOps` 都调它。

- **为什么这个粒度**:候选卡带 relations ≈ 一组 `create` + `relate add`,是 `CardOp[]` 的退化子集。若统一到 op 流,会把 `adjust/split/merge/delete` 的包袱拖进只做 create 的分解路,复核窗(围绕 `CandidateCard[]` 建)也得推倒。而真正易错、安全关键的是**边规则本身**——把它发一次即可。
- **为什么现在能统一**:一旦分解流注入全盘上下文,两条路的**引用宇宙**都变成「现有落库卡 ∪ 本批新卡」——正是 `validateOps` 早已用 `byName`(现有)+ `introduced`(新建)建模的宇宙。统一不是硬凑,是它们本该是一个,只是分解路历史上少了「现有卡」那一半。
- **备选**:两处各自加 blocks 状态门(维护两份,会再漂,已有前车之鉴);或把边校验做成主进程 IPC(破坏 shared 纯逻辑、增加往返)。均劣。

### 决策 2:不变量的措辞是「引入期的门」,不是「常驻不变量」

规则是:`blocks` 边**在被写入的那一刻**,目标须 `未开始 && !activeRunId`。既有边不追溯。

- **为什么**:若说成「任何时刻任何 blocks 边不许指向在跑卡」,会**反噬历史数据**——一条建边时目标还闲、后来目标开跑的老边会突然「违规」,可没人动过它。边只在引入时校验,写完就落定。
- **方向非对称是对的**:`blocks A→B` 等价 `B blocked_by A`,等待端都是 B。`blocked_by → 在跑卡`(等待端=发起的新卡)放行,正是用户要的「新需求依赖在跑的活」;`blocks → 在跑卡`(等待端=在跑的目标)拒,因为给飞行中的东西补前置门无意义。共享谓词按边的 `kind` 分别处理,不搞对称禁令。

### 决策 3:成环检测下沉并泛化图输入

把 `card-ops.wouldCycle` 的图输入从 `Map<string, StoredCard>` 泛化为「能同时喂现有卡 + 本批新卡」的合并视图,移进谓词。分解路因此**获得它此前缺失的父子成环检测**,顺带修一个潜在 bug。

### 决策 4:分解输入扩字段,向后兼容

`DecomposeInput` 增一个可选的全盘快照字段(现有卡活现状 + 关系图,复用 `board-context.buildBoardContext` 的装配);`runDecompose`/校验注册表接受「现有卡集合」。旧调用不传即退化为纯批内(现状行为),不破坏既有契约。分解 IPC(`decomposeRequirement`)在主进程把当前项目的卡快照装配好注入。

### 决策 5:复核窗把门顶到脸上

`ReviewWindow`/`TaskDetail` 从「一行灰 mono 的 `kind→target`」升级为:列出 `blocked_by`/`blocks` 依赖门、每条标目标卡当前状态、可删、可加 `blocked_by` 指向现有卡。加/留的边过同一谓词。这是「AI 自动判断」从「赌它别抽风」变「靠谱」的兜底环——AI 提议、人在此确认。

## Risks / Trade-offs

- **AI 假阳性依赖 → 卡静默罢工** → 复核窗显式呈现每条门 + 目标状态,人可一键删;`blocked_by` 有硬门这一事实正是要求"看得见"的理由。
- **全盘快照 token 截断漏掉该挂的卡** → `buildBoardContext` 已「显式标注省略 N 张卡」(no silent caps),沿用;审阅窗手动加门作为兜底,不完全依赖 AI 在预算内看全。
- **状态是活的:AI 判断/审阅时目标"在跑",落库时可能已完成或反之** → 引入期以**当下**状态判定并落定,符合「引入期门」语义;既有边不追溯,后续状态漂移由调度硬门(只认已完成)自然消化。
- **统一谓词回归风险(动到编排路热路径)** → 先写谓词的红测试覆盖两路各分支(blocks 在跑拒、blocked_by 在跑放行、跨图成环、目标为现有卡、既有边不追溯),再切 `validateCandidateBatch`/`validateOps` 调用,保证行为等价 + 新规则生效。

## Migration Plan

1. `requirement-card.ts` 新增 `isRelationEdgeLegal` + 泛化 `wouldCycle` 图输入(先红测试)。
2. `card-ops.validateOps` 的 `relate`/`create` 边校验改调谓词(补 blocks 状态门);`decomposition.validateCandidateBatch` 改调谓词、吃「现有 ∪ 本批」宇宙。
3. `decompose-service` / 分解 IPC 注入全盘快照与现有卡校验集;`DecomposeInput` 扩字段。
4. `NewRequirementFlow`/`newRequirement` store:复核窗呈现+编辑跨卡门。
5. 全程测试先红后绿;无数据迁移(字段可选、语义前向兼容)。回滚=还原调用点,谓词孤立无副作用。

## Open Questions

- 复核窗「加一条 `blocked_by` 指向现有卡」的选择器交互形态(下拉搜现有卡 vs 从关系图点选)——留待 UI 实现时按品牌规范定,不阻塞核心校验落地。
- 分解注入的全盘快照预算是否与编排上下文(默认 12000 字符)共用同一档,还是分解另设——倾向复用,实现时确认无 prompt 过长风险。
