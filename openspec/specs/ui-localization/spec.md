# ui-localization Specification

## Purpose
把已选「语言」偏好渲染到整个界面——提供翻译机制（词典 + 翻译入口）、`zh`/`en` 双词典作为界面文案单一来源、切换语言即时翻译、缺键安全回退默认语言，以及全部界面文案与无障碍标签的可本地化。这是 `language-preference`（存储/选择）缺失的「渲染」对偶，类比 `theme-rendering` 之于 `appearance-preference`。

## Requirements
### Requirement: 界面文案随语言偏好渲染

软件 SHALL 把当前「语言」偏好（`language-preference` 持久化的 `zh`/`en`）渲染到整个界面，使界面文案以该语言显示。文案选择 MUST 通过一个翻译机制（词典 + 翻译入口）由 `language` 偏好驱动，类比 `theme-rendering` 中 `data-theme` 驱动设计令牌——MUST NOT 依赖在组件里按语言写分支拼接中文/英文字符串。词典 SHALL 是界面文案的单一来源，至少包含 `zh` 与 `en` 两套，默认语言为 `zh`。

#### Scenario: 中文偏好渲染中文界面
- **WHEN** 当前语言偏好为 `zh`，界面渲染
- **THEN** 界面文案（侧边栏、设置、工作流编辑器等）以中文显示

#### Scenario: 英文偏好渲染英文界面
- **WHEN** 当前语言偏好为 `en`，界面渲染
- **THEN** 界面文案以英文显示

### Requirement: 切换语言即时翻译

当用户在设置中切换语言时，软件 SHALL 立即以新语言重渲染界面，MUST NOT 要求重启或重开窗口。重渲染 SHALL 由渲染层语言状态变化驱动（无需新增 IPC 推送）。

#### Scenario: 切换语言界面即时翻译
- **WHEN** 用户在「设置 ▸ 通用」把语言从中文切到 English
- **THEN** 界面文案立即翻为英文，无需重启

#### Scenario: 切回中文即时翻译
- **WHEN** 当前为英文界面，用户把语言切回中文
- **THEN** 界面文案立即翻回中文

### Requirement: 缺失翻译安全回退

当某文案键在当前语言词典中缺失时，软件 SHALL 回退到默认语言（`zh`）的对应文案。任何情况下 MUST NOT 把裸键名（如 `settings.title`）渲染到界面。

#### Scenario: 当前语言缺键时回退默认语言
- **WHEN** 当前语言为 `en`，某文案键在英文词典中缺失但中文词典存在
- **THEN** 该处渲染中文（默认语言）文案，而非英文

#### Scenario: 任何语言都不渲染裸键名
- **WHEN** 界面渲染任一文案键
- **THEN** 显示的是某语言下的文案文本，绝不出现形如 `xxx.yyy` 的裸键名

### Requirement: 界面文案与无障碍标签可本地化

界面中所有面向用户的文本 SHALL 经由翻译机制取自词典，包括可见文案、占位符、`title`，以及无障碍属性（`aria-label` 等）。组件 MUST NOT 在 JSX 中硬编码面向用户的中文字面量。技术专有名词（如 `agent`、`git`、`Claude Code`、`model`）作为词典内的文案内容保留，不视为违例。

#### Scenario: 可见文案取自词典
- **WHEN** 渲染设置面板的导航标签与表单标签
- **THEN** 这些文本均取自当前语言词典，而非组件内硬编码字面量

#### Scenario: 无障碍标签随语言切换
- **WHEN** 语言为 `en`，渲染带 `aria-label` 的图标按钮（如折叠侧边栏按钮）
- **THEN** 其 `aria-label` 为英文词典中的对应文案

### Requirement: 词典完整性

`zh` 与 `en` 两套词典 SHALL 拥有一致的键集合——每个在界面使用的文案键 MUST 在两套词典中均有取值。词典 SHALL 可被测试校验其键集合一致、无缺漏。

#### Scenario: 两套词典键集合一致
- **WHEN** 对 `zh` 与 `en` 词典做键集合比对
- **THEN** 两者键集合相同，不存在仅在一侧出现的键

### Requirement: 带变量文案使用插值

包含动态值（数量、名称等）的文案 SHALL 通过词典的插值/占位机制表达，MUST NOT 用字符串拼接把译文割裂成片段。

#### Scenario: 含变量文案以插值渲染
- **WHEN** 渲染一条含动态值的文案（如「已选择 N 个项目」）
- **THEN** 该文案来自词典模板并以插值填入动态值，中英文各自为完整句式
