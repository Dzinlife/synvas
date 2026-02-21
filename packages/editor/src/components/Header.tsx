import { saveTimelineToObject } from "core/editor/timelineLoader";
import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import { Check, FolderPlus, Save } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ExportVideoDialog from "@/editor/components/ExportVideoDialog";
import {
	useTimelineHistory,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { exportTimelineAsVideo } from "@/editor/exportVideo";
import { useProjectStore } from "@/projects/projectStore";

export default function Header() {
	const status = useProjectStore((state) => state.status);
	const projects = useProjectStore((state) => state.projects);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const initialize = useProjectStore((state) => state.initialize);
	const createProject = useProjectStore((state) => state.createProject);
	const saveCurrentProject = useProjectStore(
		(state) => state.saveCurrentProject,
	);
	const switchProject = useProjectStore((state) => state.switchProject);
	const { canUndo, canRedo, undo, redo } = useTimelineHistory();
	const fps = useTimelineStore((state) => state.fps);
	const elements = useTimelineStore((state) => state.elements);
	const canvasSize = useTimelineStore((state) => state.canvasSize);

	useEffect(() => {
		initialize();
	}, [initialize]);

	const currentProject = useMemo(
		() => projects.find((project) => project.id === currentProjectId) ?? null,
		[projects, currentProjectId],
	);

	const getTimelineSnapshot = useEffectEvent(() => {
		const state = useTimelineStore.getState();
		return saveTimelineToObject(
			state.elements,
			state.fps,
			state.canvasSize,
			state.tracks,
			{
				snapEnabled: state.snapEnabled,
				autoAttach: state.autoAttach,
				rippleEditingEnabled: state.rippleEditingEnabled,
				previewAxisEnabled: state.previewAxisEnabled,
				audio: {
					...state.audioSettings,
					compressor: { ...state.audioSettings.compressor },
				},
			},
			state.assets,
		);
	});

	const handleSave = async () => {
		await saveCurrentProject(getTimelineSnapshot());
	};

	const handleCreate = async () => {
		await createProject();
	};

	const handleSwitch = async (id: string) => {
		await switchProject(id);
	};

	const handleExportVideo = useCallback(
		async (options: {
			filename: string;
			fps: number;
			startFrame: number;
			endFrame: number;
			signal: AbortSignal;
			onFrame?: (frame: number) => void;
		}) => {
			await exportTimelineAsVideo(options);
		},
		[],
	);

	const timelineEndFrame = useMemo(
		() => resolveTimelineEndFrame(elements),
		[elements],
	);

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
							onClick={undo}
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
							onClick={redo}
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
						<ExportVideoDialog
							disabled={menuDisabled}
							defaultFps={fps}
							timelineEndFrame={timelineEndFrame}
							canvasSize={canvasSize}
							onExport={handleExportVideo}
						/>
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
