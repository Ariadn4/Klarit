/**
 * 工作流 agent 节点的「完整 prompt」拼装（纯函数）：把回复语言 + 宪法 + 任务 + 需求卡占位 + 可写范围 + 产出
 * 确定性地拼成一段提交给 AI 的文本。无副作用——读 skill 文件、派生宪法治理、解析模板引用均由调用方先做好。
 *
 * 这是「查看完整 prompt」预览与将来 agent 执行器的**单一来源**：二者经同一函数产出，差异只来自输入
 * （预览的需求卡为占位槽，执行期把槽替换成真实卡字段），而非拼装规则不同。
 *
 * 不入 prompt 文本的：执行配置（工具/模型/额外参数，它是 CLI 调用形态）；客观门（自动校验由 gate 自动跑、
 * 人工评审是给人点的按钮，都不是给 agent 的指令）。
 */

import type { SupportedLanguage } from './language'
import type { EffectiveConstitutionRule, RulePack, RulePackItemRef } from './rule-pack'
import { resolveLocalized } from './rule-pack'
import type { WorkflowOutput } from './types'

/** 已解析模板内容的产出。templateContent：字符串＝ref 已解析内容；null＝不声明模板；undefined＝ref 解析不到（降级提示）。 */
export interface ResolvedOutput {
  path: string
  required: boolean
  templateContent: string | null | undefined
}

/** 需求卡运行期真实字段值（执行期注入，替换编辑期占位槽）。缺省字段回落占位槽（预览态）。 */
export interface CardFieldValues {
  title?: string
  type?: string
  description?: string
  relations?: string
}

/** 本需求涉及的一个成员仓上下文（执行期由引擎注入，让 agent 明确多仓布局，而非在节点 prompt 里写死）。 */
export interface RepoContext {
  /** 成员仓名。 */
  name: string
  /** 成员标签（如 前端/后端），可空。 */
  tag?: string
  /** 该成员仓 worktree 绝对路径。 */
  path: string
  /** 是否为主目标仓（agent 的当前工作目录）；其余为额外工作目录（--add-dir）。 */
  primary?: boolean
}

/** 拼装输入：回复语言 + 节点 prompt 已解析文本 + 生效宪法 + 可写范围 + 已解析产出 + 可选真实卡 + 涉及仓 + 握手路径。 */
export interface AssembleAgentPromptInput {
  /** 设置里的界面语言；据此要求 AI 用对应语言回复与产出。 */
  language: SupportedLanguage
  /** 节点 prompt 已解析文本；`null`＝「使用文件」读取失败。 */
  promptText: string | null
  constitution: EffectiveConstitutionRule[]
  writableScope: string[]
  outputs: ResolvedOutput[]
  /** 运行期真实需求卡字段；缺省＝预览态（各字段用占位槽）。有值的字段替换对应占位。 */
  card?: CardFieldValues
  /** 本需求涉及的成员仓（执行期注入多仓布局）；缺省/空＝不输出该层（单仓或预览）。 */
  repos?: RepoContext[]
  /** 引擎指定的握手文件绝对路径（执行期注入）；缺省＝协议层用占位（预览态）。 */
  handshakePath?: string
  /**
   * 只读模式（如内容驱动回退的只读回退判定 agent）：**省略「可写范围」与「产出」两节**，强调 agent 只读、
   * 不改文件不写产出。任务段自身也应写明只读。见 content-driven-rollback。
   */
  readOnly?: boolean
}

/** 分节标题（固定中文；面向提交给 AI 的 prompt，非 UI 文案——故不走 i18n）。 */
export const PROMPT_SECTIONS = {
  language: '# 回复语言',
  constitution: '# 宪法',
  task: '# 任务',
  card: '# 你当前正在处理这个需求',
  repos: '# 涉及的成员仓',
  writableScope: '# 可写范围',
  outputs: '# 产出',
  protocol: '# 引擎交互协议'
} as const

/** 握手文件名（引擎在 C 盘 userData 下按 runId/nodeId 组织其绝对路径，不落 worktree、不污染 git）。 */
export const HANDSHAKE_FILENAME = 'handshake.json'

/** 预览态（无真实运行）握手路径占位。 */
const HANDSHAKE_PATH_PLACEHOLDER = '{运行时注入：引擎指定的握手文件绝对路径}'

/**
 * 「引擎交互协议」层正文（固定中文，非 i18n）：教 agent 如何与引擎结构化交互——完成/需决策/失败时
 * 把握手文件写到**引擎指定的绝对路径**（在 worktree 之外、不污染代码仓）然后退出。与 `AgentHandshake` 合约同源。
 */
export function engineProtocolBody(handshakePath?: string): string {
  const p = handshakePath && handshakePath.trim() ? handshakePath : HANDSHAKE_PATH_PLACEHOLDER
  return [
    `你在引擎编排下工作。完成、需要用户决策、或无法继续时，MUST 把握手文件（JSON）写到这个**绝对路径**：\`${p}\`（它在代码仓之外，请勿写进 worktree）。写完即退出；引擎在你退出时读它来决定下一步。`,
    '握手文件字段：',
    '- `status`：`"done"`（已完成）/ `"need-decision"`（需用户拍板才能继续）/ `"failed"`（失败，附 `detail`）。',
    '- `decision`（仅 `need-decision`）：`{ "title": 背景说明, "options": [{ "id", "label", "detail"?, "recommended"? }], "multi"?: 是否多选, "freeInput"?: 是否允许用户自由输入 }`。需要用户拍板时**停下并写它、然后退出**，不要自行臆断。',
    '- `repos`（可选）：本任务实际涉及的成员仓标识列表，供引擎给下游节点收窄目标仓。',
    '- `note`（可选）：一句话小结，会写入需求卡活现状。',
    '你的 stdout 只用于向用户实时展示进度，引擎**不**解析它来判断状态——结构化意图一律走握手文件。'
  ].join('\n')
}

/** 各受支持语言的「回复语言」指令（指令本身用目标语言写，避免歧义）。 */
export const REPLY_LANGUAGE_INSTRUCTION: Record<SupportedLanguage, string> = {
  zh: '请始终用简体中文回复与产出（代码标识符等技术约定除外）。',
  en: 'Always respond and produce output in English (except technical conventions such as code identifiers).'
}

/**
 * 需求卡只注入**描述正文**（不再注入标题/类型/关系等字段）。编辑期无具体卡 → 用占位槽（预览态）；
 * 执行期替换成卡的真实描述；描述为空则整节省略（不把占位文案漏给 AI）。
 */
export const CARD_DESCRIPTION_SLOT = '{运行时注入：当前需求卡的描述（markdown 正文）}'

/** 占位、引导语与默认说明（同上，固定中文）。 */
export const PROMPT_MARKERS = {
  /** 「使用文件」读取失败。 */
  promptUnreadable: '（无法读取 skill 文件内容）',
  /** inline 未填写。 */
  promptEmpty: '（未填写 prompt）',
  /** 可写范围为空＝整条分支可写。 */
  scopeWholeBranch: '整条分支可写。',
  /** 产出区引导语。 */
  outputsIntro: '完成后需产出以下文件：',
  /** 单个产出的模板前导语（其后接 ``` 围栏包住的模板原文）。 */
  templateLead: '按下面这份模板的结构产出（代码块内为模板原文；其中 `<!-- -->` 是写作指引，最终产出请删除、不要保留到文件里）：',
  /** 产出未指定路径。 */
  outputNoPath: '（未指定路径）',
  /** 产出未声明模板。 */
  noTemplate: '（无固定模板，按需自行组织结构）',
  /** 引用的规则库模板解析不到。 */
  unresolvedTemplate: '（引用的规则库模板缺失）'
} as const

function section(title: string, body: string): string {
  return `${title}\n${body}`
}

/**
 * 拼装 agent 节点的完整 prompt。层次顺序固定：回复语言 → 宪法 → 任务 → 需求卡占位 → 可写范围 → 产出。
 * 空层省略（宪法/产出），但回复语言、任务、需求卡占位恒在，可写范围为空给「整条分支可写」默认说明。
 */
export function assembleAgentPrompt(input: AssembleAgentPromptInput): string {
  const blocks: string[] = []

  // 0. 回复语言（恒在）——要求 AI 用设置里的语言回复
  blocks.push(section(PROMPT_SECTIONS.language, REPLY_LANGUAGE_INSTRUCTION[input.language]))

  // 1. 宪法（空则整节省略）
  if (input.constitution.length > 0) {
    const rules = input.constitution.map((r) => `- ${r.name}：${r.text}`).join('\n')
    blocks.push(section(PROMPT_SECTIONS.constitution, rules))
  }

  // 2. 任务（恒在）——inline 文本 / file 已读内容；读不出显错、未填写给提示
  const task =
    input.promptText === null
      ? PROMPT_MARKERS.promptUnreadable
      : input.promptText.trim() === ''
        ? PROMPT_MARKERS.promptEmpty
        : input.promptText
  blocks.push(section(PROMPT_SECTIONS.task, task))

  // 3. 需求卡——只注入**描述正文**，用 '''围栏框住让 AI 明确这是需求正文。执行期无描述则整节省略
  // （不留占位、不漏提示给 AI）；预览期（无真实卡）用占位槽。不再注入标题/类型/关系。
  const desc = input.card?.description?.trim()
  const cardBody = desc ? desc : input.card ? '' : CARD_DESCRIPTION_SLOT
  if (cardBody !== '') {
    blocks.push(`${PROMPT_SECTIONS.card}\n'''\n${cardBody}\n'''`)
  }

  // 3.5 涉及的成员仓（执行期注入多仓布局；空/预览省略）——让 agent 明确各仓路径与主/额外目录
  const repos = (input.repos ?? []).filter((r) => r.name && r.path)
  if (repos.length > 0) {
    const body = repos
      .map((r) => {
        const label = r.tag ? `${r.name}（${r.tag}）` : r.name
        const role = r.primary ? '当前工作目录' : '额外工作目录（--add-dir）'
        return `- ${label}：${r.path}（${role}）`
      })
      .join('\n')
    blocks.push(section(PROMPT_SECTIONS.repos, `本需求涉及以下代码仓，均已在你的工作范围内，请在各自目录里改对应文件：\n${body}`))
  }

  // 4. 可写范围（空则给默认说明，而非省略）——只读模式整节省略（强调不改任何文件）
  if (!input.readOnly) {
    const scope = input.writableScope.filter((s) => s.trim() !== '')
    const scopeBody = scope.length > 0 ? scope.map((s) => `- ${s}`).join('\n') : PROMPT_MARKERS.scopeWholeBranch
    blocks.push(section(PROMPT_SECTIONS.writableScope, scopeBody))
  }

  // 5. 产出（空则整节省略；只读模式也省略）——引导语 + 每个文件标清路径/必选，模板原文用 ``` 围栏包住
  if (!input.readOnly && input.outputs.length > 0) {
    const items = input.outputs
      .map((o) => {
        const path = o.path.trim() === '' ? PROMPT_MARKERS.outputNoPath : o.path
        const head = `## 产出文件：${path}（${o.required ? '必选' : '可选'}）`
        const body =
          o.templateContent === null
            ? PROMPT_MARKERS.noTemplate
            : o.templateContent === undefined
              ? PROMPT_MARKERS.unresolvedTemplate
              : `${PROMPT_MARKERS.templateLead}\n\`\`\`markdown\n${o.templateContent}\n\`\`\``
        return `${head}\n${body}`
      })
      .join('\n\n')
    blocks.push(`${PROMPT_SECTIONS.outputs}\n${PROMPT_MARKERS.outputsIntro}\n\n${items}`)
  }

  // 6. 引擎交互协议（恒在，置于最末）——教 agent 写握手文件到引擎指定绝对路径 + 声明 {repos}
  blocks.push(section(PROMPT_SECTIONS.protocol, engineProtocolBody(input.handshakePath)))

  return blocks.join('\n\n')
}

/**
 * heal / 处置 agent 的**任务段**（替换 `assembleAgentPrompt` 的 `# 任务` 段）。纯函数、确定可复现——
 * 公共输入（宪法/需求卡/引擎交互协议）仍复用 `assembleAgentPrompt`，仅本段不同。见 docs/failure-handling.md §6。
 */

/** 合并冲突 heal 任务段：主线已并入卡分支、以下文件冲突、保留两侧意图解冲突、只改冲突文件、不要自己提交。 */
export function healMergeTask(input: {
  repo: string
  branch: string
  base: string
  conflictFiles: string[]
}): string {
  const files = input.conflictFiles.length
    ? input.conflictFiles.map((f) => `- ${f}`).join('\n')
    : '（未能列出具体文件，请以工作区实际冲突标记为准）'
  return [
    `仓库「${input.repo}」里，这张卡的分支「${input.branch}」要合并回主线「${input.base}」时发生冲突。`,
    '为方便你处理，主线已并入你当前分支，以下文件有冲突：',
    files,
    '请解决全部冲突：**两侧意图都要保留**（既别丢本卡的改动，也别丢主线上他人的改动），清理干净所有冲突标记。',
    '只需把这些文件改到无冲突即可，**不要自己提交**——引擎会提交并校验。'
  ].join('\n')
}

/** 命令失败 heal 任务段：命令 X 失败、输出如下、改代码让它通过、不要自己提交、非代码问题经握手请求决策。 */
export function healCommandTask(input: {
  repo: string
  branch: string
  command: string
  output: string
}): string {
  return [
    `仓库「${input.repo}」分支「${input.branch}」上，命令 \`${input.command}\` 执行失败。失败输出：`,
    input.output.trim() || '（无输出）',
    '请修改代码让这条命令能通过。**改完不要自己提交**——引擎会提交并重跑该命令来验证是否修好。',
    '若你判断这不是代码能修的问题（如缺依赖 / 环境不对），在握手文件里写清原因并请求决策（会转交人工）。'
  ].join('\n')
}

/** 决策处置任务段（无当前 agent 决策收到用户自由输入时）：失败背景 + 用户意见 + 帮用户处理（改/答疑）。 */
export function healDispositionTask(input: {
  repo: string
  branch: string
  background: string
  userInput: string
}): string {
  return [
    `引擎在仓库「${input.repo}」分支「${input.branch}」执行时停下，背景：`,
    input.background.trim() || '（无更多背景）',
    '用户对这个决策说：',
    input.userInput.trim() || '（用户未补充文字）',
    '请帮用户处理：',
    '- 若用户在提问，解释清楚并给出建议（可建议新增决策选项）；',
    '- 若用户要你动手、且这是代码 / 工作区能解决的，就在当前工作区改（改完别自己提交，引擎会提交并重跑验证）；',
    '- 若这不是代码能解决的（如路径被占、凭据、远端、需用户再拍板），在握手文件里说明，并把处置建议作为决策选项交回用户。'
  ].join('\n')
}

/**
 * 只读回退判定任务段（内容驱动回退）：告知 agent 是本需求的**只读顾问**，读驳回意见 + 产物溯源关系，
 * 判断问题最早在哪个节点产生、该回到哪个节点修复（主选 + 备选），把结论写进握手 `decision`。
 * 与 docs/failure-handling.md §6.6 单一来源。配合 `assembleAgentPrompt({ readOnly: true })`（不给可写范围/产出）。
 */
export function rollbackJudgmentTask(input: { node: string; userInput: string; lineage: string }): string {
  return [
    '你是本需求的**只读顾问**，不改任何文件、不写任何产出。',
    `用户在「${input.node}」的人工评审里驳回了，意见是：`,
    input.userInput.trim() || '（用户未补充文字）',
    '',
    '本需求各节点的产物与溯源关系如下（节点 id 用于回填决策）：',
    input.lineage,
    '',
    '请对照上面的产物与溯源关系，判断这条意见指向的问题**最早在哪个节点产生、该回到哪个节点去修复**。',
    '回退是回到该节点在现有进展上修复，**不重置、不作废下游**——被退回节点会带着「已推进到哪、什么问题」续接前向修复。',
    '把结论写进握手文件的 `decision`：',
    '- `options`：候选回退节点，每项 `{ "id": 目标节点的 id, "label": 该节点的名称, "detail": 为什么退到这里, "recommended": true/false }`；',
    '  **把最该回退的那个节点标 `recommended: true`（主选）**，其余为备选（可 0~N 个）。`id` MUST 用上面列出的节点 id 原文。',
    '- `title`：一句话说明你的判断依据。',
    '不要自行修改代码或产出，只给判断。'
  ].join('\n')
}

/**
 * 在规则库里按全限定 ref 取 `output-template` 条目内容，按 `language` 解析为单语言；找不到或类型不符返回 undefined。纯函数。
 */
function findTemplateContent(packs: RulePack[], ref: RulePackItemRef, language: string): string | undefined {
  const pack = packs.find((p) => p.id === ref.packId)
  const item = pack?.items.find((it) => it.id === ref.itemId)
  return item?.kind === 'output-template' ? resolveLocalized(item.content, language) : undefined
}

/**
 * 把节点产出的模板引用解析为内容（none→null；ref 命中→按语言解析的内容；ref 缺失→undefined）。
 * 纯函数，供主进程拼装前调用；`language` 为当前界面语言。
 */
export function resolveOutputs(outputs: WorkflowOutput[], packs: RulePack[], language: string): ResolvedOutput[] {
  return outputs.map((o) => ({
    path: o.destination.path,
    required: o.required,
    templateContent: o.template.kind === 'none' ? null : findTemplateContent(packs, o.template.ref, language)
  }))
}
