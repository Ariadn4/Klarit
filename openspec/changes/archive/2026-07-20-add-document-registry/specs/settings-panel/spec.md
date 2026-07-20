## ADDED Requirements

### Requirement: 项目设置-文档 section

设置面板「项目设置」组 SHALL 新增一个「文档」项（section id `project-documents`），作用于当前窗口绑定的项目/成员仓，挂载文档登记表编辑器（见 `document-registry-ui`）。其样式 MUST 遵循品牌规范与 `index.css` 的 `@theme` 设计令牌、深浅双主题，不另起配色或投影。

#### Scenario: 项目设置含文档项
- **WHEN** 用户打开设置面板并展开「项目设置」组
- **THEN** 导航中含「文档」项

#### Scenario: 选中文档项展示登记表编辑器
- **WHEN** 用户点选「文档」项
- **THEN** 右侧内容区展示当前成员仓的两栏改判编辑器（动态/快照 + 文档公约）
