import type React from "react";
import { useMemo } from "react";
import { AudioGainBaselineControl } from "@/element/AudioGainBaselineControl";
import { SceneThumbnailStripCanvas } from "@/element/SceneThumbnailStripCanvas";
import { SceneWaveformCanvas } from "@/element/SceneWaveformCanvas";
import { useSceneReferenceRuntimeState } from "@/element/useSceneReferenceRuntimeState";
import { cn } from "@/lib/utils";
import { hasSceneAudibleLeafAudio } from "@/scene-editor/audio/sceneReferenceAudio";
import {
	useFps,
	useTimelineScale,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
import { isCompositionSourceAudioMuted } from "@/scene-editor/utils/compositionAudioSeparation";
import { isTimelineTrackMuted } from "@/scene-editor/utils/trackAudibility";
import { resolveSceneReferenceSceneIdFromElement } from "@/studio/scene/sceneComposition";
import type { TimelineProps } from "../model/types";

interface CompositionTimelineProps extends TimelineProps {
	id: string;
}

export const CompositionTimeline: React.FC<CompositionTimelineProps> = ({
	id,
	start,
	end,
	fps,
	offsetFrames,
}) => {
	const { fps: timelineFps } = useFps();
	const { timelineScale } = useTimelineScale();
	const element = useTimelineStore((state) => state.getElementById(id));
	const name = element?.name?.trim() || "Composition";
	const sceneId = element
		? resolveSceneReferenceSceneIdFromElement(element)
		: null;
	const isSourceAudioMuted = isCompositionSourceAudioMuted(element);
	const clipGainDb = element?.clip?.gainDb ?? 0;
	const storeOffsetFrames = useTimelineStore(
		(state) => state.getElementById(id)?.timeline?.offset ?? 0,
	);
	const effectiveOffsetFrames = offsetFrames ?? storeOffsetFrames;
	const scrollLeft = useTimelineStore((state) => state.scrollLeft);
	const isTrackMuted = useTimelineStore((state) =>
		isTimelineTrackMuted(
			state.getElementById(id)?.timeline,
			state.tracks,
			state.audioTrackStates,
		),
	);
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : timelineFps;
	const {
		runtime,
		runtimeManager,
		contentRevision,
		fps: sourceFps,
		durationFrames: sourceDurationFrames,
		canvasSize,
	} = useSceneReferenceRuntimeState(sceneId);

	const hasSourceAudioTrack = useMemo(() => {
		return hasSceneAudibleLeafAudio({
			sceneRuntime: runtime,
			runtimeManager,
		});
	}, [runtime, runtimeManager]);

	const shouldShowWaveform = hasSourceAudioTrack && !isSourceAudioMuted;
	const waveformColor = isTrackMuted
		? "rgba(163, 163, 163, 0.88)"
		: "rgba(34, 211, 238, 0.92)";

	return (
		<div className="absolute inset-0 overflow-hidden bg-zinc-800">
			<div className="absolute left-1 top-1 z-10 flex h-4.5 max-w-[calc(100%-8px)] min-w-0 items-center gap-1 rounded-xs bg-black/20 px-1 leading-none backdrop-blur-2xl">
				<span className="truncate text-xs text-white">{name}</span>
				{sceneId && (
					<span className="truncate text-[10px] text-cyan-100/90">
						{sceneId}
					</span>
				)}
			</div>

			<SceneThumbnailStripCanvas
				sceneRuntime={runtime}
				runtimeManager={runtimeManager}
				sceneRevision={contentRevision}
				sourceFps={sourceFps}
				sourceDurationFrames={sourceDurationFrames}
				sourceCanvasSize={canvasSize}
				start={start}
				end={end}
				fps={safeFps}
				timelineScale={timelineScale}
				offsetFrames={effectiveOffsetFrames}
				scrollLeft={scrollLeft}
				isOffsetPreviewing={offsetFrames !== undefined}
				className={cn(
					"absolute top-0 w-full",
					shouldShowWaveform ? "bottom-5.5" : "bottom-0",
				)}
			/>

			{shouldShowWaveform && (
				<div
					className={cn(
						"absolute inset-x-0 bottom-0 h-5.5 overflow-hidden",
						isTrackMuted ? "bg-neutral-500/20" : "bg-cyan-500/20",
					)}
				>
					{runtime && (
						<SceneWaveformCanvas
							sceneRuntime={runtime}
							runtimeManager={runtimeManager}
							sceneRevision={contentRevision}
							sourceFps={sourceFps}
							gainDb={clipGainDb}
							start={start}
							end={end}
							fps={safeFps}
							timelineScale={timelineScale}
							offsetFrames={effectiveOffsetFrames}
							scrollLeft={scrollLeft}
							color={waveformColor}
							className="absolute inset-0"
						/>
					)}
					<AudioGainBaselineControl
						elementId={id}
						lineClassName={isTrackMuted ? "bg-zinc-100/70" : "bg-cyan-100/80"}
					/>
				</div>
			)}
		</div>
	);
};
