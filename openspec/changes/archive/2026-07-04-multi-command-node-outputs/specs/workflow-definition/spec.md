## ADDED Requirements

### Requirement: command 执行者声明一条或多条命令

`command` 执行者 SHALL 以 `commands: CommandSpec[]` 声明**一条或多条**待执行命令,每条 `CommandSpec` 为 `{ label?, command, check?, timeoutSec? }`:`command` 为待执行 CLI 命令字符串,`label` 为可选展示标签(缺省回落命令行文本,用于 UI 分格标题与转后台 label),`check`/`timeoutSec` 为该条命令各自的前置检查与超时(见对应要求)。

校验 SHALL:`commands` MUST 为**非空数组**(至少一条命令);每条 `command` 字符串 MUST **非空**;`label` 若声明可为任意非强制文本。命令是否在某机器上可成功执行**不在校验内强制**(属引擎运行期),命令串不施加产出/可写范围那样的相对路径约束。

**向后兼容**:既有工作流包的旧单命令形状(执行者直接带 `command`/`check`/`timeoutSec`)在反序列化时 SHALL 被归一为 `commands: [{ command, check?, timeoutSec? }]`;序列化写新形状。对新形状幂等。

#### Scenario: 声明多条命令往返保持
- **WHEN** 某 `command` 节点声明 `commands` 为两条(各含命令行、可选标签/前置检查/超时)并保存后读回
- **THEN** 两条命令及其字段完整保留在定义中

#### Scenario: 空命令列表被拒
- **WHEN** 某 `command` 节点的 `commands` 为空数组,或其中某条 `command` 字符串为空
- **THEN** 结构校验失败、定义不被保存,并返回指明命令为空的原因

#### Scenario: 旧单命令形状迁移归一
- **WHEN** 加载一个旧形状(执行者直接带 `command`,无 `commands`)的 `command` 节点工作流包
- **THEN** 该节点被归一为 `commands: [{ command, ... }]`,合法可读回,行为与单命令一致;再次保存写新形状

## MODIFIED Requirements

### Requirement: command 执行者的前置检查命令

`command` 执行者的**每条命令**(`commands[]` 中的 `CommandSpec`)SHALL 各支持一条可选**前置检查命令**(`check`):一个 CLI 命令字符串,表达「本条命令是否已完成」的探测(退出码 0=已完成)。该字段供引擎在执行该条主命令前做 reconcile-by-probe(见 `engine-execution`「命令节点的前置检查护栏」),让不幂等命令在中断恢复时不重复执行。每条命令 MAY 不声明该字段。

该字段为**可选**且为**向后兼容增量**:未声明 `check` 的命令(含既有工作流包迁移而来的命令)照常加载、行为不变、读写往返一致。声明时其结构校验为:`check` 命令字符串 MUST 非空(同 `inline` 客观门把命令的约束);命令是否在某机器上可成功执行**不在校验内强制**(属引擎运行期)。`check` 与主命令 `command` 一样为待执行的 CLI 串,不施加相对路径约束。

#### Scenario: 声明前置检查命令往返保持
- **WHEN** 某 `command` 节点某条命令声明 `check` 并保存后读回
- **THEN** 该条命令的 `check` 命令字符串完整保留在定义中

#### Scenario: 未声明前置检查的命令照常合法
- **WHEN** 加载/保存一条未声明 `check` 的命令(含既有工作流包)
- **THEN** 定义合法、可读回,行为与未引入该字段时一致

#### Scenario: 空前置检查命令被拒
- **WHEN** 某条命令声明了 `check` 但其命令字符串为空
- **THEN** 结构校验失败、定义不被保存,并返回指明 `check` 命令为空的原因

### Requirement: 每条命令的可选超时字段

工作流定义中**每一处被执行的命令** SHALL 支持一个可选**超时秒数**(`timeoutSec`):`command` 执行者 `commands[]` 中的**每条命令**、客观(`auto`)门把项、人工门把的动作按钮各可携带 `timeoutSec`。该字段为**可选**且为**向后兼容增量**——未声明即无超时(全局默认无超时),既有工作流包照常加载、读写往返一致。声明时其结构校验为:`timeoutSec` MUST 为**正数**(`> 0`);非正数或非数值判为非法。该超时为每条命令独立(同节点内不同命令、及客观门可设不同值),`ref` 形态客观门的超时落在**门把使用点**而非规则库条目。

#### Scenario: 声明超时往返保持
- **WHEN** 某命令节点某条命令(或客观门、动作)声明 `timeoutSec` 并保存后读回
- **THEN** 该超时值完整保留在定义中

#### Scenario: 未声明超时照常合法
- **WHEN** 加载/保存一处未声明 `timeoutSec` 的命令(含既有工作流包)
- **THEN** 定义合法、可读回,视为无超时,行为与未引入该字段时一致

#### Scenario: 非正数超时被拒
- **WHEN** 某处命令声明的 `timeoutSec` 为 0、负数或非数值
- **THEN** 结构校验失败、定义不被保存,并返回指明超时须为正数的原因
