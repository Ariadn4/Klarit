## 1. 规则包底座（数据模型 + 校验 + 默认种子）

- [x] 1.1 `src/shared/rule-pack.ts` 定义 `RulePackItem`（`constitution-rule`/`output-template`/`objective-check` 判别联合）、`RulePack`、`RulePackItemRef`、`ConstitutionGovernance`、`EffectiveConstitutionRule`
- [x] 1.2 `validateRulePack`（id/显示名非空、条目 id 包内唯一、各类型内容非空）与 `createDefaultRulePack`（含「测试先行」等宪法规则），测试先行
- [x] 1.3 `deriveEffectiveConstitution` 纯函数 + `listItemsByKind`（见 §3.2）

## 2. 规则包包存储 + IPC（main）

- [x] 2.1 `src/main/rule-pack-store.ts`：list/all/get/save/create/clone/remove/seedIfEmpty/import/export + 损坏包跳过 + YAML 往返，测试先行
- [x] 2.2 IPC：`shared/ipc.ts` 加 `rulePack:*` 通道；`preload` 暴露；`main/index.ts` 接 store + `seedIfEmpty`
- [x] 2.3 `KlaritApi` 增规则包方法（list/all/get/create/clone/save/delete/import/export）

## 3. 宪法治理（项目层套用 + 派生）

- [x] 3.1 `Project` 增 `constitution?: ConstitutionGovernance`；`registry-core` 加 get/setConstitutionGovernance，测试先行
- [x] 3.2 `deriveEffectiveConstitution(packs, governance)`：激活并集 − disabledRules，稳定顺序，测试先行
- [x] 3.3 IPC：读写某项目宪法治理状态 + 读生效宪法（`project:getConstitution`/`setConstitution`/`effectiveConstitution`）

## 4. 工作流引用规则包条目（嵌入 ↔ 引用）

- [x] 4.1 `types.ts`：`OutputTemplate` 加 `ref`；门把 `auto` 的 `command` 改为 `check: { inline | ref }`
- [x] 4.2 `src/shared/workflow.ts`：校验 ref 形态（id 非空、不强制引用存在），测试先行
- [x] 4.3 `src/main/workflow-store.ts`：迁移旧 `auto.command` → `auto.check.inline`（空命令仍丢弃），测试先行

## 5. UI

- [x] 5.1 应用设置·规则库：`RuleLibrary.tsx`（列表新建/克隆/删除/导入/导出 + 包编辑器三类条目 CRUD），只用语义令牌，挂进 `SettingsPanel`，测试先行
- [x] 5.2 项目设置·宪法：`ConstitutionSettings.tsx`（激活包 + 逐条开关 + 生效宪法汇总），挂进 `SettingsPanel`，测试先行
- [x] 5.3 `WorkflowEditor.tsx`：模板加「规则库」（四选）、自动校验加「裸命令/从规则库引用」，引用下拉按类型过滤；`WorkflowLibrary` 拉 `allRulePacks` 透传，测试先行
- [x] 5.4 ref 断链提示：`RefSelect` 就地标「（缺失）」，校验不阻塞保存

## 6. 文档与回归

- [x] 6.1 `docs/project-goals.md`：四层结构补「规则包的实体形态」（三类条目、开放格式、应用编辑+项目开关、嵌入vs引用）；公共输入·宪法处写明＝项目生效宪法
## 7. 验收反馈迭代（实现中）

- [x] 7.1 规则包编辑器条目**按三类分区**（宪法规则 / 产出模板 / 客观门校验），不杂糅
- [x] 7.2 产出模板收成 `none | ref`（去掉 inline/file 嵌入，内容统一住规则库）；校验/迁移/spec/project-goals 同步
- [x] 7.3 编辑器模板引用态加「新建/编辑」直接写规则库（手写落进库），写库后刷新引用选择器

- [x] 6.2 `npm run typecheck` 两套 config 通过
- [x] 6.3 `npm run test:run` 全绿（含 rule-pack/store/registry/workflow/editor 新用例）
- [ ] 6.4 `npm start` 人工核对（规则库编辑、项目宪法开关、工作流引用、断链提示、深色令牌）— 待 §5 UI 完成后
