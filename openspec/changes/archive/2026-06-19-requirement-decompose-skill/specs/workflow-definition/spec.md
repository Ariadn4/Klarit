## ADDED Requirements

### Requirement: 工作流的「新建需求」分解指令

工作流定义 SHALL 可携带一份**可选的「新建需求」驱动指令**，用于把用户对该工作流提交的一大段自由描述分解成多张需求卡（见 `requirement-decomposition`）。该指令 MUST 沿用 `agent` 节点驱动指令的**带 kind 判别联合**两态：

- `inline`：分解 prompt 文本内联存于工作流定义中（自包含、可移植）。
- `file`：指向工作流包内一份 skill/prompt markdown 文件的**相对包路径**（禁绝对路径、禁 `..`，被引用文件物理位于包内，同节点 file 指令的约束）。

该字段为**可选**：未声明时该工作流不提供专属分解 prompt（分解回落到全局默认分解 skill，见 `requirement-decomposition`）。声明时其形态校验 MUST 与 agent 节点驱动指令一致：`inline` 要求文本为字符串、`file` 要求合规包内相对路径。本字段的增加为**向后兼容的可选扩展**，不破坏既有工作流的读写往返。

#### Scenario: 内联新建需求 prompt 往返保持
- **WHEN** 某工作流以 `inline` 形态声明「新建需求」prompt 文本并保存后读回
- **THEN** 该 prompt 文本完整保留在定义中

#### Scenario: 文件形态新建需求 prompt 存为包内相对路径
- **WHEN** 某工作流以 `file` 形态为「新建需求」指令引用一份包内 skill 文件
- **THEN** 定义保存相对包路径、该文件位于包内；若路径为绝对路径或含 `..`，校验失败、不被保存

#### Scenario: 未声明新建需求指令仍合法
- **WHEN** 某工作流未声明「新建需求」指令并保存
- **THEN** 定义合法、可读回，不因缺省该可选字段判为非法

#### Scenario: 非法新建需求指令被拒
- **WHEN** 某工作流的「新建需求」指令形态非法（既非合法 inline 也非合法 file）
- **THEN** 结构校验失败、定义不被保存，并返回可读原因
