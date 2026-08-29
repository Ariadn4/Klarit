## MODIFIED Requirements

### Requirement: 文档扫描/onboarding 改为需求驱动(含 archive-docs 的工作流激活才扫)

因自动 author 现**在生成工作流时直接产出 `archive-docs` 的分类文档配置**(见 `workflow-authoring`「自动 author 被喂项目文档枚举、产出 archive-docs 分类配置」),自动流的 archive-docs 节点**恒带配置、按配置归档**,故**激活时不再触发任何文档扫描/分析 agent**——系统 SHALL **移除**激活工作流时的 demand-driven 文档扫描触发(`activateWorkflow` 里的扫描钩子)。首次导入仍不无条件扫(既有)。

archive-docs 归档**只凭节点自带配置**(author 产出或用户在节点详情里填),无配置即 no-op 不归档、**不再回落登记表**。文档扫描/分析(`analyzeDocuments`)与登记表 store SHALL **保留代码但不再被 archive-docs 消费**(自动流不碰、archive-docs 不回落);设置里手动重扫仍可跑(只是产物无人消费)。整套子系统的彻底移除留待后续单独 change。

#### Scenario: 自动流激活含 archive-docs 工作流 → 不触发扫描

- **WHEN** 采纳/激活一个自动生成的、archive-docs 带 author 配置的工作流
- **THEN** 系统不触发任何文档扫描/分析 agent(配置已随工作流产出)

#### Scenario: 手动重扫仍可跑(产物无人消费)

- **WHEN** 用户在文档登记表设置里点「重扫」
- **THEN** 照常触发扫描(代码保留),但其产物不再被 archive-docs 消费

#### Scenario: 手搭 archive-docs 无配置 → 不归档

- **WHEN** 用户手搭一个含 archive-docs 但无配置的工作流并运行到该节点
- **THEN** 节点作 no-op 不归档,不回落登记表
