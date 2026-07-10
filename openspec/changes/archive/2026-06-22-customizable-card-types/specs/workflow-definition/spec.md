## ADDED Requirements

### Requirement: 工作流声明建议类型

工作流定义 MAY 含一个可选字段 **`suggestedTypes`**：一组**建议的需求卡类型**（每项形如 `card-type-registry` 的 `CardTypeDef`，`container` 与 `leaf` 原型皆可——工作流可带自己的容器与流通类型），表达"用这条工作流的项目通常需要哪些类型"。该字段 MUST 为可选——未声明的工作流（含旧工作流包）照常加载、行为不变（迁移幂等）。项目激活该工作流时，引擎据此把建议类型**播种**进项目类型注册表（幂等、不覆盖已有，见 `card-type-registry`「工作流激活播种建议类型」）。内置默认工作流 SHALL 自带默认类型（epic/feature/bug）作为 `suggestedTypes`。

#### Scenario: 工作流声明建议类型（含容器与子叶）
- **WHEN** 一个工作流定义声明了 `suggestedTypes`（含 container 与 leaf 类型）并被读回
- **THEN** 该字段完整保留，每项类型定义（含其 archetype）不变

#### Scenario: 未声明建议类型的工作流照常加载
- **WHEN** 加载一个不含 `suggestedTypes` 的工作流（如旧工作流包）
- **THEN** 工作流正常加载、校验通过，行为与未引入该字段时一致

#### Scenario: 默认工作流自带默认类型
- **WHEN** 读取内置默认工作流
- **THEN** 其 `suggestedTypes` 含 epic/feature/bug，激活时把它们播种进项目
