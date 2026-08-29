## ADDED Requirements

### Requirement: 节点列表对含门节点显示门徽标

工作流编辑器的**节点列表**(每行一个节点)SHALL 对**挂了门的节点**显示一个**门徽标**,按门类区分 `manual`/`auto`/`external`,使人工评审/自动校验/外部门等检查点**在列表层一眼可见**,而无需逐个点开节点。徽标 SHALL 从 `node.gate[]` 派生(有几类显示几类),纯展示、不改数据模型,配色用语义令牌(深浅两套)。无门的节点不显示徽标。

#### Scenario: 挂了 manual 门的节点显示徽标

- **WHEN** 节点列表渲染一个 `node.gate` 含 `manual` 门的节点
- **THEN** 该行显示可辨识的门徽标(标出 manual),用户不必点开即知此处有人工检查点

#### Scenario: 多类门都标出

- **WHEN** 某节点同时挂了不同类的门(如 auto + manual)
- **THEN** 徽标按门类分别标出

#### Scenario: 无门节点不显示徽标

- **WHEN** 节点没有任何门(`node.gate` 空/缺)
- **THEN** 该行不显示门徽标
