## ADDED Requirements

### Requirement: 列出工作流

系统 SHALL 提供列出工作流库中全部工作流定义的能力，每条至少含 id 与显示名，供渲染层展示与选择。该能力 MUST 经 IPC 暴露给渲染层。损坏文件不计入列表（见 `workflow-definition` 的损坏处理）。

#### Scenario: 列出库内工作流
- **WHEN** 渲染层请求工作流列表
- **THEN** 系统返回库中全部合法工作流的 id 与显示名

### Requirement: 新建工作流

用户 SHALL 能新建一个工作流。新建 MUST 基于内置默认模板生成一个合法的线性工作流，分配唯一 id 与默认显示名，并写入库（创建包目录 `userData/workflows/<id>/` 及其 `workflow.yaml`）。

#### Scenario: 新建得到合法工作流
- **WHEN** 用户触发「新建工作流」
- **THEN** 系统创建一个基于默认模板、含唯一 id 的合法工作流并加入库，随后出现在列表中

### Requirement: 克隆工作流

用户 SHALL 能克隆一个已存在的工作流，得到内容相同、id 唯一、显示名带可区分后缀的新工作流。克隆 MUST **复制整个包**（含 `workflow.yaml` 与全部 skill 文件），且 MUST 不改动源工作流。

#### Scenario: 克隆产生独立副本
- **WHEN** 用户克隆某工作流
- **THEN** 系统生成一个新 id 的副本包（含其 skill 文件、内容一致、名称可区分），源工作流保持不变

### Requirement: 删除工作流

用户 SHALL 能删除工作流，移除其**整个包目录**（含 `workflow.yaml` 与 skill 文件）。删除一个**正被某项目激活**的工作流前，系统 MUST 先处理该引用（见 `project-registry`：清除或改投激活指针），不得遗留指向已删除工作流的悬挂引用。

#### Scenario: 删除移除包目录
- **WHEN** 用户删除某未被任何项目激活的工作流
- **THEN** 系统删除其整个包目录，该工作流不再出现在列表中

#### Scenario: 删除被激活工作流先解引用
- **WHEN** 用户删除一个正被某项目激活的工作流
- **THEN** 系统在删除前清除或改投受影响项目的激活指针，删除后无项目仍指向它

### Requirement: 导入与导出工作流

用户 SHALL 能导入一个外部工作流并把库中工作流导出，**以整个包为单位**（含 `workflow.yaml` 与其 skill 文件），从而保持自包含、可移植。导入 MUST 经校验后加入库，必要时分配新 id 以避免冲突；导入非法或结构不符的包 MUST 被拒绝并给出原因，不污染库。

#### Scenario: 导入合法工作流包
- **WHEN** 用户导入一个结构合法的工作流包
- **THEN** 系统校验通过后将整个包（含 skill 文件）加入库，并在列表中可见

#### Scenario: 导入非法工作流被拒
- **WHEN** 用户导入一个无法解析或结构不符的工作流
- **THEN** 系统拒绝导入并返回可读原因，库内容不变

#### Scenario: 导出工作流包
- **WHEN** 用户导出某工作流到指定位置
- **THEN** 系统写出含 `workflow.yaml` 与全部 skill 文件、可被再次导入的等价包

### Requirement: 工作流内的 skill 文件管理

工作流编辑期间，用户 SHALL 能为某 agent 节点的 `file` 形态驱动指令提供 skill 文件，两种方式皆 MUST 把文件落入该工作流包内并记录相对包路径：

- **新建**：在编辑器内直接撰写 skill 内容，保存为包内的 markdown 文件。
- **导入**：选中一个外部文件，将其**拷贝**进包（而非原地引用外部路径）。

当某 `file` 引用被移除或改为 `inline` 时，系统 MAY 清理不再被引用的包内 skill 文件；任何情况下 MUST 不留下指向包外的引用。

#### Scenario: 新建 skill 文件落入包内
- **WHEN** 用户为某 agent 节点新建一份 skill 并保存
- **THEN** 系统在该工作流包内写出对应 markdown 文件，节点以相对包路径引用它

#### Scenario: 导入 skill 文件拷入包内
- **WHEN** 用户为某 agent 节点选中一个外部 skill 文件
- **THEN** 系统将该文件拷贝进工作流包，节点以相对包路径引用包内副本，原外部文件不被依赖
