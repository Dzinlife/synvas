import { resolveTimelineEndFrame } from "core/timeline-system/utils/timelineEndFrame";
import {
	EllipsisIcon,
	FocusIcon,
	Minimize2Icon,
	PauseIcon,
	PlayIcon,
} from "lucide-react";
import type { SceneNode } from "@/studio/project/types";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { exportTimelineAsVideo } from "@/scene-editor/exportVideo";
import ExportVideoDialog from "@/scene-editor/components/ExportVideoDialog";
import PreviewLoudnessMeterCanvas from "@/scene-editor/components/PreviewLoudnessMeterCanvas";
import { createScopedStudioRuntime } from "@/scene-editor/runtime/createScopedStudioRuntime";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { usePlaybackOwnerController } from "@/studio/scene/usePlaybackOwnerController";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { framesToTimecode } from "@/utils/timecode";
import type { CanvasNodeToolbarProps } from "../types";

const useTimelineRuntimeValue = <T,>(
	timelineRuntime: TimelineRuntime,
	selector: (state: TimelineStore) => T,
): T => {
	return useSyncExternalStore(
		useCallback(
			(onStoreChange) =>
				timelineRuntime.timelineStore.subscribe(selector, () => {
					onStoreChange();
				}),
			[selector, timelineRuntime],
		),
		useCallback(
			() => selector(timelineRuntime.timelineStore.getState()),
			[selector, timelineRuntime],
		),
		useCallback(
			() => selector(timelineRuntime.timelineStore.getInitialState()),
			[selector, timelineRuntime],
		),
	);
};

const selectCurrentTime = (state: TimelineStore) => state.currentTime;
const selectPreviewTime = (state: TimelineStore) => state.previewTime;
const selectFps = (state: TimelineStore) => state.fps;
const selectElements = (state: TimelineStore) => state.elements;
const selectCanvasSize = (state: TimelineStore) => state.canvasSize;

export const SceneNodeToolbar = ({
	node,
	isFocused = false,
	setActiveScene,
	setFocusedNode,
}: CanvasNodeToolbarProps<SceneNode>) => {
	const runtimeManager = useStudioRuntimeManager() as EditorRuntime &
		StudioRuntimeManager;
	const { togglePlayback, isOwnerPlaying } = usePlaybackOwnerController();
	const sceneRef = useMemo(
		() => toSceneTimelineRef(node.sceneId),
		[node.sceneId],
	);
	const timelineRuntime = useMemo(() => {
		return (
			runtimeManager.getTimelineRuntime(sceneRef) ??
			runtimeManager.ensureTimelineRuntime(sceneRef)
		);
	}, [runtimeManager, sceneRef]);
	const scopedRuntime = useMemo(() => {
		return createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: node.sceneId,
		});
	}, [node.sceneId, runtimeManager]);
	const currentTime = useTimelineRuntimeValue(
		timelineRuntime,
		selectCurrentTime,
	);
	const previewTime = useTimelineRuntimeValue(
		timelineRuntime,
		selectPreviewTime,
	);
	const fps = useTimelineRuntimeValue(timelineRuntime, selectFps);
	const elements = useTimelineRuntimeValue(timelineRuntime, selectElements);
	const canvasSize = useTimelineRuntimeValue(timelineRuntime, selectCanvasSize);
	const isPlaying = isOwnerPlaying(sceneRef);
	const displayTime = previewTime ?? currentTime;
	const previewTimecode = useMemo(() => {
		return framesToTimecode(displayTime, fps);
	}, [displayTime, fps]);
	const timelineEndFrame = useMemo(() => {
		return resolveTimelineEndFrame(elements);
	}, [elements]);
	const handleExportVideo = useCallback(
		async (options: {
			filename: string;
			fps: number;
			startFrame: number;
			endFrame: number;
			signal: AbortSignal;
			onFrame?: (frame: number) => void;
		}) => {
			await exportTimelineAsVideo({
				...options,
				runtime: scopedRuntime,
			});
		},
		[scopedRuntime],
	);

	return (
		<div className="flex items-center gap-3 text-xs text-white/90">
			<Tooltip>
				<TooltipTrigger
					type="button"
					aria-label="Play / Pause"
					className="size-8 rounded-full bg-white/10 p-0 text-white hover:bg-white/20"
					onClick={() => {
						setActiveScene(node.sceneId);
						togglePlayback(sceneRef);
					}}
				>
					{isPlaying ? (
						<PauseIcon className="mx-auto size-4" aria-hidden="true" />
					) : (
						<PlayIcon className="mx-auto size-4" aria-hidden="true" />
					)}
				</TooltipTrigger>
				<TooltipContent>Play / Pause</TooltipContent>
			</Tooltip>
			<div className="font-mono text-md font-medium tracking-tight text-white">
				{previewTimecode}
			</div>
			<PreviewLoudnessMeterCanvas active={isPlaying} />
			<ExportVideoDialog
				defaultFps={fps}
				timelineEndFrame={timelineEndFrame}
				canvasSize={canvasSize}
				onExport={handleExportVideo}
				triggerClassName="h-8 rounded-full px-2 py-1 text-xs"
			/>
			<DropdownMenu>
				<DropdownMenuTrigger
					chevron={false}
					aria-label="Scene options"
					className="size-8 rounded-full border-none bg-white/10 p-0 text-xs text-white hover:bg-white/20"
				>
					<EllipsisIcon className="size-4" aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" side="bottom" className="min-w-36">
					<DropdownMenuItem disabled>Options (TODO)</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					type="button"
					aria-label={isFocused ? "Exit focus" : "Focus"}
					className="size-8 rounded-full bg-white/10 p-0 text-white hover:bg-white/20"
					onClick={() => {
						if (isFocused) {
							setFocusedNode(null);
							return;
						}
						setActiveScene(node.sceneId);
						setFocusedNode(node.id);
					}}
				>
					{isFocused ? (
						<Minimize2Icon className="mx-auto size-4" aria-hidden="true" />
					) : (
						<FocusIcon className="mx-auto size-4" aria-hidden="true" />
					)}
				</TooltipTrigger>
				<TooltipContent>{isFocused ? "Exit focus" : "Focus"}</TooltipContent>
			</Tooltip>
		</div>
	);
};
