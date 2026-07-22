import { Box, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DetectedAgent, Project, SidebarViewState } from '@shared/types'
import type { SupportedLanguage } from '@shared/language'
import type { Appearance } from '@shared/appearance'
import type { AgentId, EffortLevel } from '@shared/agents'
import { projectRootPath } from '@shared/project'
import { FileTree } from './FileTree'
import { MissingNotice } from './RepoGroup'
import { GitView } from './GitView'
import { ProjectSwitcher } from './ProjectSwitcher'
import { Settings } from './Settings'

interface SidebarProps {
  current: Project | null
  projects: Project[]
  refreshKey: number
  language: SupportedLanguage
  /** 侧边栏宽度（px），由 App 持有并下发。 */
  width: number
  /** 侧边栏视图选择（文件树/git + git 下的成员仓/分支），由 App 持有并持久化。 */
  viewState: SidebarViewState
  onChangeViewState: (next: SidebarViewState) => void
  onSelectProject: (projectId: string) => void
  onImport: () => void
  onRelocateMember: (projectId: string, memberId: string) => void
  /** 整体移除当前项目（项目目录缺失时使用）。 */
  onRemoveProject: (projectId: string) => void
  onChangeLanguage: (language: SupportedLanguage) => void
  /** 当前外观偏好。 */
  appearance: Appearance
  /** 用户切换外观时回调。 */
  onChangeAppearance: (appearance: Appearance) => void
  /** 本机已检测到的 agent（设置面板默认 agent/模型下拉用）。 */
  detectedAgents: DetectedAgent[]
  /** 当前默认 agent（未选择为 null）。 */
  defaultAgent: AgentId | null
  /** 当前默认模型（未选择为 null）。 */
  defaultModel: string | null
  /** 用户切换默认 agent 时回调。 */
  onChangeDefaultAgent: (agentId: AgentId) => void
  /** 用户切换默认模型时回调。 */
  onChangeDefaultModel: (modelId: string) => void
  /** 当前默认 effort（未设置为 null）。 */
  defaultEffort: EffortLevel | null
  /** 用户切换默认 effort 时回调。 */
  onChangeDefaultEffort: (effort: EffortLevel | null) => void
  /** 用户在项目工作流选择器激活某工作流后回调（驱动主面板看板列重算）。 */
  onActiveWorkflowChange?: (workflowId: string) => void
  /** 右边缘分隔条的指针事件（拖动逻辑在 App，含 pointer capture）。 */
  onResizeStart?: (e: React.PointerEvent) => void
  onResizeMove?: (e: React.PointerEvent) => void
  onResizeEnd?: (e: React.PointerEvent) => void
}

export function Sidebar({
  current,
  projects,
  refreshKey,
  language,
  width,
  viewState,
  onChangeViewState,
  onSelectProject,
  onImport,
  onRelocateMember,
  onRemoveProject,
  onChangeLanguage,
  appearance,
  onChangeAppearance,
  detectedAgents,
  defaultAgent,
  defaultModel,
  onChangeDefaultAgent,
  onChangeDefaultModel,
  defaultEffort,
  onChangeDefaultEffort,
  onActiveWorkflowChange,
  onResizeStart,
  onResizeMove,
  onResizeEnd
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  const members = current?.members ?? []
  const single = members.length === 1 ? members[0] : null
  const isGit = viewState.view === 'git'
  // 项目目录缺失：所有成员都在磁盘上找不到（容器被删/移走时其子仓也随之缺失）。
  const rootMissing = members.length > 0 && members.every((m) => m.missing)

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-stone-100 bg-canvas"
    >
      {/* 顶部视图切换：文件树 / git。默认文件树。激活态用 cobalt-50 chip（品牌 §07）。 */}
      <div className="flex items-center justify-center gap-1.5 px-1 py-2">
        <button
          type="button"
          onClick={() => onChangeViewState({ ...viewState, view: 'files' })}
          aria-label={t('sidebar.filesView')}
          aria-pressed={!isGit}
          className={`flex h-7 w-8 items-center justify-center rounded ${!isGit ? 'bg-cobalt-50 text-cobalt-800' : 'text-stone-600 hover:bg-stone-100 hover:text-ink'}`}
        >
          <Box size={15} />
        </button>
        <button
          type="button"
          onClick={() => onChangeViewState({ ...viewState, view: 'git' })}
          aria-label={t('sidebar.gitView')}
          aria-pressed={isGit}
          className={`flex h-7 w-8 items-center justify-center rounded ${isGit ? 'bg-cobalt-50 text-cobalt-800' : 'text-stone-600 hover:bg-stone-100 hover:text-ink'}`}
        >
          <GitBranch size={15} />
        </button>
      </div>

      {isGit ? (
        <GitView
          current={current}
          viewState={viewState}
          onChangeViewState={onChangeViewState}
          refreshKey={refreshKey}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
        {!current ? (
          <p className="px-3 py-4 text-[13px] text-stone-600">{t('sidebar.noProjectHint')}</p>
        ) : rootMissing ? (
          // 项目目录找不到了：给出项目级提示（可移除；单仓可重新定位到新路径）。
          <MissingNotice
            message={t('sidebar.projectMissingMessage')}
            removeLabel={t('sidebar.removeFromList')}
            onRelocate={single ? () => onRelocateMember(current.id, single.id) : undefined}
            onRemove={() => onRemoveProject(current.id)}
          />
        ) : (
          // 以项目目录为根，像资源管理器一样列出其下全部文件夹与文件（子仓只是普通文件夹）。
          <FileTree rootPath={projectRootPath(current)} refreshKey={refreshKey} />
        )}
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-stone-100 p-1">
        <div className="min-w-0 flex-1">
          <ProjectSwitcher
            current={current}
            projects={projects}
            onSelect={onSelectProject}
            onImport={onImport}
            onManage={() => window.klarit.openManageWindow()}
          />
        </div>
        {/* 新建需求入口已移至主面板看板「待办」列底部的「+ 创建」按钮（见 KanbanBoard）。 */}
        <Settings
          language={language}
          onChangeLanguage={onChangeLanguage}
          appearance={appearance}
          onChangeAppearance={onChangeAppearance}
          detectedAgents={detectedAgents}
          defaultAgent={defaultAgent}
          defaultModel={defaultModel}
          defaultEffort={defaultEffort}
          onChangeDefaultAgent={onChangeDefaultAgent}
          onChangeDefaultModel={onChangeDefaultModel}
          onChangeDefaultEffort={onChangeDefaultEffort}
          onActiveWorkflowChange={onActiveWorkflowChange}
          project={current}
        />
      </div>

      {/* 右边缘分隔条：默认隐形（透明命中区），hover 显形为一条细线。拖动逻辑在 App。 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resizeHandle')}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        className="absolute right-0 top-0 h-full w-1 translate-x-1/2 cursor-col-resize bg-transparent hover:bg-cobalt-300"
      />
    </aside>
  )
}
