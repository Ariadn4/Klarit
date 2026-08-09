## ADDED Requirements

### Requirement: archive-docs 节点详情展示/编辑归档文档配置

工作流编辑器的**节点详情**视图,对**引擎操作为 `archive-docs`** 的节点 SHALL 展示并允许编辑其 `executor.archiveDocs` 归档文档配置——每条为 `{ path, kind: 'dynamic' | 'snapshot' }`:一行一条,含路径输入 + 动态/快照选择,可增删。这样 author 产出的(或用户手改的)归档清单**可见可改**。非 archive-docs 节点不显示该块。空配置时显示"尚未指定要归档的文档"之类提示(**不提登记表**——已不再回落)。说明文案讲清动态/快照规则。配色用语义令牌。

#### Scenario: archive-docs 节点显示归档文档清单

- **WHEN** 在节点详情打开一个引擎操作 `archive-docs` 的节点,其 `executor.archiveDocs` 有若干 `{path,kind}`
- **THEN** 逐条展示路径 + 动态/快照,且可编辑(改路径/切 kind/增删)

#### Scenario: 非 archive-docs 不显示该块

- **WHEN** 打开一个非 archive-docs 节点
- **THEN** 不显示归档文档清单块

#### Scenario: 空配置给提示

- **WHEN** archive-docs 节点无 `executor.archiveDocs`
- **THEN** 显示空态提示「尚未指定要归档的文档」(不提登记表),而非什么都不显示
