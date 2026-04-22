import {
	CLIP_GAIN_DB_DEFAULT,
	resolveClipGainDb,
} from "core/editor/audio/clipGain";
import type { ExportElementAudioSource } from "core/editor/exportVideo";
import { isTimelineTrackAudible } from "core/editor/utils/trackAudibility";
import type { TimelineElement, TimelineMeta } from "core/element/types";
import type { AudioBufferSink } from "mediabunny";
import type { AudioPlaybackMixInstruction } from "@/audio/types";
import { getAudioPlaybackSessionKey } from "@/scene-editor/playback/clipContinuityIndex";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import type { TimelineTrack } from "@/scene-editor/timeline/types";
import { isCompositionSourceAudioMuted } from "@/scene-editor/utils/compositionAudioSeparation";
import { isVideoSourceAudioMuted } from "@/scene-editor/utils/videoClipAudioSeparation";
import { resolveSceneReferenceSceneIdFromElement } from "@/studio/scene/sceneComposition";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { AudioMixTarget } from "./TimelineAudioMixRunner";
import type { AudioMixInstruction } from "./transitionAudioMix";

const DEFAULT_MAX_COMPOSITION_DEPTH = 16;
const DEFAULT_FPS = 30;
const MIX_TRACK_ID = "__composition_audio_mix_track__";
const MIX_PROXY_COMPONENT = "__composition_audio_proxy__";
const MIX_DEFAULT_TRACKS: TimelineTrack[] = [
	{
		id: MIX_TRACK_ID,
		role: "clip",
		hidden: false,
		locked: false,
		muted: false,
		solo: false,
	},
];

type PhysicalClipRef = {
	sceneId: string;
	elementId: string;
	runtimeId: string;
};

type AudioModelInternal = {
	audioDuration?: number;
	audioSink?: AudioBufferSink | null;
	applyAudioMix?: (
		instruction: AudioPlaybackMixInstruction | null,
	) => void | Promise<void>;
};

type PendingPreviewTarget = {
	id: string;
	timeline: TimelineMeta;
	audioDuration: number;
	enabled: boolean;
	applyAudioMix: (
		instruction: AudioMixInstruction | null,
	) => void | Promise<void>;
};

type VirtualClipNode = {
	virtualId: string;
	physical: PhysicalClipRef;
	timeline: TimelineMeta;
	enabled: boolean;
	previewTarget: PendingPreviewTarget | null;
	exportSource: ExportElementAudioSource | null;
};

type LocalFlattenResult = {
	mixElements: TimelineElement[];
	clipNodes: VirtualClipNode[];
	descendantClipIdsByLocalElementId: Map<string, string[]>;
	clipTimelineByVirtualId: Map<string, TimelineMeta>;
};

type BuildFlattenContext = {
	rootFps: number;
	maxDepth: number;
	runtimeManager: StudioRuntimeManager;
	nodeCounter: {
		value: number;
	};
};

type SceneFrameWindow = {
	start: number;
	end: number;
};

export type CompositionAudioGraph = {
	mixElements: TimelineElement[];
	mixTracks: TimelineTrack[];
	previewTargets: Map<string, AudioMixTarget>;
	exportAudioSourceMap: Map<string, ExportElementAudioSource>;
	enabledMap: Map<string, boolean>;
	sessionKeyMap: Map<string, string>;
	physicalClipRefs: PhysicalClipRef[];
};

const resolveFiniteNumber = (value: unknown, fallback = 0): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return value;
};

const resolveSafeFps = (value: unknown): number => {
	const rounded = Math.round(resolveFiniteNumber(value, DEFAULT_FPS));
	if (!Number.isFinite(rounded) || rounded <= 0) {
		return DEFAULT_FPS;
	}
	return rounded;
};

const framesToSeconds = (frames: number, fps: number): number => {
	return resolveFiniteNumber(frames, 0) / resolveSafeFps(fps);
};

const secondsToFrames = (seconds: number, fps: number): number => {
	return Math.round(resolveFiniteNumber(seconds, 0) * resolveSafeFps(fps));
};

const toFrame = (value: unknown): number => {
	return Math.round(resolveFiniteNumber(value, 0));
};

const toOptionalOffsetFrame = (value: unknown): number | undefined => {
	if (value === undefined || value === null) return undefined;
	return Math.max(0, Math.round(resolveFiniteNumber(value, 0)));
};

const shouldIncludeAudioLeaf = (element: TimelineElement): boolean => {
	return element.type === "AudioClip" || element.type === "VideoClip";
};

const withAccumulatedClipGain = (
	element: TimelineElement,
	accumulatedGainDb: number,
): TimelineElement => {
	const ownGainDb = resolveClipGainDb(element.clip);
	const nextGainDb = accumulatedGainDb + ownGainDb;
	const baseClip = element.clip ? { ...element.clip } : undefined;
	if (
		Math.abs(nextGainDb - CLIP_GAIN_DB_DEFAULT) <= 1e-6 &&
		baseClip?.gainDb === undefined
	) {
		return element;
	}
	if (baseClip) {
		if (Math.abs(nextGainDb - CLIP_GAIN_DB_DEFAULT) <= 1e-6) {
			const { gainDb: _removedGain, ...rest } = baseClip;
			return {
				...element,
				clip: Object.keys(rest).length > 0 ? rest : undefined,
			};
		}
		return {
			...element,
			clip: {
				...baseClip,
				gainDb: nextGainDb,
			},
		};
	}
	if (Math.abs(nextGainDb - CLIP_GAIN_DB_DEFAULT) <= 1e-6) {
		return element;
	}
	return {
		...element,
		clip: {
			gainDb: nextGainDb,
		},
	};
};

const intersectsFrameRange = (
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number,
): boolean => {
	return leftStart < rightEnd && rightStart < leftEnd;
};

const resolveTimelineFrameRange = (
	timeline: TimelineMeta,
): { start: number; end: number } => {
	const start = toFrame(timeline.start);
	const end = Math.max(start, toFrame(timeline.end));
	return {
		start,
		end,
	};
};

const resolveVisibleRangeInWindow = (
	range: { start: number; end: number },
	window: SceneFrameWindow | null,
): { start: number; end: number } | null => {
	if (!window) {
		return range.end > range.start ? range : null;
	}
	const start = Math.max(range.start, window.start);
	const end = Math.min(range.end, window.end);
	if (end <= start) {
		return null;
	}
	return {
		start,
		end,
	};
};

const createMappedTimeline = (
	timeline: TimelineMeta,
	options: {
		sceneFps: number;
		rootFps: number;
		sceneStartInRootFrame: number;
	},
): TimelineMeta => {
	const startSeconds = framesToSeconds(timeline.start ?? 0, options.sceneFps);
	const endSeconds = framesToSeconds(timeline.end ?? 0, options.sceneFps);
	const offsetSeconds = framesToSeconds(timeline.offset ?? 0, options.sceneFps);
	const rootOffset = secondsToFrames(offsetSeconds, options.rootFps);
	const start =
		options.sceneStartInRootFrame +
		secondsToFrames(startSeconds, options.rootFps);
	const end =
		options.sceneStartInRootFrame +
		secondsToFrames(endSeconds, options.rootFps);

	return {
		start,
		end,
		startTimecode: timeline.startTimecode,
		endTimecode: timeline.endTimecode,
		offset:
			timeline.offset === undefined
				? undefined
				: Math.max(0, Math.round(rootOffset)),
		trackIndex: 0,
		trackId: MIX_TRACK_ID,
		role: "clip",
	};
};

const createVirtualClipElement = (params: {
	element: TimelineElement;
	virtualId: string;
	timeline: TimelineMeta;
	accumulatedGainDb: number;
}): TimelineElement => {
	return {
		...withAccumulatedClipGain(params.element, params.accumulatedGainDb),
		id: params.virtualId,
		timeline: params.timeline,
		transition: undefined,
	};
};

const createProxyElement = (params: {
	id: string;
	timeline: TimelineMeta;
}): TimelineElement => {
	return {
		id: params.id,
		type: "Image",
		component: MIX_PROXY_COMPONENT,
		name: "CompositionAudioProxy",
		timeline: params.timeline,
		props: {},
	};
};

const resolveTransitionMetaInRoot = (params: {
	transition: TimelineElement;
	sceneFps: number;
	rootFps: number;
	sceneStartInRootFrame: number;
}): {
	start: number;
	end: number;
	boundary: number;
	duration: number;
} => {
	const transition = params.transition;
	const timelineStart = toFrame(transition.timeline.start);
	const timelineEnd = Math.max(timelineStart, toFrame(transition.timeline.end));
	const durationInScene =
		transition.transition && Number.isFinite(transition.transition.duration)
			? Math.max(0, Math.round(transition.transition.duration))
			: Math.max(0, timelineEnd - timelineStart);
	const boundaryInScene =
		transition.transition && Number.isFinite(transition.transition.boundry)
			? Math.round(transition.transition.boundry)
			: timelineStart + Math.floor(durationInScene / 2);
	const durationSeconds = framesToSeconds(durationInScene, params.sceneFps);
	const boundarySeconds = framesToSeconds(boundaryInScene, params.sceneFps);
	const duration = Math.max(
		0,
		secondsToFrames(durationSeconds, params.rootFps),
	);
	const boundary =
		params.sceneStartInRootFrame +
		secondsToFrames(boundarySeconds, params.rootFps);
	const head = Math.floor(duration / 2);
	const tail = duration - head;
	const canonicalStart = boundary - head;
	const canonicalEnd = boundary + tail;
	return {
		start: canonicalStart,
		end: canonicalEnd,
		boundary,
		duration,
	};
};

const resolveSideCandidates = (params: {
	clipIds: string[];
	side: "from" | "to";
	transitionStart: number;
	transitionEnd: number;
	boundary: number;
	clipTimelineByVirtualId: Map<string, TimelineMeta>;
}): string[] => {
	const { clipIds, side, transitionStart, transitionEnd, boundary } = params;
	if (clipIds.length === 0) return [];

	const windowStart = side === "from" ? transitionStart : boundary;
	const windowEnd = side === "from" ? boundary : transitionEnd;
	const filtered = clipIds.filter((id) => {
		const clipTimeline = params.clipTimelineByVirtualId.get(id);
		if (!clipTimeline) return false;
		return intersectsFrameRange(
			clipTimeline.start,
			clipTimeline.end,
			windowStart,
			windowEnd,
		);
	});
	if (filtered.length > 0) {
		return filtered;
	}

	let fallbackId: string | null = null;
	for (const id of clipIds) {
		const clipTimeline = params.clipTimelineByVirtualId.get(id);
		if (!clipTimeline) continue;
		if (!fallbackId) {
			fallbackId = id;
			continue;
		}
		const fallbackTimeline = params.clipTimelineByVirtualId.get(fallbackId);
		if (!fallbackTimeline) {
			fallbackId = id;
			continue;
		}
		if (side === "from") {
			if (clipTimeline.end > fallbackTimeline.end) {
				fallbackId = id;
			}
			continue;
		}
		if (clipTimeline.start < fallbackTimeline.start) {
			fallbackId = id;
		}
	}
	return fallbackId ? [fallbackId] : [];
};

const buildFlattenedAudioGraph = (params: {
	runtime: TimelineRuntime;
	sceneStartInRootFrame: number;
	sceneWindowInSceneFrame: SceneFrameWindow | null;
	inheritedEnabled: boolean;
	inheritedGainDb: number;
	instancePath: string[];
	compositionPath: string[];
	context: BuildFlattenContext;
}): LocalFlattenResult => {
	const { runtime, sceneStartInRootFrame, inheritedEnabled, instancePath } =
		params;
	const state = runtime.timelineStore.getState();
	const sceneElements = state.elements;
	const sceneFps = resolveSafeFps(state.fps);
	const sceneWindowInSceneFrame = params.sceneWindowInSceneFrame;

	const mixElements: TimelineElement[] = [];
	const clipNodes: VirtualClipNode[] = [];
	const descendantClipIdsByLocalElementId = new Map<string, string[]>();
	const clipTimelineByVirtualId = new Map<string, TimelineMeta>();

	for (const element of sceneElements) {
		if (element.type === "Transition") continue;
		const elementRangeInScene = resolveTimelineFrameRange(element.timeline);
		const visibleRangeInScene = resolveVisibleRangeInWindow(
			elementRangeInScene,
			sceneWindowInSceneFrame,
		);
		if (!visibleRangeInScene) {
			descendantClipIdsByLocalElementId.set(element.id, []);
			continue;
		}

		if (
			element.type === "Composition" ||
			element.type === "CompositionAudioClip"
		) {
			const childSceneId = resolveSceneReferenceSceneIdFromElement(element);
			if (!childSceneId) {
				console.warn(
					`[TimelineAudioMix] Scene reference "${element.id}" missing props.sceneId`,
				);
				descendantClipIdsByLocalElementId.set(element.id, []);
				continue;
			}
			if (params.compositionPath.includes(childSceneId)) {
				console.warn(
					`[TimelineAudioMix] Skip recursive scene reference "${element.id}" -> "${childSceneId}"`,
				);
				descendantClipIdsByLocalElementId.set(element.id, []);
				continue;
			}
			if (params.compositionPath.length >= params.context.maxDepth) {
				console.warn(
					`[TimelineAudioMix] Skip scene reference "${element.id}" because max depth (${params.context.maxDepth}) is reached`,
				);
				descendantClipIdsByLocalElementId.set(element.id, []);
				continue;
			}
			if (
				element.type === "Composition" &&
				isCompositionSourceAudioMuted(element)
			) {
				descendantClipIdsByLocalElementId.set(element.id, []);
				continue;
			}

			const childRuntime = params.context.runtimeManager.getTimelineRuntime(
				toSceneTimelineRef(childSceneId),
			);
			if (!childRuntime) {
				descendantClipIdsByLocalElementId.set(element.id, []);
				continue;
			}

			const compositionEnabled =
				inheritedEnabled &&
				isTimelineTrackAudible(
					element.timeline,
					state.tracks,
					state.audioTrackStates,
				);
			const compositionGainDb =
				params.inheritedGainDb + resolveClipGainDb(element.clip);
			const compositionOffsetInParent = Math.max(
				0,
				toFrame(element.timeline.offset),
			);
			const childSceneStartInRoot =
				sceneStartInRootFrame +
				secondsToFrames(
					framesToSeconds(
						elementRangeInScene.start - compositionOffsetInParent,
						sceneFps,
					),
					params.context.rootFps,
				);
			const visibleOffsetDeltaInParent =
				visibleRangeInScene.start - elementRangeInScene.start;
			const visibleSourceStartInParent =
				compositionOffsetInParent + visibleOffsetDeltaInParent;
			const visibleDurationInParent = Math.max(
				0,
				visibleRangeInScene.end - visibleRangeInScene.start,
			);
			const childState = childRuntime.timelineStore.getState();
			const childFps = resolveSafeFps(childState.fps);
			const childWindowStart = Math.max(
				0,
				secondsToFrames(
					framesToSeconds(visibleSourceStartInParent, sceneFps),
					childFps,
				),
			);
			const childWindowDuration = Math.max(
				0,
				secondsToFrames(
					framesToSeconds(visibleDurationInParent, sceneFps),
					childFps,
				),
			);
			const childWindowEnd = childWindowStart + childWindowDuration;
			if (childWindowEnd <= childWindowStart) {
				descendantClipIdsByLocalElementId.set(element.id, []);
				continue;
			}
			const childResult = buildFlattenedAudioGraph({
				runtime: childRuntime,
				sceneStartInRootFrame: childSceneStartInRoot,
				sceneWindowInSceneFrame: {
					start: childWindowStart,
					end: childWindowEnd,
				},
				inheritedEnabled: compositionEnabled,
				inheritedGainDb: compositionGainDb,
				instancePath: [
					...instancePath,
					`composition:${element.id}:scene:${childSceneId}`,
				],
				compositionPath: [...params.compositionPath, childSceneId],
				context: params.context,
			});
			mixElements.push(...childResult.mixElements);
			clipNodes.push(...childResult.clipNodes);
			for (const [id, timeline] of childResult.clipTimelineByVirtualId) {
				clipTimelineByVirtualId.set(id, timeline);
			}
			const childClipIds = childResult.clipNodes.map((item) => item.virtualId);
			descendantClipIdsByLocalElementId.set(element.id, childClipIds);
			continue;
		}

		if (!shouldIncludeAudioLeaf(element)) {
			descendantClipIdsByLocalElementId.set(element.id, []);
			continue;
		}

		const trimmedOffsetInScene =
			toFrame(element.timeline.offset) +
			(visibleRangeInScene.start - elementRangeInScene.start);
		const mappedTimeline = createMappedTimeline(
			{
				...element.timeline,
				start: visibleRangeInScene.start,
				end: visibleRangeInScene.end,
				offset: Math.max(0, trimmedOffsetInScene),
			},
			{
				sceneFps,
				rootFps: params.context.rootFps,
				sceneStartInRootFrame,
			},
		);
		const uniqueSuffix = params.context.nodeCounter.value;
		params.context.nodeCounter.value += 1;
		const virtualId = [
			"clip",
			...instancePath,
			element.id,
			String(uniqueSuffix),
		].join(":");
		const virtualElement = createVirtualClipElement({
			element,
			virtualId,
			timeline: mappedTimeline,
			accumulatedGainDb: params.inheritedGainDb,
		});
		mixElements.push(virtualElement);

		const enabled =
			inheritedEnabled &&
			isTimelineTrackAudible(
				element.timeline,
				state.tracks,
				state.audioTrackStates,
			) &&
			!(element.type === "VideoClip" && isVideoSourceAudioMuted(element));
		const store = runtime.modelRegistry.get(element.id);
		const internal = (store?.getState().internal ??
			null) as AudioModelInternal | null;
		const audioDuration = resolveFiniteNumber(internal?.audioDuration, 0);
		const applyAudioMix = internal?.applyAudioMix;
		const previewTarget =
			typeof applyAudioMix === "function"
				? {
						id: virtualId,
						timeline: mappedTimeline,
						audioDuration,
						enabled,
						applyAudioMix,
					}
				: null;
		const exportSource =
			internal?.audioSink && audioDuration > 0
				? {
						audioSink: internal.audioSink,
						audioDuration,
					}
				: null;

		const physical: PhysicalClipRef = {
			sceneId: runtime.ref.sceneId,
			elementId: element.id,
			runtimeId: runtime.id,
		};
		clipNodes.push({
			virtualId,
			physical,
			timeline: mappedTimeline,
			enabled,
			previewTarget,
			exportSource,
		});
		clipTimelineByVirtualId.set(virtualId, mappedTimeline);
		descendantClipIdsByLocalElementId.set(element.id, [virtualId]);
	}

	for (const transition of sceneElements) {
		if (transition.type !== "Transition") continue;
		const transitionRangeInScene = resolveTimelineFrameRange(
			transition.timeline,
		);
		if (
			!resolveVisibleRangeInWindow(
				transitionRangeInScene,
				sceneWindowInSceneFrame,
			)
		) {
			continue;
		}
		const fromId = transition.transition?.fromId;
		const toId = transition.transition?.toId;
		if (!fromId || !toId) continue;

		const transitionMeta = resolveTransitionMetaInRoot({
			transition,
			sceneFps,
			rootFps: params.context.rootFps,
			sceneStartInRootFrame,
		});
		const fromCandidates = resolveSideCandidates({
			clipIds: descendantClipIdsByLocalElementId.get(fromId) ?? [],
			side: "from",
			transitionStart: transitionMeta.start,
			transitionEnd: transitionMeta.end,
			boundary: transitionMeta.boundary,
			clipTimelineByVirtualId,
		});
		const toCandidates = resolveSideCandidates({
			clipIds: descendantClipIdsByLocalElementId.get(toId) ?? [],
			side: "to",
			transitionStart: transitionMeta.start,
			transitionEnd: transitionMeta.end,
			boundary: transitionMeta.boundary,
			clipTimelineByVirtualId,
		});
		if (fromCandidates.length === 0 && toCandidates.length === 0) {
			continue;
		}

		const baseTransitionTimeline: TimelineMeta = {
			start: transitionMeta.start,
			end: transitionMeta.end,
			startTimecode: transition.timeline.startTimecode,
			endTimecode: transition.timeline.endTimecode,
			offset: toOptionalOffsetFrame(transition.timeline.offset),
			trackIndex: 0,
			trackId: MIX_TRACK_ID,
			role: "clip",
		};
		const pushDirectTransition = (
			fromVirtualId: string,
			toVirtualId: string,
		) => {
			const transitionId = [
				"transition",
				...instancePath,
				transition.id,
				"both",
				fromVirtualId,
				toVirtualId,
				String(params.context.nodeCounter.value),
			].join(":");
			params.context.nodeCounter.value += 1;
			mixElements.push({
				...transition,
				id: transitionId,
				timeline: baseTransitionTimeline,
				transition: {
					duration: transitionMeta.duration,
					boundry: transitionMeta.boundary,
					fromId: fromVirtualId,
					toId: toVirtualId,
				},
			});
		};
		const pushOneSidedTransition = (options: {
			clipId: string;
			side: "from" | "to";
		}) => {
			const proxyId = [
				"proxy",
				...instancePath,
				transition.id,
				options.side,
				String(params.context.nodeCounter.value),
			].join(":");
			params.context.nodeCounter.value += 1;
			mixElements.push(
				createProxyElement({
					id: proxyId,
					timeline: baseTransitionTimeline,
				}),
			);
			const transitionId = [
				"transition",
				...instancePath,
				transition.id,
				options.side,
				options.clipId,
				String(params.context.nodeCounter.value),
			].join(":");
			params.context.nodeCounter.value += 1;
			const fromVirtualId = options.side === "from" ? options.clipId : proxyId;
			const toVirtualId = options.side === "from" ? proxyId : options.clipId;
			mixElements.push({
				...transition,
				id: transitionId,
				timeline: baseTransitionTimeline,
				transition: {
					duration: transitionMeta.duration,
					boundry: transitionMeta.boundary,
					fromId: fromVirtualId,
					toId: toVirtualId,
				},
			});
		};

		if (fromCandidates.length === 1 && toCandidates.length === 1) {
			pushDirectTransition(fromCandidates[0], toCandidates[0]);
			continue;
		}

		for (const candidateId of fromCandidates) {
			pushOneSidedTransition({
				clipId: candidateId,
				side: "from",
			});
		}
		for (const candidateId of toCandidates) {
			pushOneSidedTransition({
				clipId: candidateId,
				side: "to",
			});
		}
	}

	return {
		mixElements,
		clipNodes,
		descendantClipIdsByLocalElementId,
		clipTimelineByVirtualId,
	};
};

export const buildCompositionAudioGraph = (options: {
	rootRuntime: TimelineRuntime;
	runtimeManager: StudioRuntimeManager;
	maxDepth?: number;
}): CompositionAudioGraph => {
	const rootState = options.rootRuntime.timelineStore.getState();
	const rootFps = resolveSafeFps(rootState.fps);
	const context: BuildFlattenContext = {
		rootFps,
		maxDepth: Math.max(
			1,
			Math.round(
				resolveFiniteNumber(options.maxDepth, DEFAULT_MAX_COMPOSITION_DEPTH),
			),
		),
		runtimeManager: options.runtimeManager,
		nodeCounter: {
			value: 0,
		},
	};

	const flattened = buildFlattenedAudioGraph({
		runtime: options.rootRuntime,
		sceneStartInRootFrame: 0,
		sceneWindowInSceneFrame: null,
		inheritedEnabled: true,
		inheritedGainDb: 0,
		instancePath: [`scene:${options.rootRuntime.ref.sceneId}`],
		compositionPath: [options.rootRuntime.ref.sceneId],
		context,
	});

	const enabledMap = new Map<string, boolean>();
	const exportAudioSourceMap = new Map<string, ExportElementAudioSource>();
	const sessionKeyMap = new Map<string, string>();
	const previewTargets = new Map<string, AudioMixTarget>();
	const physicalClipRefs: PhysicalClipRef[] = [];
	const physicalRefDedup = new Set<string>();

	for (const clipNode of flattened.clipNodes) {
		enabledMap.set(clipNode.virtualId, clipNode.enabled);
		if (clipNode.exportSource) {
			exportAudioSourceMap.set(clipNode.virtualId, clipNode.exportSource);
		}
		const physicalRefKey = `${clipNode.physical.sceneId}:${clipNode.physical.elementId}`;
		if (!physicalRefDedup.has(physicalRefKey)) {
			physicalRefDedup.add(physicalRefKey);
			physicalClipRefs.push(clipNode.physical);
		}
	}

	for (const clipNode of flattened.clipNodes) {
		const sessionKey = getAudioPlaybackSessionKey(
			flattened.mixElements,
			clipNode.virtualId,
		);
		const runtimeKey = `composition:${clipNode.physical.runtimeId}:${sessionKey}`;
		sessionKeyMap.set(clipNode.virtualId, sessionKey);
		if (!clipNode.previewTarget) continue;
		previewTargets.set(clipNode.virtualId, {
			id: clipNode.previewTarget.id,
			timeline: clipNode.previewTarget.timeline,
			audioDuration: clipNode.previewTarget.audioDuration,
			enabled: clipNode.previewTarget.enabled,
			sessionKey,
			applyAudioMix: (instruction) => {
				const instructionWithRuntime: AudioPlaybackMixInstruction = instruction
					? {
							...instruction,
							runtimeKey,
						}
					: {
							timelineTimeSeconds: 0,
							gain: 0,
							activeWindow: { start: 0, end: 0 },
							runtimeKey,
						};
				return clipNode.previewTarget.applyAudioMix(instructionWithRuntime);
			},
		});
	}

	return {
		mixElements: flattened.mixElements,
		mixTracks: MIX_DEFAULT_TRACKS,
		previewTargets,
		exportAudioSourceMap,
		enabledMap,
		sessionKeyMap,
		physicalClipRefs,
	};
};
