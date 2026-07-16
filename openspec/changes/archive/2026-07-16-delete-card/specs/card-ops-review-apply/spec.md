## MODIFIED Requirements

### Requirement: 卡操作提案的审阅呈现

系统 SHALL 把编排核产出的**卡操作提案**（`OrchestrationProposal.ops`）以**审阅**形态呈现，泛化自现有 decompose「审阅候选→落库」流：不再只列候选卡，而以**操作预览（diff 感）**逐条呈现每个 op 的效果——「建 X」「把 A、B 并成 C」「把 D 拆成 D1/D2」「给 E 加 blocked_by F」「删 X」。每条 op SHALL 前置一个**勾选框**供用户**选择应用哪些**（合法项默认勾选）；`create` op SHALL 展示其**卡描述**（**markdown 渲染**、默认折叠可展开），agent 回复亦 **markdown 渲染**（非源码）。应用时 SHALL 只应用**勾选的**合法 op。审阅 UI SHALL 遵 `docs/brand` 与设计令牌（仅语义令牌、深浅双主题）。

#### Scenario: ops 以操作预览 + 卡描述呈现

- **WHEN** 编排核产出一组含 create/merge/split/relate/delete 的提案
- **THEN** 审阅界面逐条呈现每个 op 的效果预览（含 delete 的「删 X」），create 卡另显其 markdown 描述（可展开），用户应用前可看清将改什么

#### Scenario: 勾选选择应用哪些

- **WHEN** 用户取消勾选某些卡
- **THEN** 应用时只落库勾选中的卡；全不勾时应用按钮禁用（提示用户勾选）

### Requirement: 破坏性操作二次确认

系统 SHALL 对**破坏性 op**（`merge`、`split`、`delete` 删卡）施以比非破坏性 op **更足的确认力度**：应用前须经用户明确二次确认，确认提示 MUST 交代该 op 将删除/合并哪些卡。非破坏性 op（create、纯 adjust、加边 relate）无需额外二次确认。

#### Scenario: 合并前二次确认

- **WHEN** 提案含一个 merge（将删除被并卡）
- **THEN** 应用前弹出二次确认、交代将合并/删除哪些卡，用户确认后才应用

#### Scenario: 删卡前二次确认

- **WHEN** 提案含一个 `delete`（将删除卡 X）
- **THEN** 应用前弹出二次确认、交代将删除卡 X，用户确认后才经 `applyOps` → `cardStore.remove` 删卡

#### Scenario: 非破坏性 op 无需二次确认

- **WHEN** 提案只含 create 与加边 relate
- **THEN** 用户在常规审阅确认后即可应用，无额外二次确认
