## ADDED Requirements

### Requirement: 文档语义分析完成发出可链接的完成信号

文档语义分析在**主进程完成返回**时,系统 SHALL 发出一个可供其他主进程流程链接的**完成信号**(表征分析 agent 已释放档期),供 `workflow-onboarding` 判据据此触发。该信号 SHALL 在**主进程分析返回处**产生,MUST NOT 依赖用户在文档 onboarding dialog 里的保存/确认动作——分析返回即算「扫描结束、agent 腾出」。信号 SHALL 携带足以定位对应项目/成员的标识。

#### Scenario: 分析返回即发信号

- **WHEN** 主进程文档语义分析对某成员返回结果
- **THEN** 系统发出完成信号,不等待用户在 dialog 里保存

#### Scenario: 用户未保存也算完成

- **WHEN** 分析已返回但用户尚未点保存或直接关闭了 dialog
- **THEN** 完成信号已发出,后续 `workflow-onboarding` 判据可据此进行
