## RENAMED Requirements

- FROM: `### Requirement: Agent 驱动指令的两种形态`
- TO: `### Requirement: Agent 驱动指令的三种形态`

## MODIFIED Requirements

### Requirement: Agent 驱动指令的三种形态

`agent` 执行者的驱动指令 SHALL 以一个**带 kind 的判别联合**表达，支持三种形态：

- `inline`：prompt 文本**内联**存于工作流定义中（自包含、可移植）。
- `file`：指向一份 skill/prompt markdown 文件的**相对路径**，该路径**相对于工作流包目录**解析（禁绝对路径、禁 `..`，同产出路径的约束）。被引用的文件 MUST **物理位于工作流包内**（新建即写入包，导入即拷入包），使工作流自包含、随包整体搬运。这是「用户设进包的外部技能文件」。
- `installed`：引用用户的编程 CLI 里**已安装**的技能，以其**调用名**（`name`）标识（如 `opsx:explore`）。Klarit MUST NOT 嵌入其内容或指向本地路径——运行时由 CLI 自己按名调用该技能；`name` 非空即合规。这是「引用即用的已装技能」。

每个 agent 节点的驱动指令 MUST 恰为这三种形态之一。本能力存储 kind、（file 形态的）合规相对路径、（installed 形态的）非空调用名并参与校验，并保证 file 引用文件落在包内；**内容/技能在执行期的读取与调用不在本能力范围**，交由执行引擎定义（installed 形态：让 CLI 调该已装技能；无该机制的 CLI 回落把「请使用你已安装的 `<name>` 技能」并入 prompt）。

#### Scenario: 内联 prompt 往返保持

- **WHEN** 某 agent 节点以 `inline` 形态声明 prompt 文本并保存后读回
- **THEN** 该 prompt 文本完整保留在定义中

#### Scenario: 文件引用存为包内相对路径

- **WHEN** 某 agent 节点以 `file` 形态引用一份 skill 文件
- **THEN** 定义保存相对工作流包的路径、且该文件位于包内；若路径为绝对路径或含 `..`，校验失败、不被保存

#### Scenario: 已装技能存调用名、不嵌入内容

- **WHEN** 某 agent 节点以 `installed` 形态引用一个已装技能（给出调用名，如 `opsx:explore`）
- **THEN** 定义只保存该调用名，不嵌入技能内容、不带任何本地路径；空调用名校验失败、不被保存

#### Scenario: 旧包只含两形态不受影响

- **WHEN** 读一个只用 `inline`/`file` 的旧工作流包
- **THEN** 照常读回，判别联合扩展不破坏旧数据
