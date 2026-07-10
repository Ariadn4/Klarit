## ADDED Requirements

### Requirement: 节点的目标仓选择

每个工作流节点 SHALL 可声明一个可选的「目标仓选择」(`target`),用判别联合表达该节点的引擎操作作用于哪些成员仓。解析基准是**运行所绑卡的涉及仓集合 `card.repos`**(见 `requirement-card-store`);`target` 在此基准上进一步选择:

- `all`:卡 `repos` 的**全集**。
- `tag`:卡 `repos` 中带匹配 `tag` 的成员仓(见 `multi-repo-project` 的成员标签)。
- `repo`:由 `memberId` 写死的单个成员仓(须属卡 `repos`,项目私有用法)。
- `fromUpstream`:由指定上游 agent 节点的结构化输出在卡 `repos` 内进一步收窄出的子集。

节点**未声明** `target` 时,SHALL 缺省解析为 `all`(= 卡 `repos` 全集)。单仓卡(`repos` 单元素)即作用于其唯一成员,行为与今日单仓一致。运行无绑卡(旧数据)时,基准回落为运行的单仓上下文。

#### Scenario: all 解析为卡涉及仓全集
- **WHEN** 一个引擎节点声明 `target=all`,卡 `repos` = [A, B]
- **THEN** 该节点的引擎操作对 A 与 B 各执行一次

#### Scenario: tag 在卡涉及仓内按标签筛选
- **WHEN** 一个引擎节点声明 `target={tag:'后端'}`,卡 `repos` = [A, B] 中仅 B 的 `tag` 为「后端」
- **THEN** 该节点的引擎操作仅对 B 执行

#### Scenario: repo 写死单个成员
- **WHEN** 一个引擎节点声明 `target={repo: B 的 memberId}`
- **THEN** 该节点的引擎操作仅对 B 执行;若该 memberId 不属卡 `repos` 则为校验/运行期错误

#### Scenario: 缺省 target 等价卡涉及仓全集
- **WHEN** 一个引擎节点未声明 `target`
- **THEN** 解析为卡 `repos` 全集;单仓卡即作用于其唯一成员,行为同今日单仓

### Requirement: 卡涉及仓集合的来源与「分诊」

卡的涉及仓集合 `card.repos` SHALL 作为多仓运行的**卡级基准**。它 MAY 由**分诊**产出——一个上游 agent 节点判定「本卡需要动哪些成员仓」(前端/后端/前后端/纯配置=空),其结构化输出写入 `card.repos`;人 MAY 在其上确认/修改(agent 猜、人拍板)。`card.repos` 缺省 MAY 为项目全体成员(交由「默认全建 + 未用回收」自然收敛),或被分诊预收窄到实际涉及仓(则无空分支可回收)。二者 MUST 都被支持。

#### Scenario: 分诊 agent 写入卡涉及仓
- **WHEN** 上游 agent 节点判定「本卡仅涉及后端 B」并产出结构化涉及仓输出
- **THEN** `card.repos` 记为 [B],后续 `target=all` 节点仅对 B 扇出

#### Scenario: 缺省全体成员靠回收收敛
- **WHEN** `card.repos` 缺省为项目全体 [A, B],但实际仅 B 被改动
- **THEN** A 建出的空分支经 merge no-op + 安全删自然回收(见 `engine-execution`)

### Requirement: 上游判定驱动下游目标仓

`target=fromUpstream` 的节点 SHALL 引用一个上游 agent 节点的**结构化输出**,在卡 `repos` 内进一步收窄出成员仓子集(用于运行**中途**动态收窄,区别于卡级的 `card.repos` 分诊)。引用的上游节点 MUST 在本节点之前执行且 MUST 产出结构化涉及仓字段;否则为校验错误或运行期终局失败(落入可见的等待决策,绝不静默卡住)。

#### Scenario: 上游判定只动后端,下游据此只建后端
- **WHEN** 上游 agent 节点结构化输出「子集 = [后端 B]」,下游 `create-branch` 节点 `target={fromUpstream: 该 agent 节点}`
- **THEN** `create-branch` 仅对 B 执行,A 不建分支

#### Scenario: 引用的上游节点缺结构化输出
- **WHEN** `fromUpstream` 引用的上游节点未产出涉及仓判定
- **THEN** 保存时校验失败,或运行期表现为可见的等待决策,不静默卡住

### Requirement: 引擎按目标仓子集扇出执行

引擎执行一个引擎节点时 SHALL 先把该节点的 `target` 解析为成员仓子集,再对子集中**每个成员仓**各执行一次该幂等 ensure 操作。各成员的执行 SHALL 互相独立:某成员失败不阻断其余成员的探测,但整节点的阶段推进 MUST 等子集全部收敛后再依失败归宿处理。

#### Scenario: 子集逐成员各执行一次
- **WHEN** `create-branch` 节点 `target=all`,卡 `repos` = [A, B]
- **THEN** 引擎对 A、B 各确保同名分支存在,两者皆达成才推进该节点

#### Scenario: 子集中某成员失败进入可见停点
- **WHEN** 扇出执行中成员 B 的操作终局失败、A 成功
- **THEN** 运行进入可见的等待决策(携带是哪个成员、何种失败),绝不静默卡住

### Requirement: 卡 slug 作所有目标仓的同名分支

一次运行 SHALL 以所绑需求卡的 slug 作为**所有被 target 命中的成员仓**的分支名(同名跨仓)。同一张卡在不同成员仓里的工作分支 MUST 同名,以便人脑跨仓对齐。

#### Scenario: 同名分支跨仓建立
- **WHEN** 卡 slug 为 `feat/batch-workflow-actions`,`create-branch` 命中 A、B
- **THEN** A 与 B 各建一个名为 `feat/batch-workflow-actions` 的分支
