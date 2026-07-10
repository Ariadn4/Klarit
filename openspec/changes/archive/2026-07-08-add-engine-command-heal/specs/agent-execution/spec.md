## ADDED Requirements

### Requirement: 临时 heal agent 复用执行器

引擎为引擎/命令节点技术失败自愈拉起的**临时 heal agent** SHALL 复用本能力的 agent 执行器——无头 adapter 拉起、握手文件为真相源、续接「就高不就低」阶梯、可写范围越界后置检测、每节点提交——与 agent 节点同源,差异仅在:它是**临时**的(一次自愈生命周期,超限即弃,不绑工作流节点声明)、**读写**且 scope 到出错的**卡工作区**、其 `# 任务` 段是**引擎合成的 heal prompt**(合并冲突版 / 命令失败版)而非节点驱动指令。heal agent MUST **只**解冲突/改代码、**不自己提交**(提交由引擎确定性执行,见 `node-failure-heal`)。heal agent 的续接注入 MUST 复用统一续接判定(注入上次失败详情 / 用户对其提问的决策答复)。

heal prompt 的公共输入 MUST 复用 agent 节点的拼装(生效宪法 + 需求卡活现状 + 引擎交互协议),仅替换 `# 任务` 段:合并冲突版告知「主线已并入你当前分支、以下文件冲突、保留两侧意图解冲突、只改冲突文件、不要自己提交」;命令失败版告知「命令 X 失败、输出如下、改代码让它通过、不要自己提交、若非代码问题则经握手请求决策」。

#### Scenario: heal agent 经执行器读写拉起于卡工作区
- **WHEN** 引擎为某成员仓的合并冲突拉起临时 heal agent
- **THEN** adapter 无头启动一个读写 agent,cwd 为该成员卡工作区,喂合并冲突版 heal prompt,只解冲突不自己提交

#### Scenario: heal agent 提问复用 agent 决策通道
- **WHEN** heal agent 经握手写 `need-decision`
- **THEN** 引擎抛 `sourceKind='agent'` 决策(落该卡、选项取自 agent 自填、附自由输入),答复经续接注入回该 heal agent,不新造通道

#### Scenario: heal prompt 公共输入与节点 agent 同源
- **WHEN** 拼装 heal prompt
- **THEN** 其公共输入(宪法/需求卡/引擎交互协议)复用 agent 节点同一拼装,仅 `# 任务` 段为引擎合成的 heal 任务

### Requirement: 决策自由输入新起的读写处置 agent

当一个**无当前 agent** 的决策(引擎/命令失败、客观校验门失败;**不含人工评审门**)收到用户提交的**自由文本**时,引擎 SHALL **新起一个临时读写处置 agent**,复用同一执行器形态(读写、cwd = 卡工作区、握手/续接/越界/每节点提交),与自动 heal agent 同机器,差异仅在**由用户自由输入触发**、其 `# 任务` 段含「失败背景 + 用户自由输入 + 帮用户处理」的指令。处置 agent MUST:能改代码解决就改(**不自己提交**,引擎提交后重跑该失败操作验证);**无法用代码解决**(如 push 无远端、worktree 被占等)时,经握手 `need-decision` **解释原因并把处置建议作为新选项交回用户**,MUST NOT 硬撑乱改。处置 agent 同样只读/读写权限、留痕、prompt 可见规则与 heal agent 一致。

#### Scenario: 无当前 agent 决策的自由输入新起处置 agent
- **WHEN** 一个命令失败超限决策(无当前 agent)被用户写入自由文本并提交
- **THEN** 引擎新起一个读写处置 agent(cwd = 卡工作区),喂失败背景 + 用户自由输入,令其改代码;引擎提交后重跑命令验证

#### Scenario: 非代码可解的失败经握手解释交回选项
- **WHEN** 一个 push 无远端决策被写入自由输入,处置 agent 判断这不是代码能解决的
- **THEN** 处置 agent 经握手 `need-decision` 解释原因、把处置建议作为新选项交回用户,不擅改代码

#### Scenario: 人工评审门不触发处置 agent
- **WHEN** 一道人工评审门决策(本能力内不带自由输入框)
- **THEN** 不存在新起处置 agent 的路径(其驳回回退判定留后续)

### Requirement: 所有 agent 运行全量留痕且 prompt 随输出可见

引擎 SHALL 为**每一次** agent 运行——节点 agent、自愈续接、临时 heal agent——各记一份**可排查的运行记录**,持久化、关软件重开仍可查,至少含:**喂入的完整 prompt**、增量自存的会话记录(stdout/stderr 转写,边跑边落盘)、握手文件内容与最终 `status`、最终归宿(done/need-decision/failed/超限回落)、所属运行/节点/成员仓、每仓起始与提交 SHA、(自愈/heal 的)第几次尝试。渲染层 SHALL 在每个 agent 的输出框**同时展示喂给它的完整 prompt**(含临时 heal agent),使 prompt 可被核对、agent 不再是黑盒。

#### Scenario: 每次 agent 运行留一份含 prompt 的记录
- **WHEN** 任一 agent(节点/续接/heal)运行
- **THEN** 引擎持久化一份运行记录,含完整 prompt、会话转写、握手、归宿、所属运行/节点/成员仓与 SHA,关软件重开仍可查

#### Scenario: 输出框展示完整 prompt
- **WHEN** 用户查看某 agent(含临时 heal agent)的输出框
- **THEN** 界面同时展示喂给该 agent 的完整 prompt,供核对 prompt 是否靠谱

#### Scenario: 自存边跑边落盘
- **WHEN** 一个 agent 运行期间引擎持续增量落盘其会话记录,运行在半路被关闭
- **THEN** 记录含到关闭前为止的内容(非空),可据其排查与(需要时)重建上下文
