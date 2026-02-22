import { Check, FolderPlus, Save } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	useStudioRuntimeManager,
	useTimelineStoreApi,
} from "@/editor/runtime/EditorRuntimeProvider";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";

export default function Header() {
	const timelineStore = useTimelineStoreApi();
	const runtimeManager = useStudioRuntimeManager();
	const status = useProjectStore((state) => state.status);
	const projects = useProjectStore((state) => state.projects);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const initialize = useProjectStore((state) => state.initialize);
	const createProject = useProjectStore((state) => state.createProject);
	const saveCurrentProject = useProjectStore(
		(state) => state.saveCurrentProject,
	);
	const flushFocusedSceneDraft = useProjectStore(
		(state) => state.flushFocusedSceneDraft,
	);
	const switchProject = useProjectStore((state) => state.switchProject);
	const canUndo = useStudioHistoryStore((state) => state.canUndo);
	const canRedo = useStudioHistoryStore((state) => state.canRedo);
	const undo = useStudioHistoryStore((state) => state.undo);
	const redo = useStudioHistoryStore((state) => state.redo);

	useEffect(() => {
		initialize();
	}, [initialize]);

	const currentProject = useMemo(
		() => projects.find((project) => project.id === currentProjectId) ?? null,
		[projects, currentProjectId],
	);

	const handleSave = async () => {
		flushFocusedSceneDraft();
		await saveCurrentProject();
	};

	const handleCreate = async () => {
		await createProject();
	};

	const handleSwitch = async (id: string) => {
		await switchProject(id);
	};

	const handleUndo = useCallback(() => {
		undo({ timelineStore, runtimeManager });
	}, [runtimeManager, timelineStore, undo]);
	const handleRedo = useCallback(() => {
		redo({ timelineStore, runtimeManager });
	}, [redo, runtimeManager, timelineStore]);

	const menuDisabled = status !== "ready";
	const displayName =
		status === "ready" ? (currentProject?.name ?? "未命名项目") : "加载中...";

	return (
		<header className="flex items-center justify-between px-4 py-3 bg-neutral-900 text-neutral-100 border-b border-neutral-800">
			<div className="text-sm font-semibold tracking-wide">AI NLE</div>
			<div className="flex items-center gap-2">
				{status === "ready" && (
					<>
						<button
							type="button"
							onClick={handleUndo}
							disabled={!canUndo}
							className={`px-2 py-1 text-xs rounded transition-colors ${
								canUndo
									? "bg-neutral-700 text-white hover:bg-neutral-600"
									: "bg-neutral-800 text-neutral-500 cursor-not-allowed"
							}`}
							title="撤销 (Ctrl/Cmd+Z)"
						>
							撤销
						</button>
						<button
							type="button"
							onClick={handleRedo}
							disabled={!canRedo}
							className={`px-2 py-1 text-xs rounded transition-colors ${
								canRedo
									? "bg-neutral-700 text-white hover:bg-neutral-600"
									: "bg-neutral-800 text-neutral-500 cursor-not-allowed"
							}`}
							title="重做 (Ctrl/Cmd+Shift+Z / Ctrl+Y)"
						>
							重做
						</button>
					</>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger
						className="max-w-xs justify-between"
						disabled={menuDisabled}
					>
						<span className="truncate max-w-[220px]">{displayName}</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={handleCreate} disabled={menuDisabled}>
							<FolderPlus className="size-4" />
							<span>新建</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={handleSave}
							disabled={menuDisabled || !currentProjectId}
						>
							<Save className="size-4" />
							<span>保存</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>所有项目</DropdownMenuLabel>
							{projects.length === 0 ? (
								<DropdownMenuItem disabled>暂无项目</DropdownMenuItem>
							) : (
								projects.map((project) => {
									const isCurrent = project.id === currentProjectId;
									return (
										<DropdownMenuItem
											key={project.id}
											onClick={() => handleSwitch(project.id)}
											className={isCurrent ? "font-medium" : undefined}
										>
											{isCurrent ? (
												<Check className="size-4" />
											) : (
												<span className="size-4" />
											)}
											<span className="truncate">{project.name}</span>
										</DropdownMenuItem>
									);
								})
							)}
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
}
