## ADDED Requirements

### Requirement: 全局对话承载自动产出的工作流提案并可被主进程驱动打开

系统 SHALL 让**自动(导入后)产出的工作流提案**作为一条 `role:'agent'` 消息进入本项目全局对话,复用现有 `WorkflowProposalReview` 渲染(含「预览草稿」入口);用户 SHALL 能用对话输入框反馈,触发正常改写轮迭代该提案。为此,渲染层 SHALL 能被一条**主进程推送**驱动:**打开/聚焦对话面板**、**选中并重新拉取**承载该提案的会话、滚动到该消息——因为主进程后台追加会话消息时渲染层不会自动刷新(无 `conversationChanged` 广播)。

#### Scenario: 自动提案在对话里可预览可反馈

- **WHEN** 主进程把自动产出的提案作为 agent 消息追加进某会话并推送渲染层
- **THEN** 渲染层打开对话面板、选中并刷新该会话、显示提案(可「预览草稿」),用户可在输入框反馈让 AI 改写

#### Scenario: 后台追加消息经推送刷新

- **WHEN** 主进程在渲染层未主动请求时向会话追加了消息
- **THEN** 系统经该推送使渲染层重取该会话内容(不依赖用户手动切换会话才看见)

### Requirement: 移除项目须清除其对话历史

移除一个项目时,系统 SHALL 一并清除该项目**按 projectId 作用域**的全局对话与卡对话历史(`conversationStore` 与 `cardConversationStore`),不留孤儿会话数据。为此对话存储 SHALL 提供**按 scope 整体清除**的能力(如 `removeScope(projectId)`),`removeProject` 流程 SHALL 调用它(与既有 `documentStore` 清理并列)。

#### Scenario: 移除项目连带清对话

- **WHEN** 用户移除一个项目
- **THEN** 该项目的全局对话与卡对话历史一并被清除,不残留孤儿会话

#### Scenario: 只清被移除项目的会话

- **WHEN** 移除项目 A
- **THEN** 仅清 A 作用域的会话,其它项目的会话不受影响
