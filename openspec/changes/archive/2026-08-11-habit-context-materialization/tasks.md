# Tasks

> 设计已定：先量根因，再把「Klarit 枚举、agent 解读」从文档推广到习惯——命中路径枚举 + 逐字物化成 per-run 上下文包 + manifest（真实路径 + 廉价预算摘要 + 深度受限目录清单），author 只挂包不挂仓根。
>
> **产出契约不变**：author 照旧产整份定义、照旧过脚手架规整与两闸校验。

## 0. 先量根因（不跳过，结论写回 design.md）

> **未做**：需真实起 agent CLI 在大仓上跑，无人值守环境做不了；实现按「A、B 都受益于换小目录」推进，
> 收益由 6.3(a) 的 dogfood 数字回填。见 design.md「先量，别猜」末尾的说明。

- [ ] 0.1 在一个大仓上测 **A（`--add-dir` 本身贵）**：挂仓根、只问一句废话，记 CPU 累计与耗时
- [ ] 0.2 测 **B（agent 自己翻贵）**：挂一个小目录、问同样的 author 问题，记 CPU 累计与耗时
- [ ] 0.3 把结论与数字写回 `design.md`；若结论是「物化收益有限」，先回来重议方案再动手

## 1. 痕迹枚举（纯函数 + 薄 fs，复用标记集）

- [x] 1.1 写测试：枚举返回命中的**具体路径**（多仓、多标记）；与既有 `hasAgentHabits` **共用同一标记集**（断言不各自维护）
- [x] 1.2 写测试：无痕迹 → 空清单；既有存在性门控行为**逐字不变**（回归）
- [x] 1.3 实现：`agent-habits.ts` 在门控旁新增 `enumerateHabitPaths(memberRoots)`（fs 可注入桩）

## 2. 逐字物化成上下文包

- [x] 2.1 写测试：包内副本与原文件**逐字节相同**（断言无摘要/无截断/无改写）
- [x] 2.2 写测试：超大文件 → **整个不收录** + manifest 标注「过大未收录」；**断言不出现半截内容**
- [x] 2.3 写测试：多仓同名 `CLAUDE.md` → 分别落 `<成员仓名>/CLAUDE.md`，互不覆盖
- [x] 2.4 写测试：包建在应用临时区，**断言路径不在任何成员仓内、不在项目目录内**
- [x] 2.5 实现：物化函数（`habit-context.ts` 的 `materializeHabitContext`）

## 3. manifest 组成

- [x] 3.1 写测试：manifest 含每个文件的真实绝对路径、成员仓清单
- [x] 3.2 写测试：含 `git log --oneline` 近 N 条与各成员仓 `package.json` scripts，且为**原样输出**（断言未归纳）
- [x] 3.3 写测试：含深度受限的项目目录清单（只列路径、不读内容）
- [x] 3.4 实现：manifest 组装（git runner 注入、可桩）

## 4. 生命周期与清理

- [x] 4.1 写测试：每次调用新建包；调用正常结束 → 清理；author **失败/超时** → 同样清理，不残留
- [x] 4.2 实现：包的建/清（`withHabitContextPack` try-finally，清理失败不影响主流程）

## 5. author 改喂上下文包

- [x] 5.1 写测试：自动 author 的可访问目录是上下文包，**断言不含成员仓根**
- [x] 5.2 写测试：系统意图含「材料已收集在可访问目录、不必也无法遍历整个项目」+ 保留只读约束
- [x] 5.3 写测试（回归）：产出契约不变 —— 照旧整份定义、照旧过脚手架规整与两闸校验
- [x] 5.4 写测试（回归）：**聊天写工作流路径不受影响**（本来就不挂项目）
- [x] 5.5 实现：`index.ts` 的 `authorWorkflowForProject` 改喂包、去掉仓根 addDirs；意图文案调整
- [x] 5.6 **保留仓根挂载的代码路径**（`mountMemberRoots`，环境变量 `KLARIT_HABIT_MOUNT_REPO_ROOTS=1` 打开）——dogfood 若发现漏得厉害，回退方案是「挂仓根 + manifest 引导」

## 6. 收尾与验证

- [x] 6.1 `npm run typecheck` 两套干净、`npm run test:run` 全绿（1742 passed / 136 files，基线 1709/135）
- [x] 6.2 `npx openspec validate habit-context-materialization --strict`
- [ ] 6.3 dogfood **两项都要测**（未做）：
      (a) **提速** —— 同一大仓上对比改前改后的 author 耗时与 CPU 累计，记录数字
      (b) **是否漏** —— 产出的工作流质量是否明显下降（author 是否原本靠满仓翻找拿到了关键信息）
- [ ] 6.4 若 (b) 明显下降 → 按 design.md 的回退路径改「挂仓根 + manifest 引导」（`KLARIT_HABIT_MOUNT_REPO_ROOTS=1` 即可开），并如实记录 CPU 可能治不好
