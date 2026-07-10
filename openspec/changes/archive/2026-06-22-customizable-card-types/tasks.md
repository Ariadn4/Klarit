## 1. 模型层（types.ts）

- [x] 1.1 写测试锁定：`CardArchetype = 'container' | 'leaf'` 与 `CardTypeDef { id, name, description, archetype }`（不含工作流字段）的形状与往返
- [x] 1.2 在 `src/shared/types.ts` 加 `CardArchetype`、`CardTypeDef`；把 `CandidateCard`/`RequirementCard` 的 `category: CardCategory` 改为 `typeId: string`
- [x] 1.3 给 `WorkflowDefinition` 加可选 `suggestedTypes?: CardTypeDef[]`（仅 leaf）
- [x] 1.4 保留/标注旧 `CardCategory` 仅供迁移与默认种子使用（不再作卡分类来源）

## 2. 纯逻辑校验（requirement-card.ts，测试先行）

- [x] 2.1 写测试：`validateCandidateCard`/`validateRequirementCard` 接收"在册 typeId→archetype 映射"入参，typeId 在册才合法、不在册返回可读原因
- [x] 2.2 写测试：archetype 关系合法性——leaf 作 parent 非法、container 作 parent 合法、container 可嵌套 container
- [x] 2.3 写测试：未提供在册集合时类型校验判非法（纯逻辑不自读注册表）
- [x] 2.4 实现上述校验签名变更与 archetype 关系校验；调整/迁移 `CARD_CATEGORIES`（改为默认类型种子定义来源）
- [x] 2.5 加 `CardTypeDef` 自身校验：id/name 非空、archetype 取值合法（仅 container/leaf）
- [x] 2.6 加 `suggestedTypes` 校验：每项为合法 CardTypeDef 且 archetype 必须为 leaf（container 进 issue/拒绝）

## 3. 类型注册表存储 + 默认种子 + 工作流播种（main，参考 workflow-store / 规则包）

- [x] 3.1 写测试：注册表 CRUD（增删改查）、id 唯一、删除被引用类型被拒、空注册表种入默认类型
- [x] 3.2 实现类型注册表存储于 userData（不入 git、开放格式），含读/写/增/改/删
- [x] 3.3 实现默认类型种子 `epic`(container)/`feature`(leaf)/`bug`(leaf)，落点与 `localize-seed-packs` 默认包对齐；epic 为内置通用类型
- [x] 3.4 实现删除引用检查（阻止删除或要求改派，返回可读原因）
- [x] 3.5 写测试：工作流激活播种 `suggestedTypes`——新 id 加入、已存在跳过不覆盖、停用工作流不删类型
- [x] 3.6 实现工作流激活时的播种接缝（幂等，接现有"项目激活工作流"机制）
- [x] 3.7 读旧卡迁移：`category` 值原样作 `typeId`（迁移函数对新形状幂等，参考 `migrateWorkflowShape`）

## 4. IPC + preload 暴露

- [x] 4.1 在 `src/shared/ipc.ts` 定义类型注册表的 IPC 通道（list/create/update/delete）+ 读取自动生成分解 skill 文本
- [x] 4.2 在 `src/main/index.ts` 注册 handler，接注册表存储与播种
- [x] 4.3 在 `src/preload/index.ts` 与 `KlaritApi`（types.ts）暴露类型注册表 API 与分解 skill 预览读接口

## 5. 分解 skill 自动生成（decompose-service.ts，测试先行）

- [x] 5.1 写测试：生效 skill = 固定拆分模板 + 注册表类型(name/description) 自动合成；改类型描述则生成结果变化
- [x] 5.2 写测试：解析顺序——覆盖 skill（工作流新建需求 prompt / 手写导入）优先，否则用自动生成 skill；未绑定项目用默认类型集合
- [x] 5.3 写测试：候选卡 typeId 不在册时进 `CandidateIssue`、不静默回落
- [x] 5.4 实现自动生成（拆分模板常量 + 类型分类段拼装）与解析顺序
- [x] 5.5 实现"读取自动生成 skill 完整文本"接口供预览；保留覆盖 skill 的手写/导入（与节点 prompt「使用文件」一致）
- [x] 5.6 实现候选卡校验改用注册表（经在册集合参数化校验），未知 typeId 标记为 issue

## 6. 设置页 UI（参考 RuleLibrary / WorkflowLibrary，遵守品牌规范）

- [x] 6.1 写组件测试：类型列表展示、新增/编辑/删除（设 name/description/archetype）、删除被引用类型提示、非法输入提示
- [x] 6.2 写组件测试：分解 skill 预览随类型描述变化、显示完整生效 skill（只读）
- [x] 6.3 新增"需求卡类型"管理组件（语义令牌、深浅两套，无硬编码颜色），含类型增删改 + 分解 skill 预览面板
- [x] 6.4 在 `SettingsPanel.tsx` 接入该设置区
- [x] 6.5 i18n：`i18n/locales/zh.ts` 与 `en.ts` 补全文案

## 7. 集成与回归

- [x] 7.1 扫描并更新所有 `validateCandidateCard`/`category` 旧调用点（审阅 UI、decompose、测试）至新签名/字段
- [x] 7.2 端到端走查：定义自定义类型 → 预览分解 skill → 分解按其分类 → 审阅校验 → 设置页可见；激活带 suggestedTypes 的工作流播种类型；确认 epic/feature/bug 默认行为不变
- [x] 7.3 `npm run typecheck` 与 `npm run test:run` 全绿
