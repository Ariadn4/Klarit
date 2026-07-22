## Why

新建任务时看不到、也连不上现有卡:分解 agent 的输入只有一段描述,候选卡的关系边被校验成**只能引用本批**,连不到已落库的卡。于是「把正在跑的任务设为前置、让新需求 `blocked_by` 它」这种最自然的 PM 动作在主入口做不了。与此同时,这套「关系边合不合法」的判断在分解路(`validateCandidateBatch`)和编排路(`validateOps`)各写了一份、已经漂移——编排路的 `relate` 给一条 `blocks` 边时**只查目标存在、不查状态**,能给一张**正在跑**的卡凭空补前置门,这是个实打实的洞。而 `blocked_by` 是 `todo-auto-scheduler` 的**调度硬门**,连错一条边就会让卡静默罢工,所以这既是能力缺口也是可靠性问题。

## What Changes

- **关系边合法性收成单一来源**:抽一个纯逻辑边谓词 `isRelationEdgeLegal(edge, from, universe, registry)`,`validateCandidateBatch` 与 `validateOps` 都改调它。判断口径统一后,两条路不再各写一份、不会再漂。
- **新增不变量「blocks 引入时目标须未跑」**:一条 `blocks` 边**在被引入的那一刻**,目标必须是尚未启动的卡(`未开始 && !activeRunId`);指向在跑卡则拒。覆盖所有引入新边的入口——分解候选卡自带的边、编排 `create` op 的新卡边、以及编排 `relate add` 给老卡加的边(**`relate` 的洞随之被堵**)。对既有边**不追溯**(建边时合法即落定)。`blocked_by → 在跑卡` 依旧放行(等待端是发起卡自己,不是在跑的目标)。
- **跨图成环检测下沉到谓词**:`wouldCycle` 泛化为吃「现有落库卡 ∪ 本批新卡」的合并图,分解路因此也获得它此前缺失的父子成环检测。
- **分解流注入全盘上下文**:分解输入带上 `buildBoardContext` 摘要,候选卡关系 `target` 可指向**现有卡**(不再仅限本批);批校验对标编排路的「现有卡 ∪ 本批新卡」引用宇宙。
- **复核窗显式呈现跨卡门**:`ReviewWindow` 列出候选卡的跨卡依赖边(尤其 `blocked_by`/`blocks`)、标出被指向卡的当前状态、可删可编辑——因为这条边有调度硬门,人得看得见。

## Capabilities

### New Capabilities
<!-- 无新增能力：全部为对现有能力的需求修改。 -->

### Modified Capabilities
- `requirement-card-model`: 关系合法性新增「`blocks` 引入时目标须未跑(`未开始 && !activeRunId`)」不变量;关系边 `target` 允许引用**现有落库卡**(不再仅限本批候选);合法性判定以单一纯逻辑谓词表达,供分解与编排两路共享。
- `requirement-decomposition`: 分解输入携带本项目全盘快照;候选卡批校验的引用宇宙扩为「现有卡 ∪ 本批新卡」,关系 target 可指向现有卡;自动生成的分解 skill 允许并引导引用现有卡建立跨卡依赖。
- `requirement-orchestration`: 逐 op 校验中 `relate`(及 `create` 内嵌边)的 `blocks`/`blocked_by` 改走共享谓词,补上「blocks 目标须未跑」这条此前缺失的状态门。
- `decompose-ui`: 「审阅候选任务」窗显式呈现候选卡的跨卡依赖边(含被指向卡的当前状态),并支持删除/编辑这些门。
- `todo-auto-scheduler`: `blocked_by` 硬门措辞与「blocks 引入时目标须未跑」对齐,交叉引用边引入期的校验保证(调度行为本身不变)。

## Impact

- **纯逻辑(shared)**:`src/shared/requirement-card.ts`(新增 `isRelationEdgeLegal`、泛化 `wouldCycle` 的图输入)、`src/shared/decomposition.ts`(`validateCandidateBatch` 改调谓词、吃现有卡宇宙)、`src/shared/card-ops.ts`(`validateOps` 的 `relate`/`create` 改调谓词)、`src/shared/board-context.ts`(供分解流复用)。
- **主进程**:`src/main/decompose-service.ts` 与分解 IPC(`decomposeRequirement`)——把 board 快照注入 `DecomposeInput` 与校验注册表;`DecomposeInput` 类型扩字段(向后兼容)。
- **渲染层**:`src/renderer/src/components/NewRequirementFlow.tsx`(`ReviewWindow`/`TaskDetail` 呈现+编辑跨卡门)、`src/renderer/src/stores/newRequirement.ts`(携带现有卡上下文)。
- **测试**:`decomposition.test.ts`、`card-ops.test.ts`、`requirement-card.test.ts`、`auto-schedule.test.ts`、`NewRequirementFlow.test.tsx` 增删相应用例(先红后绿)。
- **无破坏性变更**:数据模型字段不删不改语义;`blocked_by → 在跑卡` 行为不变;既有边不被追溯校验。
