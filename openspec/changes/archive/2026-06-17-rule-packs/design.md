## Context

project-goals 四层结构 `引擎 / 规则包 / 工作流 / 执行端` 里，**规则包是核心 IP 的承载层**，但至今没有实体：宪法只在文档里被引用、产出模板与客观门校验只能在工作流里逐条手写、且没有可导入的包格式。上一张卡（`refine-output-and-gate-model`）已刻意把产出模板做成 `none/inline/file`、把客观门校验做成裸命令，并在设计里留好「将来加 `ref` 引用注册器」的非破坏演进位。本卡就是落地那个「注册器」——但经讨论它其实是整个**规则包层**：含宪法、产出模板、客观门校验三类内容，两种消费方式（工作流引用 / 项目套用）。

约束：纯模型/校验/默认种子在 `src/shared/`（main+renderer 共享、无 fs）；包读写在 `src/main/`（类比 `workflow-store.ts`）；UI 遵守品牌令牌（上一张卡踩过 `bg-white` 不翻色的坑，本卡只用语义令牌）；引擎尚未存在，故本卡只做**声明 + 存储 + 编辑/开关 + 派生**，不做注入/执行/强制。

## Goals / Non-Goals

**Goals:**
- 规则包底座：命名包持有带类型条目（`constitution-rule` / `output-template` / `objective-check`），开放 YAML 包格式，userData 存储，内置默认，新建/编辑/删除/导入/导出/校验。
- 宪法治理：应用层编辑规则库内容；项目层激活包 + 逐条 on/off；确定性派生项目「生效宪法」。
- 工作流引用：产出模板与客观门校验各加 `ref` 形态，与嵌入形态并存。
- UI：应用设置规则库编辑器 + 项目设置宪法开关 + 工作流编辑器 ref 选择器。

**Non-Goals:**
- 引擎对宪法的**注入**、对校验命令的**执行**、对模板的**符合性强制**——均属引擎运行期，后续承接。
- 社区 **marketplace**（project-goals 定 v2）。
- 直接读 **OpenSpec schema** 的适配导入——先做自有开放格式，OpenSpec 适配留下一步。
- 「工作流 + 它引用的规则包」打成单一**方法论分发包**——留模型位、不实现。
- 规则包的**版本化/云同步**——先做基础存储，同步沿用既有 userData 思路、不在本卡细化。

## Decisions

### 决策 1：规则包数据模型——带类型条目的命名包

```ts
type RulePackItem =
  | { kind: 'constitution-rule'; id: string; name: string; text: string }
  | { kind: 'output-template';   id: string; name: string; content: string }
  | { kind: 'objective-check';   id: string; name: string; command: string }

interface RulePack {
  id: string
  name: string
  description?: string
  items: RulePackItem[]   // 条目 id 在包内唯一且稳定（被引用/被开关记录）
}
```

- 三类条目同住一个包（对齐 OpenSpec 一个 schema 同时含 template + validate + 规则）。条目 id 一旦发布即稳定。
- **替代方案**：三类各开独立库——否决，导入一个「方法论包」应一次拿到三类，分库反而割裂。

### 决策 2：开放包格式与存储——类比工作流包

`userData/rule-packs/<id>/rule-pack.yaml`，与 `userData/workflows/<id>/` 并列、机制照搬 `workflow-store.ts`（list/get/save/create/clone/remove/seedIfEmpty/import/export + 损坏包跳过）。YAML 往返一致、对外开放（project-goals「导入格式 v1 必须开放」）。新建 `src/main/rule-pack-store.ts` + `src/shared/rule-pack.ts`（纯校验/默认种子）。

### 决策 3：宪法两层模型——应用层编辑内容、项目层套用

- **应用层**（规则库）：编辑包**内容**（增/改/删 `constitution-rule`）——对所有项目生效。
- **项目层**：`Project` 增宪法治理状态 `{ activePackIds: string[], disabledRules: Array<{packId, itemId}> }`，属项目管理数据（userData、按身份关联、不入 git）。
- **派生**：`生效宪法(project) = 激活包的 constitution-rule 并集 − disabledRules`，条目按 `{packId, itemId}` 标识避免跨包重名，稳定顺序。纯函数（shared），供将来引擎注入。
- 新项目 MAY 默认激活内置默认包（免开箱即空），可停用（不强推）。

### 决策 4：模板「只引用」、校验「裸命令 + 引用」——内容统一住规则库

产出模板**只引用规则库**（去掉 inline/file 嵌入）；客观门校验保留裸命令快捷 + 引用：

```ts
type OutputTemplate =
  | { kind: 'none' }
  | { kind: 'ref'; ref: { packId; itemId } }   // 只引用规则库 output-template

type GateCheck =
  | { kind: 'inline'; command: string }         // 裸命令快捷（一行命令不值得建库条目）
  | { kind: 'ref'; ref: { packId; itemId } }    // 引用规则库 objective-check
// auto 门把：{ kind:'auto', check: GateCheck, targets?: string[] }
```

- **模板内容统一住规则库（单一来源）**：编辑器的「手写新建」是把内容**写进规则库再引用**，工作流本身不嵌入模板——避免散落副本、改一处全生效。代价：工作流不自包含、依赖规则包，分享靠将来「方法论包」一起带走。
- **校验**保留裸命令（`npm test` 这种一行命令不值得建库条目）+ 从库引用（可复用的命名 check）。
- **编辑器写库**：模板引用态提供「新建」（存入某包+名称+内容→写库→引用）与「编辑」（改当前引用条目内容→写回库），写库后刷新引用选择器。
- **断链处理**：ref 校验只查 `{packId,itemId}` 非空；条目本机是否存在不在工作流校验内强制，解析/执行期按缺失上报、不阻塞保存。
- **迁移**：旧 `auto.command: string` → `auto.check: {kind:'inline',command}`；旧模板 `inline`/`file` → `none`（嵌入形态已废，内容迁库需人工；旧 dogfood 数据基本为空）。

### 决策 5：规则包与工作流包的关系——并列两层、引用而非内嵌

工作流（编排）与规则包（规范）是 project-goals 里并列的两层。连接方式：宪法**按项目套用**（不被工作流引用）；模板/校验**被工作流节点 ref 引用**（或嵌入）。规则包**不内嵌在工作流包里**。将来要完整分享「引用了规则包的工作流」，靠上层「方法论分发包」一起打包（非本卡）。

### 决策 6：UI 三处

- **应用设置·规则库**（新组件，类比 `WorkflowLibrary`/`WorkflowEditor`）：包列表 + 包编辑器（三类条目 CRUD）+ 导入/导出。**只用语义令牌**。
- **项目设置·宪法**（新组件）：列激活包及其规则开关、汇总生效宪法。
- **工作流编辑器**（改 `WorkflowEditor.tsx`）：模板处「不声明/手写/使用文件/从规则库引用」四选；自动校验处「裸命令/从规则库引用」二选；引用时下拉按类型过滤列条目。需把规则库条目喂进编辑器（经 IPC 读 + prop 透传，类比 `detectedAgents`）。

### 决策 7：IPC

新增一组规则包 IPC（list/get/save/create/clone/remove/import/export 包，读条目供选择器），及项目宪法治理状态的读写（activePackIds / disabledRules）。沿用既有 `shared/ipc.ts` + `preload` + `main/index.ts` 三段式。

## Risks / Trade-offs

- **[范围大]** 三合一（底座 + 宪法 + 模板/校验 + 引用 + 三处 UI）是大卡 → 用清晰的能力切分（5 个 spec）控制；实现按 tasks 分组、可分阶段 apply（底座→宪法→引用→UI）。
- **[BREAKING：门把 check 形态]** `auto.command: string` → `auto.check: GateCheck` → 迁移 `workflow-store` 反序列化把旧 `command` 包成 `{kind:'inline', command}`；旧空命令仍按上一张卡规则丢弃。
- **[ref 断链]** 引用的规则包/条目在某机器缺失 → 不阻塞保存，解析期上报「引用缺失」，UI 标注（类比工作流「（无效）」）；将来「方法论分发包」彻底解决。
- **[条目 id 改名/删除致悬挂]** 应用层删一条被工作流引用的模板/被项目开关记录的规则 → 引用悬挂；按缺失处理 + 上报，不级联自动改写（v1 量小不值），UI 提示。

## Migration Plan

1. 底座：`shared/rule-pack.ts`（模型/校验/默认种子）+ `main/rule-pack-store.ts`（包读写）+ IPC，测试先行。
2. 工作流 ref：`types.ts` 模板加 `ref`、门把 check 改 `inline|ref`；`workflow.ts` 校验；`workflow-store.ts` 迁移旧 `command`；测试先行。
3. 宪法：`Project` 增治理状态 + 派生纯函数 + 读写 IPC；测试先行。
4. UI：规则库编辑器（应用设置）、宪法开关（项目设置）、工作流编辑器 ref 选择器；测试先行。
5. 文档：`docs/project-goals.md` 规则包/公共契约处补实体；回归 `typecheck` + `test:run` + `npm start` 人工核对。

回滚：新增文件为主；门把 check 的 BREAKING 集中在 `types/workflow/workflow-store` 三处 + 迁移一处，可还原。

## Open Questions

- 产出模板 `ref` 与客观门 `ref` 用**条目 id** 引用——是否需要再带 `packId` 限定（避免不同包同 id 条目歧义）？倾向引用 `{packId, itemId}` 全限定，确定性更强；实现时定。
- 新项目默认激活内置默认包：默认开 vs 默认不开？倾向**默认激活**（免开箱即宪法为空）但可停用——已写进 spec 为 MAY，实现时确认。
- OpenSpec 适配导入排在本卡之后单开——届时是「读 schema.yaml 转成规则包」还是「运行期挂接」？留待那张卡。
