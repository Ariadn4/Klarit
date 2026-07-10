## ADDED Requirements

### Requirement: 成员仓的标签标注

`RepoMember` SHALL 支持一个可选的 `tag` 字段(受控可扩展词表,如 前端/后端/配置/共享 SDK),用于工作流节点 `target=tag` 的解析。`tag` MUST 可由用户**手动设定/修改**(经写入口 `setMemberTag`,或直接编辑 registry.json)。`tag` 属项目管理数据,MUST 持久化到 `registry.json`(userData)、**不入 git**。缺省(未标注)合法,不影响单仓项目与 `target=all`/`target=repo` 的解析。

> 说明:由 agent 在成员识别时**自动推断**标签留作后续 change(本轮不做);本轮标签为手动设定。

#### Scenario: 用户手动设定标签
- **WHEN** 用户经写入口把某成员的 `tag` 设为「后端」
- **THEN** 标签写入该成员并持久化到 registry.json,后续 `target=tag` 解析按该标签生效

#### Scenario: 用户修改标签
- **WHEN** 用户把某成员的 `tag` 从「后端」改为「共享 SDK」
- **THEN** 修改持久化,后续 `target=tag` 解析按新标签生效

#### Scenario: 空串清除标注
- **WHEN** 用户把某成员的 `tag` 设为空串
- **THEN** 该成员的标签标注被清除,`target=tag` 不再命中它

#### Scenario: 标签缺省不影响其它解析
- **WHEN** 成员仓未标注 `tag`
- **THEN** `target=all` 与 `target=repo` 仍正常解析;仅 `target=tag` 不命中该成员

#### Scenario: 标签不入 git
- **WHEN** 某成员被标注标签
- **THEN** 标签仅存于 userData 的 registry.json,不写入任何成员仓的工作树或 git
