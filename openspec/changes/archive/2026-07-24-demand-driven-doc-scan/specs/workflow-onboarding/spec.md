## MODIFIED Requirements

### Requirement: 首次导入后按判据为项目落定一份工作流

首次导入(**非 reused**)一个项目、**导入完成后**,系统 SHALL 跑一次工作流 onboarding 判据,并**保证判据结束时项目已有一份活动工作流**(默认或经用户采用的提案),绝不让首次导入的项目停在「无工作流」态。判据对同一项目**至多跑一次**,`reused` 导入(重开已知项目)SHALL 跳过、不覆盖用户已有 `activeWorkflowId`。触发点为**导入完成**,MUST NOT 再以「文档分析返回」为前置——文档扫描不再是 author 的前置步骤(见下「触发理由」需求)。

判据分支:

- **有 agent 习惯痕迹 且 有能跑的默认 agent** → 系统 SHALL 无头触发 author 以系统合成意图产出一份工作流提案,并主动送进全局对话/预览。
- **否则**(无痕迹 / 空新项目 / 未设默认 agent 或其不在已检测 agent 中) → 系统 SHALL 直接把内置默认工作流(本地直合)派为该项目活动工作流。

#### Scenario: 导入完成即触发判据(不等文档扫描)

- **WHEN** 首次导入(非 reused)完成
- **THEN** 系统即触发工作流 onboarding 判据(author 为导入后第一个 agent 任务),不等待文档分析返回

#### Scenario: 老项目有习惯 + 有 agent → 自动 author 提案

- **WHEN** 首次导入的项目某成员仓带 agent 习惯痕迹,且已设一个已检测到的默认 agent
- **THEN** 系统无头触发 author 产出工作流提案主动露出,不派纯默认作最终结果(默认仅作占位)

#### Scenario: 新空项目 / 无能跑 agent → 派默认工作流

- **WHEN** 首次导入的项目无习惯痕迹,或未设可用默认 agent
- **THEN** 系统直接派内置默认工作流(本地直合)为活动工作流,不触发 author

#### Scenario: 重开已知项目 → 跳过判据

- **WHEN** 导入结果 `reused` 为真
- **THEN** 判据整体跳过,项目原有活动工作流不变

### Requirement: 排序理由是 agent 档期串行,不是数据依赖

工作流 onboarding 的触发时机 SHALL 是**导入完成那一刻**(author 成为导入后第一个占用默认 agent 的任务)。文档扫描不再先行——author 自行以 `--add-dir` 探查项目、不依赖文档登记表。系统 MUST NOT 让 author 与文档扫描**并发**占用同一默认 agent:二者对同一 agent 档期 SHALL 串行,且**顺序为 author 先、(如需求驱动触发)文档扫描后**。此为对原「扫描先行、author 后」次序的**翻转**(原次序为让分析 agent 先跑;现因扫描改需求驱动、可能不发生,故 author 提前为第一位)。

#### Scenario: author 先占 agent,扫描(如触发)在后

- **WHEN** 首次导入完成
- **THEN** 系统先跑 author(占默认 agent);若之后需求驱动触发文档扫描,扫描再占同一 agent,二者串行不并发

#### Scenario: 不再以扫描完成为触发前置

- **WHEN** 判断何时触发工作流 onboarding
- **THEN** 以导入完成为准,不以「文档分析返回」为前置(文档扫描已改需求驱动、可能根本不发生)
