import { createTrackLockedMap } from "core/editor/command/move";
import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import type { CompositionProps, TimelineElement } from "core/element/types";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { useProjectStore } from "@/projects/projectStore";
import type { EditorRuntime } from "@/scene-editor/runtime/types";
import { findAttachments } from "@/scene-editor/utils/attachments";
import { reflowInsertedElementsOnTracks } from "@/scene-editor/utils/insertedTrackReflow";
import {
	finalizeTimelineElements,
	shiftMainTrackElementsAfter,
} from "@/scene-editor/utils/mainTrackMagnet";
import { updateElementTime } from "@/scene-editor/utils/timelineTime";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

const DEFAULT_FPS = 30;
type SceneReferenceElementType = "Composition" | "CompositionAudioClip";

const validateSceneId = (sceneId: unknown): ValidationResult => {
	if (typeof sceneId !== "string" || sceneId.trim().length === 0) {
		return {
			valid: false,
			errors: ["sceneId is required"],
		};
	}
	return { valid: true, errors: [] };
};

const normalizeFps = (value: number | undefined): number => {
	if (!Number.isFinite(value) || value === undefined || value <= 0) {
		return DEFAULT_FPS;
	}
	return Math.max(1, Math.round(value));
};

const normalizeOffsetFrames = (value: unknown): number => {
	if (!Number.isFinite(value as number)) return 0;
	return Math.max(0, Math.round(value as number));
};

const computeMaxDuration = (params: {
	sourceDurationFrames: number;
	sourceFps: number;
	targetFps: number;
	offsetFrames: number;
}): number | undefined => {
	const { sourceDurationFrames, sourceFps, targetFps, offsetFrames } = params;
	if (sourceDurationFrames <= 0) return undefined;
	const convertedSourceDuration = Math.max(
		0,
		Math.round((sourceDurationFrames / sourceFps) * targetFps),
	);
	if (convertedSourceDuration <= 0) return undefined;
	return Math.max(1, convertedSourceDuration - offsetFrames);
};

const applyDurationChangeWithTimelineRules = (params: {
	elements: TimelineElement[];
	elementId: string;
	nextDuration: number;
	fps: number;
	rippleEditingEnabled: boolean;
	attachments: Map<string, string[]>;
	autoAttach: boolean;
	trackLockedMap: Map<number, boolean>;
}): TimelineElement[] => {
	const {
		elements,
		elementId,
		nextDuration,
		fps,
		rippleEditingEnabled,
		attachments,
		autoAttach,
		trackLockedMap,
	} = params;
	const target = elements.find((element) => element.id === elementId);
	if (!target) return elements;
	const normalizedDuration = Math.max(1, Math.round(nextDuration));
	const nextEnd = target.timeline.start + normalizedDuration;
	if (nextEnd === target.timeline.end) return elements;
	const delta = nextEnd - target.timeline.end;
	const trackIndex = target.timeline.trackIndex ?? 0;

	if (trackIndex === 0 && rippleEditingEnabled) {
		return shiftMainTrackElementsAfter(elements, elementId, nextEnd, delta, {
			attachments,
			autoAttach,
			fps,
			trackLockedMap,
		});
	}

	let boundedEnd = nextEnd;
	if (trackIndex === 0 && !rippleEditingEnabled) {
		const nextNeighborStart = elements
			.filter((element) => element.id !== elementId)
			.filter((element) => element.type !== "Transition")
			.filter((element) => (element.timeline.trackIndex ?? 0) === 0)
			.filter((element) => element.timeline.start >= target.timeline.end)
			.reduce<number | null>((minValue, element) => {
				if (minValue === null) return element.timeline.start;
				return Math.min(minValue, element.timeline.start);
			}, null);
		if (nextNeighborStart !== null) {
			boundedEnd = Math.min(boundedEnd, nextNeighborStart);
		}
		boundedEnd = Math.max(target.timeline.start + 1, boundedEnd);
	}

	let updated = elements.map((element) => {
		if (element.id !== elementId) return element;
		return updateElementTime(element, element.timeline.start, boundedEnd, fps);
	});
	const updatedTarget = updated.find((element) => element.id === elementId);
	if (!updatedTarget) return elements;

	// 自动变化后把目标片段重新尝试放回可用轨道，避免覆盖现有元素。
	const reflowedTarget = reflowInsertedElementsOnTracks(
		updated.filter((element) => element.id !== elementId),
		[updatedTarget],
	)[0];
	if (reflowedTarget) {
		updated = updated.map((element) =>
			element.id === elementId ? reflowedTarget : element,
		);
	}

	return finalizeTimelineElements(updated, {
		rippleEditingEnabled,
		attachments,
		autoAttach,
		fps,
		trackLockedMap,
	});
};

const resolveSourceDuration = (
	sceneId: string,
): {
	durationFrames: number;
	fps: number;
} | null => {
	const currentProject = useProjectStore.getState().currentProject;
	if (!currentProject) return null;
	const sourceScene = currentProject.scenes[sceneId];
	if (!sourceScene) return null;
	return {
		durationFrames: resolveTimelineEndFrame(sourceScene.timeline.elements),
		fps: normalizeFps(sourceScene.timeline.fps),
	};
};

export type CompositionModelStore = ComponentModelStore<CompositionProps>;

const createSceneReferenceClipModel = (
	elementType: SceneReferenceElementType,
	id: string,
	initialProps: CompositionProps,
	runtime: EditorRuntime,
): CompositionModelStore => {
	const timelineStore = runtime.timelineStore;
	const initialValidation = validateSceneId(initialProps.sceneId);
	const initialSceneId = initialValidation.valid
		? initialProps.sceneId.trim()
		: "";

	let unsubscribeProject: (() => void) | null = null;
	let unsubscribeTimelineOffset: (() => void) | null = null;
	let lastSourceSignature: string | null = null;

	const refreshFromSourceScene = (options?: { allowAutoAdjust?: boolean }) => {
		const sceneId = store.getState().props.sceneId;
		const source = resolveSourceDuration(sceneId);
		if (!source) {
			lastSourceSignature = null;
			store.setState((state) => ({
				constraints: {
					...state.constraints,
					maxDuration: undefined,
				},
			}));
			return;
		}

		const timelineState = timelineStore.getState();
		const element = timelineState.getElementById(id);
		if (!element) return;

		const targetFps = normalizeFps(timelineState.fps);
		const offsetFrames = normalizeOffsetFrames(element.timeline.offset);
		const nextMaxDuration = computeMaxDuration({
			sourceDurationFrames: source.durationFrames,
			sourceFps: source.fps,
			targetFps,
			offsetFrames,
		});
		const sourceSignature = `${sceneId}:${source.durationFrames}:${source.fps}`;
		const didSourceDurationChange = sourceSignature !== lastSourceSignature;
		lastSourceSignature = sourceSignature;

		const previousMaxDuration = store.getState().constraints.maxDuration;
		if (nextMaxDuration !== previousMaxDuration) {
			store.setState((state) => ({
				constraints: {
					...state.constraints,
					maxDuration: nextMaxDuration,
				},
			}));
		}
		if (!options?.allowAutoAdjust || !didSourceDurationChange) return;
		if (nextMaxDuration === undefined) return;

		const currentDuration = Math.max(
			1,
			element.timeline.end - element.timeline.start,
		);
		const shouldShrink = currentDuration > nextMaxDuration;
		const shouldGrow =
			previousMaxDuration !== undefined &&
			currentDuration === previousMaxDuration &&
			nextMaxDuration > previousMaxDuration;
		if (!shouldShrink && !shouldGrow) return;

		const nextElements = applyDurationChangeWithTimelineRules({
			elements: timelineState.elements,
			elementId: id,
			nextDuration: nextMaxDuration,
			fps: targetFps,
			rippleEditingEnabled: timelineState.rippleEditingEnabled,
			attachments: findAttachments(timelineState.elements),
			autoAttach: timelineState.autoAttach,
			trackLockedMap: createTrackLockedMap(
				timelineState.tracks,
				timelineState.audioTrackStates,
			),
		});
		if (nextElements === timelineState.elements) return;
		const propagatedOpId = useStudioHistoryStore
			.getState()
			.getLatestTimelineOpId(sceneId);
		const fallbackHistoryOpId =
			useProjectStore.getState().sceneTimelineMutationOpIds[sceneId];
		timelineState.setElements(nextElements, {
			history: true,
			txnId: propagatedOpId ?? fallbackHistoryOpId,
			causedBy: propagatedOpId ? [propagatedOpId] : [],
			intent: "derived",
		});
	};

	const store = createStore<ComponentModel<CompositionProps>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: elementType,
			props: {
				sceneId: initialSceneId,
			},
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {},

			setProps: (partial) => {
				const nextSceneId =
					partial.sceneId ?? (get().props.sceneId as unknown as string);
				const result = validateSceneId(nextSceneId);
				if (!result.valid) return result;
				set((state) => ({
					...state,
					props: {
						...state.props,
						...partial,
						sceneId: String(nextSceneId).trim(),
					},
				}));
				lastSourceSignature = null;
				refreshFromSourceScene({ allowAutoAdjust: false });
				return result;
			},

			setConstraints: (partial) => {
				set((state) => ({
					...state,
					constraints: { ...state.constraints, ...partial },
				}));
			},

			setInternal: (partial) => {
				set((state) => ({
					...state,
					internal: { ...state.internal, ...partial },
				}));
			},

			validate: (newProps) => validateSceneId(newProps.sceneId),

			init: () => {
				refreshFromSourceScene({ allowAutoAdjust: false });
				if (!unsubscribeProject) {
					unsubscribeProject = useProjectStore.subscribe((state, prevState) => {
						if (state.currentProject === prevState.currentProject) return;
						refreshFromSourceScene({ allowAutoAdjust: true });
					});
				}
				if (!unsubscribeTimelineOffset) {
					unsubscribeTimelineOffset = timelineStore.subscribe(
						(state) => state.getElementById(id)?.timeline?.offset ?? 0,
						() => {
							refreshFromSourceScene({ allowAutoAdjust: false });
						},
					);
				}
			},

			dispose: () => {
				unsubscribeProject?.();
				unsubscribeProject = null;
				unsubscribeTimelineOffset?.();
				unsubscribeTimelineOffset = null;
			},
		})),
	);

	return store;
};

export function createCompositionModel(
	id: string,
	initialProps: CompositionProps,
	runtime: EditorRuntime,
): CompositionModelStore {
	return createSceneReferenceClipModel(
		"Composition",
		id,
		initialProps,
		runtime,
	);
}

export function createCompositionAudioClipModel(
	id: string,
	initialProps: CompositionProps,
	runtime: EditorRuntime,
): CompositionModelStore {
	return createSceneReferenceClipModel(
		"CompositionAudioClip",
		id,
		initialProps,
		runtime,
	);
}
