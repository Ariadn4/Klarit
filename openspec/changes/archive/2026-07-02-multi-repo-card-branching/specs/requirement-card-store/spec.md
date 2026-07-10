## RENAMED Requirements

- FROM: `### Requirement: 从卡派生运行请求(单仓先跑通)`
- TO: `### Requirement: 从卡派生运行请求(多仓扇出)`

## MODIFIED Requirements

### Requirement: 从卡派生运行请求(多仓扇出)

系统 SHALL 提供从一张需求卡**派生引擎运行请求**的逻辑:`branch` = 卡预取名(slug)、`workflowId` = 该卡所属项目的激活工作流、`cardId` = 卡 id;**仓库上下文取卡 `repos` 的全部涉及仓**(不再只取首仓)。派生结果 MUST 表达为**单个运行**绑该卡、其涉及仓集合为 `card.repos`(一卡一运行,由引擎在运行内对成员仓扇出,见 `engine-execution`);同名 slug 分支跨所有涉及仓。卡 `repos` 为空或激活工作流缺失时 MUST NOT 派生一个无效运行,而是返回可读原因(供卡上「运行」按钮禁用或提示)。

#### Scenario: 单仓卡派生运行请求
- **WHEN** 对一张 `repos` 恰含一个仓、所属项目有激活工作流的卡派生运行请求
- **THEN** 得到绑该卡的单个运行请求(`repos` = 该唯一仓、`branch` = 卡预取名、`cardId` = 卡 id、`workflowId` = 项目激活工作流),行为等价今日单仓

#### Scenario: 多仓卡派生一个扇出运行
- **WHEN** 对一张 `repos` 含多个仓的卡派生运行请求
- **THEN** 派生**单个**绑该卡的运行请求,其涉及仓集合为全部 `repos`;引擎在该运行内对各成员仓扇出(不为每仓拆多个运行)

#### Scenario: 缺前置条件时不派生无效运行
- **WHEN** 对一张 `repos` 为空或所属项目无激活工作流的卡派生运行请求
- **THEN** 不产生运行请求,返回可读原因
