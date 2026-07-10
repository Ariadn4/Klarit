## MODIFIED Requirements

### Requirement: 规则包数据模型

系统 SHALL 以一份结构化定义表达一个**规则包**（rule pack）——project-goals 四层结构里「规则包」层的实体。一个规则包 MUST 含：唯一 id、可编辑显示名、可选描述、以及一组**带类型的条目**。每个条目 MUST 含包内唯一的条目 id、显示名，并按类型携带内容，类型为以下三者之一（带 kind 判别）：

- **`constitution-rule`（宪法规则）**：一条治理规则的陈述文本（如「测试先行：写实现前先写测试并确认先红后绿」）。供 `project-constitution` 按项目开关、并派生为注入 agent 的公共契约。
- **`output-template`（产出模板）**：一份 markdown 结构骨架（必需的标题/章节），对齐 OpenSpec 的产出模板做法。供工作流产出以 `ref` 引用（见 `workflow-definition`）。
- **`objective-check`（客观门校验）**：一条 CLI 校验命令（如 `openspec validate`，退出码即通过/失败）。供工作流客观门以 `ref` 引用。

规则包里**面向用户的文本字段**——包显示名、包描述、条目显示名、`constitution-rule` 正文、`output-template` 内容——MUST 表示为**逐字段语言表**（`Localized`，见 `rule-pack-localization`），承载可选的多语言译文。**结构字段**——条目 id、kind、`objective-check` 命令、引用 `ref`、各类路径——MUST 保持**单值**、跨语言逐字相同，不参与按语言解析。

规则包与**工作流是 project-goals 里并列的两层**：工作流管编排、规则包管规范。规则包条目被工作流以 `ref` 引用（模板/校验）或被项目按开关套用（宪法）——规则包不内嵌在工作流里。条目 id 一旦发布即视为稳定（被工作流引用、被项目开关记录）。

#### Scenario: 规则包持有三类条目
- **WHEN** 构造一个含 id、显示名、若干 `constitution-rule` / `output-template` / `objective-check` 条目的规则包
- **THEN** 该规则包可被完整保存与读回，各条目的类型、id、显示名与内容均保持

#### Scenario: 条目 id 在包内唯一且稳定
- **WHEN** 校验一个规则包
- **THEN** 其条目 id MUST 在包内唯一；重复条目 id 判为非法

#### Scenario: 可翻字段承载语言表、结构字段保持单值
- **WHEN** 一个规则包的条目显示名/正文以语言表承载多语言，而条目 id 与命令为单值
- **THEN** 保存读回后语言表各语言条目保持，结构字段仍为单值且跨语言一致

### Requirement: 规则包校验

系统 SHALL 在保存或导入规则包前校验其结构：包 id 非空且在库内唯一、条目 id 在包内唯一、每个条目类型合法。对**可翻字段**（包显示名、条目显示名、`constitution-rule` 正文、`output-template` 内容），校验 MUST 要求其语言表**至少含一种非空语言条目**（视为"有内容"）；对**结构字段**（`objective-check` 命令等），校验 MUST 要求其单值非空。校验失败 MUST 阻止写入并返回可读的失败原因。

#### Scenario: 合法规则包通过校验
- **WHEN** 一个所有字段均合规（每个可翻字段至少一种非空语言、每个结构字段非空）的规则包被保存
- **THEN** 校验通过并写入 YAML 文件

#### Scenario: 可翻字段无任何语言被拒
- **WHEN** 某 `constitution-rule` 的正文语言表为空（无任何非空语言条目）
- **THEN** 校验失败，定义不被保存，并返回指明该条目内容为空的原因

#### Scenario: 结构字段为空被拒
- **WHEN** 某 `objective-check` 的命令为空
- **THEN** 校验失败，定义不被保存，并返回指明该条目非法的原因

### Requirement: 内置默认规则包种子

首次需要时（库为空），系统 SHALL 种入一个**内置默认规则包**作为起点与样例。该默认包 MUST 是一个合法、可被编辑与导出的规则包，且 MUST 至少含若干**宪法规则**条目（对齐 project-goals 列举的「抽象 / 解耦 / 使用者语言 / 测试先行」等），可另含示例产出模板与客观门校验条目。默认包的**可翻字段 MUST 至少提供 `zh` 与 `en` 两种语言**的等价文案；不同语言下条目的 id、kind、命令等**结构字段 MUST 逐字相同**，只有文案不同。种子 MUST 不覆盖用户已存在的规则包。

#### Scenario: 空库时种入双语默认规则包
- **WHEN** 规则包库为空且应用初始化规则包能力
- **THEN** 系统写入一个合法的内置默认规则包，其宪法规则等可翻字段同时含 `zh` 与 `en` 文案，库变为非空

#### Scenario: 默认包跨语言结构一致
- **WHEN** 比较默认包在 `zh` 与 `en` 下解析出的条目
- **THEN** 条目数量、顺序、各条目 id/kind 与命令逐字相同，仅名称与正文随语言不同

#### Scenario: 已有规则包时不重复种入
- **WHEN** 库中已存在至少一个规则包
- **THEN** 系统不再种入默认规则包，不覆盖用户数据

## ADDED Requirements

### Requirement: 读旧单语言规则包向后兼容

读入 `rule-pack.yaml` 时，遇到旧的**裸字符串**可翻字段（包名/描述、条目名、宪法正文、模板内容）MUST 归一为语言表（`{ zh: 值 }`），使旧的单语言规则包在新模型下不崩、显示为该语言；`objective-check` 命令等结构字段保持单值。对已是多语言的新形状 MUST 幂等（读回不变）。

#### Scenario: 旧单语言包读入 upcast 不崩
- **WHEN** 读入一个 `name`/`text` 等为裸字符串（旧格式）的 `rule-pack.yaml`
- **THEN** 各可翻字段归一为 `{ zh: 原字符串 }`，规则包正常载入、界面显示该名称与正文，不抛未捕获异常

#### Scenario: 对新多语言形状幂等
- **WHEN** 读入一个可翻字段已是语言表的规则包
- **THEN** 归一结果与原定义等价（不改动已有语言条目）
