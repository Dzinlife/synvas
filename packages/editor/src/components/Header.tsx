import { useEffect, useMemo, useEffectEvent } from "react";
import { Check, ChevronDown, FolderPlus, Save } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectStore } from "@/projects/projectStore";
import { saveTimelineToObject } from "@/editor/timelineLoader";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import { useTranscriptStore } from "@/asr/transcriptStore";

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

	useEffect(() => {
		initialize();
	}, [initialize]);

	const currentProject = useMemo(
		() => projects.find((project) => project.id === currentProjectId) ?? null,
		[projects, currentProjectId],
	);

	const getTimelineSnapshot = useEffectEvent(() => {
		const state = useTimelineStore.getState();
		const transcripts = useTranscriptStore.getState().transcripts;
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
			},
			transcripts,
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

	const menuDisabled = status !== "ready";
	const displayName =
		status === "ready" ? currentProject?.name ?? "未命名项目" : "加载中...";

	return (
		<header className="flex items-center justify-between px-4 py-3 bg-neutral-900 text-neutral-100 border-b border-neutral-800">
			<div className="text-sm font-semibold tracking-wide">AI NLE</div>
			<DropdownMenu>
				<DropdownMenuTrigger
					className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 transition-colors max-w-xs"
					disabled={menuDisabled}
				>
					<span className="truncate max-w-[220px]">{displayName}</span>
					<ChevronDown className="size-4" />
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
										className={isCurrent ? "bg-accent/40" : undefined}
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
		</header>
	);
}
