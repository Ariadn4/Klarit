## ADDED Requirements

### Requirement: archive-docs 消费 author 产出的分类文档配置(免独立扫描)

`archive-docs` 引擎操作 SHALL 支持节点携带一份 author 产出的**分类文档配置**——每条 `{ path: string; kind: 'dynamic' | 'snapshot' }`（`dynamic`＝只记最新现状、就地更新；`snapshot`＝冻结记录、只追加,沿用 `ManagedDoc.kind` 语义）。归档执行时:

- 节点**带配置** → `runArchiveDocsNode` **按此配置归档**（委派 agent:动态就地更新 / 快照追加,`writableScope` 限于配置里的路径），MUST NOT 读扫描登记表、MUST NOT 触发文档分析 agent。
- 节点**无配置** → **不归档**（no-op,节点照常收尾）;**不再回落**扫描登记表。归档全凭节点自带的配置(author 产出或用户在节点详情里填)。

因归档配置随工作流产出/编辑而定 → 归档**不跑独立文档 agent、不扫描、不依赖登记表**。

#### Scenario: 节点带分类配置 → 按配置归档、不扫描

- **WHEN** `archive-docs` 节点携带 `[{path,kind}]` 配置
- **THEN** 系统按 kind 归档(动态就地更新 / 快照追加)、`writableScope` 限该配置路径,不读登记表、不触发文档分析 agent

#### Scenario: 节点无配置 → 不归档(no-op)

- **WHEN** `archive-docs` 节点未带配置
- **THEN** 节点作 no-op 照常收尾(不归档任何文档),不回落读扫描登记表
