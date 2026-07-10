## ADDED Requirements

### Requirement: 规则包数据模型

系统 SHALL 以一份结构化定义表达一个**规则包**（rule pack）——project-goals 四层结构里「规则包」层的实体。一个规则包 MUST 含：唯一 id、可编辑显示名、可选描述、以及一组**带类型的条目**。每个条目 MUST 含包内唯一的条目 id、显示名，并按类型携带内容，类型为以下三者之一（带 kind 判别）：

- **`constitution-rule`（宪法规则）**：一条治理规则的陈述文本（如「测试先行：写实现前先写测试并确认先红后绿」）。供 `project-constitution` 按项目开关、并派生为注入 agent 的公共契约。
- **`output-template`（产出模板）**：一份 markdown 结构骨架（必需的标题/章节），对齐 OpenSpec 的产出模板做法。供工作流产出以 `ref` 引用（见 `workflow-definition`）。
- **`objective-check`（客观门校验）**：一条 CLI 校验命令（如 `openspec validate`，退出码即通过/失败）。供工作流客观门以 `ref` 引用。

规则包与**工作流是 project-goals 里并列的两层**：工作流管编排、规则包管规范。规则包条目被工作流以 `ref` 引用（模板/校验）或被项目按开关套用（宪法）——规则包不内嵌在工作流里。条目 id 一旦发布即视为稳定（被工作流引用、被项目开关记录）。

#### Scenario: 规则包持有三类条目
- **WHEN** 构造一个含 id、显示名、若干 `constitution-rule` / `output-template` / `objective-check` 条目的规则包
- **THEN** 该规则包可被完整保存与读回，各条目的类型、id、显示名与内容均保持

#### Scenario: 条目 id 在包内唯一且稳定
- **WHEN** 校验一个规则包
- **THEN** 其条目 id MUST 在包内唯一；重复条目 id 判为非法

### Requirement: 规则包以「开放包格式」持久化

系统 SHALL 把每个规则包持久化为 Klarit 管理数据目录下的一个**包目录** `userData/rule-packs/<id>/`，**不入 git**，与工作流包（`userData/workflows/<id>/`）并列、机制类比。包内 MUST 含定义文件（如 `rule-pack.yaml`）。**规则包是存储、新建、编辑、删除、导入、导出与（将来）云同步的整体单位**。

`rule-pack.yaml` MUST 是**对外开放的格式**（project-goals 承诺「导入格式 v1 必须开放」）：读入合法 YAML 得到等价定义，导出得到可被再次读入的等价表示（往返一致）。读取损坏或非法的包 MUST 不使应用崩溃，而是跳过该包并可上报。

#### Scenario: 保存写出包目录
- **WHEN** 保存一个规则包
- **THEN** 系统在 `userData/rule-packs/<id>/rule-pack.yaml` 写出定义

#### Scenario: 导入导出往返一致
- **WHEN** 把一个规则包导出再读回
- **THEN** 读回的定义与原定义等价（字段无丢失、条目顺序不变）

#### Scenario: 损坏包不致崩溃
- **WHEN** `userData/rule-packs/` 下存在无法解析或结构非法的包
- **THEN** 系统跳过该包、其余规则包仍正常载入，不抛未捕获异常

### Requirement: 规则包校验

系统 SHALL 在保存或导入规则包前校验其结构：包 id 非空且在库内唯一、显示名非空、条目 id 在包内唯一、每个条目类型合法且其类型内容非空（`constitution-rule` 文本非空 / `output-template` 内容非空 / `objective-check` 命令非空）。校验失败 MUST 阻止写入并返回可读的失败原因。

#### Scenario: 合法规则包通过校验
- **WHEN** 一个所有字段均合规的规则包被保存
- **THEN** 校验通过并写入 YAML 文件

#### Scenario: 条目内容为空被拒
- **WHEN** 某条目（如某 `objective-check`）的内容（命令）为空
- **THEN** 校验失败，定义不被保存，并返回指明该条目非法的原因

### Requirement: 内置默认规则包种子

首次需要时（库为空），系统 SHALL 种入一个**内置默认规则包**作为起点与样例。该默认包 MUST 是一个合法、可被编辑与导出的规则包，且 MUST 至少含若干**宪法规则**条目（对齐 project-goals 列举的「抽象 / 解耦 / 使用者语言 / 测试先行」等），可另含示例产出模板与客观门校验条目。种子 MUST 不覆盖用户已存在的规则包。

#### Scenario: 空库时种入默认规则包
- **WHEN** 规则包库为空且应用初始化规则包能力
- **THEN** 系统写入一个合法的内置默认规则包（至少含「测试先行」等宪法规则条目），使库非空

#### Scenario: 已有规则包时不重复种入
- **WHEN** 库中已存在至少一个规则包
- **THEN** 系统不再种入默认规则包，不覆盖用户数据
