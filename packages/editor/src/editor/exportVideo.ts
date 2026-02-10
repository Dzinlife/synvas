import type { TimelineElement } from "core/dsl/types";
import {
	type ExportElementAudioSource,
	exportTimelineAsVideoCore,
} from "core/editor/exportVideo";
import { modelRegistry } from "@/dsl/model/registry";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import { getAudioPlaybackSessionKey } from "@/editor/playback/clipContinuityIndex";
import { buildSkiaRenderState } from "@/editor/preview/buildSkiaTree";

const waitForStaticModelsReady = async (elements: TimelineElement[]) => {
	const promises: Promise<void>[] = [];
	for (const element of elements) {
		const store = modelRegistry.get(element.id);
		if (!store) continue;
		const state = store.getState();
		if (state.type === "VideoClip") continue;
		if (state.waitForReady) {
			promises.push(state.waitForReady());
		}
	}
	await Promise.all(promises);
};

type ExportAudioModelInternal = {
	audioSink?: ExportElementAudioSource["audioSink"];
	audioDuration?: number;
};

const getExportAudioSourceByElementId = (
	elementId: string,
): ExportElementAudioSource | null => {
	const store = modelRegistry.get(elementId);
	if (!store) return null;
	const internal = store.getState().internal as ExportAudioModelInternal;
	if (!internal.audioSink) return null;
	if (
		!Number.isFinite(internal.audioDuration) ||
		(internal.audioDuration ?? 0) <= 0
	) {
		return null;
	}
	return {
		audioSink: internal.audioSink,
		audioDuration: internal.audioDuration ?? 0,
	};
};

export const exportTimelineAsVideo = async (options?: {
	filename?: string;
	fps?: number;
	startFrame?: number;
	endFrame?: number;
}): Promise<void> => {
	const timelineState = useTimelineStore.getState();
	const elements = timelineState.elements;
	const tracks = timelineState.tracks;
	const fps = Number.isFinite(options?.fps)
		? Math.round(options?.fps as number)
		: Math.round(timelineState.fps || 30);

	const startFrame = Math.max(0, Math.round(options?.startFrame ?? 0));
	const timelineEnd =
		options?.endFrame ??
		elements.reduce(
			(max, el) => Math.max(max, Math.round(el.timeline.end ?? 0)),
			0,
		);
	const endFrame = Math.max(startFrame, Math.round(timelineEnd));

	const previousState = {
		isPlaying: timelineState.isPlaying,
		currentTime: timelineState.currentTime,
		previewTime: timelineState.previewTime,
		previewAxisEnabled: timelineState.previewAxisEnabled,
		isExporting: timelineState.isExporting,
		exportTime: timelineState.exportTime,
	};

	timelineState.pause();
	timelineState.setPreviewAxisEnabled(false);
	timelineState.setPreviewTime(null);
	timelineState.setIsExporting(true);
	timelineState.setExportTime(startFrame);

	try {
		await exportTimelineAsVideoCore({
			elements,
			tracks,
			fps,
			canvasSize: timelineState.canvasSize,
			startFrame,
			endFrame,
			filename: options?.filename,
			buildSkiaRenderState,
			getModelStore: (id) => modelRegistry.get(id),
			audio: {
				audioTrackStates: timelineState.audioTrackStates,
				getAudioSourceByElementId: getExportAudioSourceByElementId,
				getAudioSessionKeyByElementId: (elementId) =>
					getAudioPlaybackSessionKey(elements, elementId),
				dspConfig: timelineState.audioSettings,
			},
			waitForReady: () => waitForStaticModelsReady(elements),
			onFrame: (frame) => {
				timelineState.setExportTime(frame);
			},
		});
	} finally {
		timelineState.setIsExporting(previousState.isExporting);
		timelineState.setExportTime(previousState.exportTime ?? null);
		timelineState.setPreviewAxisEnabled(previousState.previewAxisEnabled);
		timelineState.setPreviewTime(previousState.previewTime);
		timelineState.setCurrentTime(previousState.currentTime);
		if (previousState.isPlaying) {
			timelineState.play();
		} else {
			timelineState.pause();
		}
	}
};
