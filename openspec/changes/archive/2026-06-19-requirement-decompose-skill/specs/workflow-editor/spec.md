## ADDED Requirements

### Requirement: 编辑工作流的「新建需求」分解 prompt

工作流编辑界面 SHALL 为每个工作流提供其**「新建需求」分解 prompt** 的编辑入口（工作流级，区别于各节点的 agent prompt）。该编辑 MUST 提供与 agent 节点驱动指令一致的「**手写 / 使用文件**」二选一切换：

- **手写**：呈现多行文本输入，存为 `inline` 形态。
- **使用文件**：指向工作流包内一份 markdown skill 文件；**未选定文件时只展示「新建」「导入」两个按钮**（不展示路径输入框），**选定后只展示文件名**、点击文件名可查看内容、可移除以重新选择——与节点 prompt 的「使用文件」体验完全一致（复用既有包内文件管理控件）。

该「新建需求」prompt 为**可选**：用户可不声明（保存后该工作流无专属分解 prompt）。保存 MUST 经 `workflow-definition` 的校验；非法（如 file 形态路径越界）MUST 阻止保存并提示原因。编辑界面 MUST 遵循品牌规范（`docs/brand`）与 `index.css` 的 `@theme` 设计令牌、支持深浅双主题、仅用语义令牌。

#### Scenario: 手写新建需求 prompt 并保存
- **WHEN** 用户在某工作流的「新建需求」prompt 选「手写」、填入文本并保存
- **THEN** 该 prompt 以 `inline` 形态随工作流保存，读回时文本保留

#### Scenario: 使用文件时新建或导入 skill
- **WHEN** 用户为「新建需求」prompt 选「使用文件」并新建或导入一份 skill 文件
- **THEN** 文件落入工作流包，编辑界面只显示文件名（不显示相对路径），底层以相对包路径记录，体验与节点 prompt 一致

#### Scenario: 不声明新建需求 prompt
- **WHEN** 用户不为某工作流声明「新建需求」prompt 并保存
- **THEN** 保存成功，该工作流无专属分解 prompt（分解时回落全局默认分解 skill）

#### Scenario: 非法新建需求 prompt 阻止保存
- **WHEN** 用户为「新建需求」prompt 选「使用文件」并键入越界路径（绝对路径或含 `..`）
- **THEN** 编辑界面标示该路径非法、阻止保存，直至改为合规相对路径
