## ADDED Requirements

### Requirement: 文档扫描/onboarding 改为需求驱动(含 archive-docs 的工作流激活才扫)

因文档登记表运行时**只被 `archive-docs` 引擎操作消费**,系统 SHALL 把文档扫描/onboarding 的触发改为**需求驱动**:MUST NOT 在首次导入时无条件跑扫描/弹 onboarding;而在**一个含 `archive-docs` 节点的工作流成为项目活动工作流**、且该项目**尚无文档登记表**时,SHALL 触发文档扫描/onboarding 去 populate 登记表。判「工作流是否含 archive-docs」为纯结构(存在 `executor.kind==='engine' && operation==='archive-docs'` 的节点)。所有工作流激活路径(采纳自动提案 / 聊天产出 / 设置选定 / 兜底默认)SHALL 走同一收口(`setActiveWorkflow`)统一判定。兜底默认(本地直合)不含 archive-docs,故常见路径**免扫**。用户仍可经设置**手动重扫**(不受需求驱动限制)。

#### Scenario: 激活含 archive-docs 工作流且无登记表 → 触发扫描

- **WHEN** 一个含 `archive-docs` 节点的工作流被设为项目活动工作流,且该项目尚无文档登记表
- **THEN** 系统触发文档扫描/onboarding 去 populate 登记表

#### Scenario: 工作流不含 archive-docs → 不扫

- **WHEN** 被激活的工作流(如兜底默认、或用 `opsx:archive` 的 opsx 流)不含引擎 `archive-docs` 节点
- **THEN** 系统不触发文档扫描

#### Scenario: 已有登记表 → 不重复扫

- **WHEN** 激活含 archive-docs 的工作流,但项目已有文档登记表
- **THEN** 不重复触发扫描(已 populate)

#### Scenario: 首次导入不再无条件扫

- **WHEN** 首次导入一个项目
- **THEN** 系统不再无条件弹文档 onboarding / 跑 analyze;是否扫由后续「工作流激活」需求驱动决定

#### Scenario: 手动重扫保留

- **WHEN** 用户在文档登记表设置里点「重扫」
- **THEN** 照常触发扫描,不受需求驱动限制
