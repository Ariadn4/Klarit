# settings-panel Specification

## Purpose
TBD - created by archiving change detect-system-language. Update Purpose after archive.
## Requirements
### Requirement: 设置入口

应用侧边栏底部（与项目切换器同一排）SHALL 提供一个「设置」入口按钮（齿轮图标）。点击该按钮 MUST 打开设置面板；当面板已打开时，再次触发入口或关闭操作 MUST 能关闭面板。设置面板右侧内容区顶部 MUST NOT 再显示重复的「设置」标题文字（该处保留关闭按钮）。入口的图标与样式 MUST 遵循品牌规范（`docs/brand/klarit-brand-system.html`）与 `index.css` 的 `@theme` 设计令牌，不另起一套配色或投影。

#### Scenario: 打开设置面板
- **WHEN** 用户点击侧边栏底部的「设置」（齿轮）按钮
- **THEN** 设置面板打开并展示可调整的设置项

#### Scenario: 关闭设置面板
- **WHEN** 设置面板已打开，用户执行关闭操作（点击关闭或再次触发入口）
- **THEN** 设置面板关闭，回到主界面

#### Scenario: 右侧内容区不重复显示标题
- **WHEN** 设置面板打开
- **THEN** 右侧内容区顶部不显示「设置」标题文字，仅保留关闭按钮

### Requirement: 外观设置项

设置面板「应用设置-通用」SHALL 包含一个「外观」设置项，以下拉选择（dropdown）样式呈现，可选项为「深色」「浅色」「跟随系统」，并以当前生效值为选中项。选择某一外观 MUST 立即生效并持久化保存，使其在下次启动时保持。本设置项 MUST NOT 触发界面配色/主题的实际切换（实际渲染留待后续 change）。其样式 MUST 遵循品牌规范（`docs/brand/klarit-brand-system.html`）与 `index.css` 的 `@theme` 设计令牌，不另起一套配色或投影。

#### Scenario: 展示当前外观
- **WHEN** 用户打开设置面板的「通用」
- **THEN** 「外观」下拉显示「深色 / 浅色 / 跟随系统」，当前外观为选中项

#### Scenario: 切换外观即时持久化
- **WHEN** 用户在「外观」下拉中选择另一外观
- **THEN** 该外观立即成为当前外观并被持久化保存，重启后仍为所选外观

#### Scenario: 默认跟随系统
- **WHEN** 用户从未设置过外观，打开「通用」
- **THEN** 「外观」下拉选中「跟随系统」

### Requirement: 语言设置项

设置面板 SHALL 包含一个「语言」设置项，以下拉选择（dropdown）样式列出全部受支持语言供用户选择，并以当前生效语言为选中项。选择某一语言 MUST 立即生效并持久化保存，使其在下次启动时保持。

#### Scenario: 展示当前语言
- **WHEN** 用户打开设置面板
- **THEN** 「语言」下拉列出全部受支持语言，当前语言为选中项

#### Scenario: 切换语言即时持久化
- **WHEN** 用户在「语言」下拉中选择另一种受支持语言
- **THEN** 该语言立即成为当前语言并被持久化保存，重启后仍为所选语言

#### Scenario: 重复选择当前语言无副作用
- **WHEN** 用户再次选择当前已生效的语言
- **THEN** 语言保持不变，不产生错误

### Requirement: 设置面板左右结构与分组

设置面板 SHALL 采用左右结构：左侧为分组导航，至少含「应用设置」与「项目设置」两组；右侧展示当前所选项的内容。面板 MUST 经顶层浮层渲染并保证不被应用内其它浮层（如文件预览的底栏）穿透。面板样式 MUST 遵循品牌规范（`docs/brand/klarit-brand-system.html`）与 `index.css` 的 `@theme` 设计令牌。

「应用设置」作用于整个应用（如语言、全局工作流库）；「项目设置」作用于当前窗口绑定的项目。

#### Scenario: 打开设置面板展示左右结构
- **WHEN** 用户打开设置面板
- **THEN** 面板左侧展示「应用设置」与「项目设置」分组导航，右侧展示当前所选项内容

#### Scenario: 切换导航项切换右侧内容
- **WHEN** 用户在左侧选择另一项
- **THEN** 右侧内容切换为该项对应的设置

### Requirement: 应用级工作流库管理

「应用设置」组 SHALL 含一个「工作流」项，提供**全局工作流库**的管理：列出全部工作流，并能新建、克隆、删除、导入，以及打开某工作流进入编辑（见 `workflow-editor`）。工作流是与具体项目无关的全局数据，故其增删改在此处完成。管理操作后列表 MUST 及时刷新。

#### Scenario: 在应用设置管理工作流库
- **WHEN** 用户进入「应用设置 → 工作流」
- **THEN** 用户可对工作流进行列出/新建/克隆/删除/导入，并可打开某工作流进入编辑

#### Scenario: 管理操作后列表刷新
- **WHEN** 用户在工作流库完成一次新建/克隆/删除/导入
- **THEN** 工作流列表及时反映变更

### Requirement: 项目级工作流激活选择

「项目设置」组 SHALL 含一个「工作流」项，提供当前项目的**激活工作流选择**：从全局工作流库中列出全部工作流，以选中态标示当前项目激活的工作流，选择另一个 MUST 立即把当前项目的激活工作流切换为所选项并持久化（见 `project-registry`），重开后保持。此处仅做**选择/指定**，不在此新建或编辑工作流。当当前窗口未绑定任何项目时，此项 MUST 给出明确空态而非报错。

#### Scenario: 为当前项目指定激活工作流
- **WHEN** 用户在已绑定项目的窗口进入「项目设置 → 工作流」
- **THEN** 列出全部工作流，当前项目激活的那个处于选中态

#### Scenario: 切换激活工作流即时持久化
- **WHEN** 用户在选择列表中选择另一个工作流
- **THEN** 当前项目的激活工作流切换为所选项并持久化，重启后仍为所选项

#### Scenario: 未绑定项目时的空态
- **WHEN** 当前窗口未绑定任何项目，用户进入「项目设置 → 工作流」
- **THEN** 显示空态提示，不报错、不展示激活选择

### Requirement: 默认 agent 与默认模型设置项

设置面板「应用设置 → 通用」SHALL 包含「默认 agent」与「默认模型」两个设置项。「默认 agent」以下拉选择（dropdown）呈现，MUST 列出本地已检测到的 agent（见 `agent-detection`），并以当前默认 agent 为选中项。「默认模型」MUST 为 **combobox（可选可输）**：聚焦时展示当前所选 agent 的**完整建议模型列表**（「别名＝自动最新」条目排在前，如 claude 的 `opus`/`sonnet`/`haiku`），且 MUST NOT 按输入框已有值过滤建议（已有值时仍能看到全部建议并换选，原生 datalist 的前缀过滤行为不满足本要求）；同时允许用户**直接键入任意模型 id** 提交——不限于建议列表，使新模型无需应用更新即可使用。选择或输入某一 agent/模型 MUST 立即生效并持久化保存（见 `agent-preference`），重启后保持。切换 agent 后模型 MUST 重置（清空并展示新 agent 的建议列表），不保留原 agent 的模型值。当本地未检测到任何 agent 时，本设置项 MUST 给出明确空态（如提示去安装 agent）而非报错。其样式 MUST 遵循品牌规范（`docs/brand`）与 `index.css` 的 `@theme` 设计令牌、深浅双主题，不另起一套配色或投影。

#### Scenario: 展示当前默认 agent 与模型
- **WHEN** 用户打开设置面板的「应用设置 → 通用」，本地已检测到 agent 且已设默认值
- **THEN** 「默认 agent」下拉列出已检测到的 agent 且当前默认 agent 为选中项，「默认模型」combobox 显示当前默认模型，聚焦时展示该 agent 的**完整**建议列表（别名条目在前，不因已有值而被过滤）

#### Scenario: 切换默认 agent 即时持久化并联动模型
- **WHEN** 用户在「默认 agent」下拉中选择另一个已检测到的 agent
- **THEN** 该 agent 立即成为默认 agent 并被持久化，「默认模型」重置并改为展示新 agent 的建议列表，原 agent 的模型值不被保留

#### Scenario: 从建议列表选择模型即时持久化
- **WHEN** 用户在「默认模型」combobox 的建议列表中选择某条目（含别名条目）
- **THEN** 该模型立即成为默认模型并被持久化，重启后仍为所选模型

#### Scenario: 手输任意模型 id 即时持久化
- **WHEN** 用户在「默认模型」combobox 中键入一个不在建议列表内的模型 id 并提交
- **THEN** 该 id 立即成为默认模型并被持久化，不被拒绝或清空

#### Scenario: 未检测到 agent 时的空态
- **WHEN** 用户打开「应用设置 → 通用」，本地未检测到任何受支持 agent
- **THEN** 「默认 agent / 默认模型」处显示空态提示（引导用户安装 agent），不报错、不展示可选项

### Requirement: 默认 effort 设置项

设置面板「应用设置 → 通用」SHALL 包含「默认 effort（推理力度）」设置项，提供七个互斥选项：`low` / `medium` / `high` / `xhigh` / `max` / `ultracode` / 「跟随 agent 默认」（即未设置）。档位选项 MUST 显示 CLI 原文（不翻译）。选择 MUST 立即生效并持久化（见 `agent-preference`），重启后保持。该设置项 MUST 附简短说明文案，说明其作用于 agent 推理力度、由各家 agent 各自解释、不支持的 agent 将忽略。样式 MUST 遵循品牌规范与 `@theme` 设计令牌、深浅双主题。

#### Scenario: 选择 effort 档位即时持久化
- **WHEN** 用户把默认 effort 从「跟随 agent 默认」改为 `high`
- **THEN** 立即持久化，重启后设置面板仍显示 `high`

#### Scenario: 回到跟随 agent 默认
- **WHEN** 用户把默认 effort 改回「跟随 agent 默认」
- **THEN** 默认 effort 变为「未设置」，后续 agent 启动不再注入 effort 参数

### Requirement: 项目设置-文档 section

设置面板「项目设置」组 SHALL 新增一个「文档」项（section id `project-documents`），作用于当前窗口绑定的项目/成员仓，挂载文档登记表编辑器（见 `document-registry-ui`）。其样式 MUST 遵循品牌规范与 `index.css` 的 `@theme` 设计令牌、深浅双主题，不另起配色或投影。

#### Scenario: 项目设置含文档项
- **WHEN** 用户打开设置面板并展开「项目设置」组
- **THEN** 导航中含「文档」项

#### Scenario: 选中文档项展示登记表编辑器
- **WHEN** 用户点选「文档」项
- **THEN** 右侧内容区展示当前成员仓的两栏改判编辑器（动态/快照 + 文档公约）

