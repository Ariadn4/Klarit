## ADDED Requirements

### Requirement: 查看 agent 节点的完整 prompt

工作流编辑界面的**节点详情** SHALL 为 `agent` 执行者节点提供一个「**查看完整 prompt**」入口:节点详情顶栏(与保存同一行)呈现一个 **file-text 图标按钮**。该按钮 MUST **仅在执行者类型为 `agent`** 时呈现;其它执行者类型(engine / command / subworkflow)与其它详情页(如建议类型详情)MUST NOT 呈现它。

点击该按钮 SHALL 打开一个**只读模态**,展示该节点经 `agent-prompt-assembly` 拼装出的**完整 prompt**(宪法 + 节点 prompt + 需求卡占位 + 可写范围 + 产出/模板 + 客观门)。预览 MUST 反映**当前正在编辑的节点状态**(含尚未保存的改动),使用户能边写边看其在全局上下文里的最终形态。节点 prompt 为「使用文件」形态时,预览 MUST 先读出 skill 文件内容再拼;读取失败时该层 MUST 显示错误提示而非整体崩溃。

模态 MUST 明确提示需求卡为运行期注入的占位、执行配置不在 prompt 文本内,避免用户误读预览为「agent 收到的全部」。预览为只读,MUST NOT 在模态内编辑 prompt。该界面 MUST 遵循品牌规范(`docs/brand`)与 `index.css` 的 `@theme` 设计令牌、支持深浅双主题、仅用语义令牌(模态暗罩除外)。

#### Scenario: agent 节点详情呈现查看按钮
- **WHEN** 用户打开一个 `agent` 执行者节点的详情
- **THEN** 节点详情顶栏(与保存同行)呈现一个 file-text 图标按钮

#### Scenario: 非 agent 节点不呈现查看按钮
- **WHEN** 用户打开一个 engine / command / subworkflow 节点的详情
- **THEN** 顶栏不呈现该 file-text 按钮

#### Scenario: 点击查看完整 prompt
- **WHEN** 用户在某 agent 节点点击该按钮
- **THEN** 打开只读模态,展示经 `agent-prompt-assembly` 拼装的完整 prompt(含需求卡占位)

#### Scenario: 预览反映未保存的编辑
- **WHEN** 用户改动了某 agent 节点的 prompt / 可写范围但尚未保存,随即点击查看
- **THEN** 预览呈现当前编辑中的内容(反映未保存改动)

#### Scenario: 使用文件形态预览读取内容
- **WHEN** 某 agent 节点的 prompt 为「使用文件」形态且用户查看完整 prompt
- **THEN** 预览先读出 skill 文件内容再拼入;读取失败时该层显示错误提示、其它层照常呈现
