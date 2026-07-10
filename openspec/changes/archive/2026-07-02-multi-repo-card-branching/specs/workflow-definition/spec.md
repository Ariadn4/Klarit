## ADDED Requirements

### Requirement: 工作流节点的目标仓选择字段

`WorkflowNode` SHALL 支持一个可选的 `target` 字段(目标仓选择,判别联合),取值为 `all` / `tag`(带 `tag`) / `repo`(带 `memberId`) / `fromUpstream`(带上游节点 id)四种之一。校验 SHALL:`tag` 形态的标签名非空;`repo` 形态的 `memberId` 非空;`fromUpstream` 形态引用的上游节点必须在本节点之前且为 agent 节点。`target` 缺省(未声明)合法,语义为「全体成员仓」。

#### Scenario: 合法 target 通过校验
- **WHEN** 一个引擎节点声明 `target={tag:'后端'}`
- **THEN** 工作流校验通过

#### Scenario: target 字段缺省合法
- **WHEN** 一个引擎节点未声明 `target`
- **THEN** 工作流校验通过,语义等价于全体成员仓

#### Scenario: fromUpstream 引用非 agent 或后置节点不通过
- **WHEN** 一个节点 `target=fromUpstream` 引用一个非 agent 节点,或引用一个排在其后的节点
- **THEN** 工作流校验失败并给出原因

### Requirement: agent 节点的结构化输出通道

agent 执行者 SHALL 除既有 markdown 文件产出外,支持声明一个**结构化输出**(至少含「涉及哪些成员仓」的判定),供下游 `target=fromUpstream` 节点消费。该结构化输出 MUST 可被引擎持久化进运行断点以保证恢复稳定。校验 SHALL 确保被 `fromUpstream` 引用的 agent 节点确有声明结构化输出。

#### Scenario: agent 节点声明结构化涉及仓输出
- **WHEN** 一个 agent 节点声明结构化输出含「涉及仓」字段
- **THEN** 校验通过,且其输出可被下游 `fromUpstream` 节点引用

#### Scenario: 被引用的 agent 节点未声明结构化输出
- **WHEN** 某 `fromUpstream` 节点引用的 agent 节点只产 markdown、未声明结构化输出
- **THEN** 工作流校验失败并给出原因
