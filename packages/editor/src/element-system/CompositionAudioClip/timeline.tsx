import type React from "react";
import { useMemo } from "react";
import { AudioGainBaselineControl } from "@/element-system/AudioGainBaselineControl";
import { SceneWaveformCanvas } from "@/element-system/SceneWaveformCanvas";
import { useSceneReferenceRuntimeState } from "@/element-system/useSceneReferenceRuntimeState";
import { hasSceneAudibleLeafAudio } from "@/scene-editor/audio/sceneReferenceAudio";
import {
	useFps,
	useTimelineScale,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
import { isTimelineTrackMuted } from "@/scene-editor/utils/trackAudibility";
import { resolveSceneReferenceSceneIdFromElement } from "@/studio/scene/sceneComposition";
import type { TimelineProps } from "../model/types";

interface CompositionAudioClipTimelineProps extends TimelineProps {
	id: string;
}

export const CompositionAudioClipTimeline: React.FC<
	CompositionAudioClipTimelineProps
> = ({ id, start, end, fps, offsetFrames }) => {
	const { fps: timelineFps } = useFps();
	const { timelineScale } = useTimelineScale();
	const element = useTimelineStore((state) => state.getElementById(id));
	const name = element?.name?.trim() || "Composition Audio";
	const sceneId = element
		? resolveSceneReferenceSceneIdFromElement(element)
		: null;
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
	} = useSceneReferenceRuntimeState(sceneId);

	const hasSourceAudioTrack = useMemo(() => {
		return hasSceneAudibleLeafAudio({
			sceneRuntime: runtime,
			runtimeManager,
		});
	}, [runtime, runtimeManager]);

	const waveformColor = isTrackMuted
		? "rgba(163, 163, 163, 0.9)"
		: "rgba(16, 185, 129, 0.9)";

	return (
		<div
			className={
				isTrackMuted
					? "absolute inset-0 overflow-hidden bg-zinc-700/85"
					: "absolute inset-0 overflow-hidden bg-emerald-800/80"
			}
		>
			{hasSourceAudioTrack && runtime && (
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
				lineClassName={isTrackMuted ? "bg-zinc-100/75" : "bg-emerald-100/75"}
			/>
			<div className="absolute inset-x-0 top-0 z-10 p-1">
				<div
					className={
						isTrackMuted
							? "flex items-center gap-1 text-xs text-zinc-100"
							: "flex items-center gap-1 text-xs text-emerald-50"
					}
				>
					<span
						className={
							isTrackMuted
								? "size-1.5 rounded-full bg-zinc-300"
								: "size-1.5 rounded-full bg-emerald-200"
						}
					/>
					<span className="truncate">{name}</span>
					{sceneId && (
						<span className="truncate text-[10px] opacity-80">{sceneId}</span>
					)}
				</div>
			</div>
		</div>
	);
};
