import type { VideoCanvasNode } from "core/studio/types";
import { useCallback, useContext, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { EditorRuntimeContext } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { framesToTimecode, secondsToFrames } from "@/utils/timecode";
import type { CanvasNodeDrawerProps } from "../types";
import { useVideoNodePlayback } from "./useVideoNodePlayback";

const DEFAULT_FPS = 30;
const TIMELINE_TICK_COUNT = 6;

const isStudioRuntimeManager = (
	value: unknown,
): value is StudioRuntimeManager => {
	if (!value || typeof value !== "object") return false;
	const runtime = value as Partial<StudioRuntimeManager>;
	return (
		typeof runtime.ensureTimelineRuntime === "function" &&
		typeof runtime.getTimelineRuntime === "function" &&
		typeof runtime.listTimelineRuntimes === "function" &&
		typeof runtime.getActiveEditTimelineRuntime === "function"
	);
};

const resolvePlaybackFps = (runtimeManager: StudioRuntimeManager | null): number => {
	const rawFps = runtimeManager
		?.getActiveEditTimelineRuntime()
		?.timelineStore.getState().fps;
	if (typeof rawFps !== "number" || !Number.isFinite(rawFps) || rawFps <= 0) {
		return DEFAULT_FPS;
	}
	return Math.round(rawFps);
};

const resolveAssetUri = (
	asset: CanvasNodeDrawerProps<VideoCanvasNode>["asset"],
	projectId: string | null,
): string | null => {
	if (!asset || asset.kind !== "video") return null;
	return resolveAssetPlayableUri(asset, { projectId });
};

const clampProgress = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
};

const toTimecode = (seconds: number, fps: number): string => {
	return framesToTimecode(secondsToFrames(seconds, fps), fps);
};

export const VideoNodeDrawer = ({
	node,
	asset,
}: CanvasNodeDrawerProps<VideoCanvasNode>) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo(() => {
		if (!isStudioRuntimeManager(runtime)) return null;
		return runtime;
	}, [runtime]);
	const fps = resolvePlaybackFps(runtimeManager);
	const assetUri = resolveAssetUri(asset, currentProjectId);
	const { snapshot, togglePlayback, seekToTime } = useVideoNodePlayback({
		nodeId: node.id,
		assetUri,
		fps,
		runtimeManager,
	});
	const duration = Math.max(0, snapshot.duration);
	const currentTime = Math.min(duration, Math.max(0, snapshot.currentTime));
	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
	const currentTimecode = toTimecode(currentTime, fps);
	const durationTimecode = toTimecode(duration, fps);
	const tickMarks = useMemo(() => {
		const list: Array<{ key: string; left: string; label: string }> = [];
		for (let index = 0; index <= TIMELINE_TICK_COUNT; index += 1) {
			const ratio = index / TIMELINE_TICK_COUNT;
			const seconds = duration * ratio;
			list.push({
				key: `tick-${index}`,
				left: `${ratio * 100}%`,
				label: toTimecode(seconds, fps),
			});
		}
		return list;
	}, [duration, fps]);

	const handleProgressChange = useCallback(
		(values: number | readonly number[]) => {
			const value = Array.isArray(values) ? values[0] : values;
			const percent = clampProgress(value);
			const nextTime = duration * (percent / 100);
			void seekToTime(nextTime);
		},
		[duration, seekToTime],
	);

	return (
		<div className="flex h-full min-h-0 flex-col gap-4 p-4" data-testid="video-node-drawer-content">
			<div className="flex items-center gap-3">
				<button
					type="button"
					className="rounded bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
					onClick={() => {
						void togglePlayback();
					}}
					aria-label={snapshot.isPlaying ? "暂停视频" : "播放视频"}
				>
					{snapshot.isPlaying ? "暂停" : "播放"}
				</button>
				<div className="text-xs font-mono text-white/80 tabular-nums" data-testid="video-node-timecode">
					{currentTimecode} / {durationTimecode}
				</div>
				{snapshot.isLoading ? (
					<div className="text-xs text-white/50">加载中...</div>
				) : null}
				{snapshot.errorMessage ? (
					<div className="text-xs text-rose-300" data-testid="video-node-error-message">
						{snapshot.errorMessage}
					</div>
				) : null}
			</div>

			<div data-testid="video-node-progress-slider">
				<Slider
					min={0}
					max={100}
					step={0.1}
					value={[clampProgress(progress)]}
					onValueChange={handleProgressChange}
					className="w-full py-1"
				/>
			</div>

			<div className="relative h-11" data-testid="video-node-timeline">
				<div className="absolute left-0 right-0 top-2 h-px bg-white/15" />
				{tickMarks.map((tick) => (
					<div
						key={tick.key}
						className="absolute top-0 -translate-x-1/2"
						style={{ left: tick.left }}
						data-testid="video-node-timeline-tick"
					>
						<div className="h-2 w-px bg-white/35" />
						<div className="mt-1 text-[10px] font-mono text-white/45 tabular-nums">
							{tick.label}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};
