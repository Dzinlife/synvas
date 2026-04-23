import {
	type ExportElementAudioSource,
	exportTimelineAsVideoCore,
} from "core/render-system/exportVideo";
import { resolveTimelineEndFrame } from "core/timeline-system/utils/timelineEndFrame";
import type { TimelineElement } from "core/timeline-system/types";
import type { ComponentModelStore as CoreComponentModelStore } from "core/timeline-system/model/types";
import { type ComponentType, createElement, type ReactNode } from "react";
import type { ModelRegistryClass } from "@/element-system/model/registry";
import {
	buildCompositionAudioGraph,
	type CompositionAudioGraph,
} from "@/scene-editor/audio/buildCompositionAudioGraph";
import { getAudioPlaybackSessionKey } from "@/scene-editor/playback/clipContinuityIndex";
import {
	buildSkiaFrameSnapshot,
	buildSkiaRenderState,
} from "@/scene-editor/preview/buildSkiaTree";
import { EditorRuntimeProvider } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

const waitForStaticModelsReady = async (
	elements: TimelineElement[],
	modelRegistry: ModelRegistryClass,
) => {
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

const waitForCompositionAudioModelsReady = async (
	graph: CompositionAudioGraph,
	runtimeManager: Partial<StudioRuntimeManager>,
) => {
	if (!runtimeManager.getTimelineRuntime) return;
	const promises: Promise<void>[] = [];
	const handled = new Set<string>();
	for (const clipRef of graph.physicalClipRefs) {
		const key = `${clipRef.sceneId}:${clipRef.elementId}`;
		if (handled.has(key)) continue;
		handled.add(key);
		const runtime = runtimeManager.getTimelineRuntime(
			toSceneTimelineRef(clipRef.sceneId),
		);
		if (!runtime) continue;
		const store = runtime.modelRegistry.get(clipRef.elementId);
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

type RuntimeProviderComponent = ComponentType<{
	runtime: EditorRuntime;
	children?: ReactNode;
}>;

const createScopedRuntime = (
	runtime: Pick<EditorRuntime, "id" | "timelineStore" | "modelRegistry">,
): EditorRuntime => ({
	id: runtime.id,
	timelineStore: runtime.timelineStore,
	modelRegistry: runtime.modelRegistry,
});

const getExportAudioSourceByElementId = (
	elementId: string,
	modelRegistry: ModelRegistryClass,
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

export const exportTimelineAsVideo = async (options: {
	filename?: string;
	fps?: number;
	startFrame?: number;
	endFrame?: number;
	signal?: AbortSignal;
	onFrame?: (frame: number) => void;
	runtime: EditorRuntime;
}): Promise<void> => {
	const modelRegistry = options.runtime.modelRegistry;
	const timelineState = options.runtime.timelineStore.getState();
	const rootElements = timelineState.elements;
	const rootTracks = timelineState.tracks;
	const fps = Number.isFinite(options?.fps)
		? Math.round(options?.fps as number)
		: Math.round(timelineState.fps || 30);

	const startFrame = Math.max(0, Math.round(options?.startFrame ?? 0));
	const timelineEnd =
		options?.endFrame ?? resolveTimelineEndFrame(rootElements);
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
		const runtimeManager = options.runtime as Partial<StudioRuntimeManager>;
		const rootSceneId =
			runtimeManager.getActiveEditTimelineRef?.()?.sceneId ?? null;
		const rootTimelineRuntime =
			rootSceneId && runtimeManager.getTimelineRuntime
				? runtimeManager.getTimelineRuntime(toSceneTimelineRef(rootSceneId))
				: null;
		const compositionAudioGraph = rootTimelineRuntime
			? buildCompositionAudioGraph({
					rootRuntime: rootTimelineRuntime,
					runtimeManager: runtimeManager as StudioRuntimeManager,
				})
			: null;
		const audioMixElements = compositionAudioGraph?.mixElements ?? rootElements;
		const audioMixTracks = compositionAudioGraph?.mixTracks ?? rootTracks;
		const buildFrameSnapshot = (
			args: Parameters<typeof buildSkiaFrameSnapshot>[0],
		) => {
			const prepare = args.prepare;
			const RuntimeProvider = EditorRuntimeProvider as RuntimeProviderComponent;
			return buildSkiaFrameSnapshot(
				{
					...args,
					elements: rootElements,
					tracks: rootTracks,
					prepare: {
						isExporting: prepare?.isExporting ?? true,
						fps: prepare?.fps ?? fps,
						canvasSize: prepare?.canvasSize ?? timelineState.canvasSize,
						getModelStore: prepare?.getModelStore,
						prepareTransitionPictures: prepare?.prepareTransitionPictures,
						forcePrepareFrames: prepare?.forcePrepareFrames,
						awaitReady: prepare?.awaitReady,
						maxCompositionDepth: prepare?.maxCompositionDepth,
						compositionPath: rootSceneId ? [rootSceneId] : [],
						frameChannel: "offscreen",
					},
				},
				{
					wrapRenderNode: (node) =>
						createElement(RuntimeProvider, { runtime: options.runtime }, node),
					resolveCompositionTimeline: (sceneId) => {
						if (!runtimeManager.getTimelineRuntime) return null;
						const childRuntime = runtimeManager.getTimelineRuntime(
							toSceneTimelineRef(sceneId),
						);
						if (!childRuntime) return null;
						const childState = childRuntime.timelineStore.getState();
						return {
							sceneId,
							elements: childState.elements,
							tracks: childState.tracks,
							fps: childState.fps,
							canvasSize: childState.canvasSize,
							getModelStore: (id: string) =>
								childRuntime.modelRegistry.get(id) as
									| CoreComponentModelStore
									| undefined,
							wrapRenderNode: (node) =>
								createElement(
									RuntimeProvider,
									{
										runtime: createScopedRuntime(childRuntime),
									},
									node,
								),
						};
					},
				},
			);
		};
		const buildFrameRenderState = (
			args: Parameters<typeof buildSkiaRenderState>[0],
		) => {
			const prepare = args.prepare;
			const RuntimeProvider = EditorRuntimeProvider as RuntimeProviderComponent;
			return buildSkiaRenderState(
				{
					...args,
					elements: rootElements,
					tracks: rootTracks,
					prepare: {
						isExporting: prepare?.isExporting ?? true,
						fps: prepare?.fps ?? fps,
						canvasSize: prepare?.canvasSize ?? timelineState.canvasSize,
						getModelStore: prepare?.getModelStore,
						prepareTransitionPictures: prepare?.prepareTransitionPictures,
						forcePrepareFrames: prepare?.forcePrepareFrames,
						awaitReady: prepare?.awaitReady,
						maxCompositionDepth: prepare?.maxCompositionDepth,
						compositionPath: rootSceneId ? [rootSceneId] : [],
						frameChannel: "offscreen",
					},
				},
				{
					wrapRenderNode: (node) =>
						createElement(RuntimeProvider, { runtime: options.runtime }, node),
					resolveCompositionTimeline: (sceneId) => {
						if (!runtimeManager.getTimelineRuntime) return null;
						const childRuntime = runtimeManager.getTimelineRuntime(
							toSceneTimelineRef(sceneId),
						);
						if (!childRuntime) return null;
						const childState = childRuntime.timelineStore.getState();
						return {
							sceneId,
							elements: childState.elements,
							tracks: childState.tracks,
							fps: childState.fps,
							canvasSize: childState.canvasSize,
							getModelStore: (id: string) =>
								childRuntime.modelRegistry.get(id) as
									| CoreComponentModelStore
									| undefined,
							wrapRenderNode: (node) =>
								createElement(
									RuntimeProvider,
									{
										runtime: createScopedRuntime(childRuntime),
									},
									node,
								),
						};
					},
				},
			).then((renderState) => ({
				...renderState,
				children: [
					createElement(
						RuntimeProvider,
						{ runtime: options.runtime },
						renderState.children,
					),
				],
			}));
		};
		await exportTimelineAsVideoCore({
			elements: audioMixElements,
			tracks: audioMixTracks,
			fps,
			canvasSize: timelineState.canvasSize,
			startFrame,
			endFrame,
			filename: options?.filename,
			buildSkiaFrameSnapshot: buildFrameSnapshot,
			buildSkiaRenderState: buildFrameRenderState,
			getModelStore: (id) =>
				modelRegistry.get(id) as CoreComponentModelStore | undefined,
			audio: {
				audioTrackStates: timelineState.audioTrackStates,
				getAudioSourceByElementId: (elementId) =>
					compositionAudioGraph
						? (compositionAudioGraph.exportAudioSourceMap.get(elementId) ??
							null)
						: getExportAudioSourceByElementId(elementId, modelRegistry),
				getAudioSessionKeyByElementId: (elementId) =>
					compositionAudioGraph
						? (compositionAudioGraph.sessionKeyMap.get(elementId) ?? null)
						: getAudioPlaybackSessionKey(rootElements, elementId),
				isElementAudioEnabled: compositionAudioGraph
					? (elementId) =>
							compositionAudioGraph.enabledMap.get(elementId) ?? false
					: undefined,
				dspConfig: timelineState.audioSettings,
			},
			signal: options?.signal,
			waitForReady: async () => {
				await waitForStaticModelsReady(rootElements, modelRegistry);
				if (compositionAudioGraph) {
					await waitForCompositionAudioModelsReady(
						compositionAudioGraph,
						runtimeManager,
					);
				}
			},
			onFrame: (frame) => {
				timelineState.setExportTime(frame);
				options?.onFrame?.(frame);
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
