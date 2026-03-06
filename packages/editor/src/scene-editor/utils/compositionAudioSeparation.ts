import {
	CLIP_GAIN_DB_DEFAULT,
	resolveClipGainDb,
} from "core/editor/audio/clipGain";
import type { ClipMeta, TimelineElement } from "core/element/types";
import { clampFrame, framesToTimecode } from "../../utils/timecode";

const MAIN_TRACK_INDEX = 0;

const createElementId = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `clip-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 6)}`;
};

const getTrackIndex = (element: TimelineElement): number => {
	return element.timeline.trackIndex ?? MAIN_TRACK_INDEX;
};

const isTimeOverlapping = (
	start1: number,
	end1: number,
	start2: number,
	end2: number,
): boolean => {
	return start1 < end2 && end1 > start2;
};

const hasRoleConflictOnAudioTrack = (
	trackIndex: number,
	elements: TimelineElement[],
): boolean => {
	for (const element of elements) {
		if (element.type === "Transition") continue;
		if (getTrackIndex(element) !== trackIndex) continue;
		if (element.type !== "AudioClip" && element.type !== "CompositionAudioClip") {
			return true;
		}
	}
	return false;
};

const hasOverlapOnTrack = (
	start: number,
	end: number,
	trackIndex: number,
	elements: TimelineElement[],
): boolean => {
	for (const element of elements) {
		if (element.type === "Transition") continue;
		if (getTrackIndex(element) !== trackIndex) continue;
		if (
			isTimeOverlapping(
				start,
				end,
				element.timeline.start,
				element.timeline.end,
			)
		) {
			return true;
		}
	}
	return false;
};

const findAvailableAudioTrack = (
	start: number,
	end: number,
	targetTrack: number,
	elements: TimelineElement[],
): number => {
	let minTrack = targetTrack;
	for (const element of elements) {
		minTrack = Math.min(minTrack, getTrackIndex(element));
	}

	for (let track = targetTrack; track >= minTrack; track -= 1) {
		if (hasRoleConflictOnAudioTrack(track, elements)) continue;
		if (!hasOverlapOnTrack(start, end, track, elements)) {
			return track;
		}
	}

	return minTrack - 1;
};

const resolveAudioTrack = (
	composition: TimelineElement,
	elements: TimelineElement[],
	trackLockedMap?: Map<number, boolean>,
): number => {
	let targetTrack = -1;
	let candidateTrack = -1;
	let guard = 0;

	while (guard < 256) {
		candidateTrack = findAvailableAudioTrack(
			composition.timeline.start,
			composition.timeline.end,
			targetTrack,
			elements,
		);
		if (!trackLockedMap?.get(candidateTrack)) {
			return candidateTrack;
		}
		targetTrack = Math.min(targetTrack - 1, candidateTrack - 1);
		guard += 1;
	}

	return candidateTrack;
};

const buildAudioTimelineMeta = (
	composition: TimelineElement,
	trackIndex: number,
	fps: number,
) => {
	const start = clampFrame(composition.timeline.start);
	const end = clampFrame(composition.timeline.end);
	const offset = composition.timeline.offset;
	return {
		start,
		end,
		startTimecode: framesToTimecode(start, fps),
		endTimecode: framesToTimecode(end, fps),
		...(offset !== undefined ? { offset: clampFrame(offset) } : {}),
		trackIndex,
		role: "audio" as const,
	};
};

const moveGainFromSourceClip = (
	clip: ClipMeta | undefined,
): {
	sourceClip: ClipMeta | undefined;
	proxyClip: ClipMeta | undefined;
} => {
	const gainDb = resolveClipGainDb(clip);
	const { gainDb: _removedGain, ...rest } = clip ?? {};
	const baseMeta = Object.keys(rest).length > 0 ? rest : undefined;
	const proxyClip =
		gainDb === CLIP_GAIN_DB_DEFAULT
			? undefined
			: {
					gainDb,
				};
	return {
		sourceClip: baseMeta,
		proxyClip,
	};
};

export const isCompositionSourceAudioMuted = (
	element: TimelineElement | undefined | null,
): boolean => {
	if (!element || element.type !== "Composition") return false;
	return element.clip?.muteSourceAudio === true;
};

export const setCompositionSourceAudioMuted = (
	element: TimelineElement,
	muted: boolean,
): TimelineElement => {
	if (element.type !== "Composition") return element;
	if (muted) {
		if (element.clip?.muteSourceAudio === true) {
			return element;
		}
		return {
			...element,
			clip: {
				...(element.clip ?? {}),
				muteSourceAudio: true,
			},
		};
	}
	if (!element.clip?.muteSourceAudio) return element;
	const { muteSourceAudio: _removed, ...rest } = element.clip;
	return {
		...element,
		clip: Object.keys(rest).length > 0 ? rest : undefined,
	};
};

export interface DetachCompositionAudioOptions {
	elements: TimelineElement[];
	compositionId: string;
	fps: number;
	trackLockedMap?: Map<number, boolean>;
	hasSourceAudioTrack?: boolean;
}

export const detachCompositionAudio = ({
	elements,
	compositionId,
	fps,
	trackLockedMap,
	hasSourceAudioTrack,
}: DetachCompositionAudioOptions): TimelineElement[] => {
	const compositionIndex = elements.findIndex(
		(element) => element.id === compositionId,
	);
	if (compositionIndex < 0) return elements;
	const compositionElement = elements[compositionIndex];
	if (compositionElement.type !== "Composition") return elements;
	const sceneId = compositionElement.props.sceneId;
	if (typeof sceneId !== "string" || sceneId.length === 0) return elements;
	if (hasSourceAudioTrack === false) return elements;

	const { sourceClip, proxyClip } = moveGainFromSourceClip(
		compositionElement.clip,
	);
	const mutedComposition = setCompositionSourceAudioMuted(
		{
			...compositionElement,
			clip: sourceClip,
		},
		true,
	);
	const nextElements = [...elements];
	nextElements[compositionIndex] = mutedComposition;

	const proxyId = createElementId();
	const audioTrackIndex = resolveAudioTrack(
		compositionElement,
		nextElements,
		trackLockedMap,
	);

	const proxyElement: TimelineElement = {
		id: proxyId,
		type: "CompositionAudioClip",
		component: "composition-audio-clip",
		name: compositionElement.name
			? `${compositionElement.name} 音频`
			: "Composition 音频",
		props: {
			sceneId,
		},
		...(compositionElement.transform
			? {
					transform: {
						...compositionElement.transform,
					},
				}
			: {}),
		timeline: buildAudioTimelineMeta(compositionElement, audioTrackIndex, fps),
		render: {
			zIndex: 0,
			visible: true,
			opacity: 1,
		},
		clip: {
			...(proxyClip ?? {}),
			sourceCompositionId: compositionElement.id,
		},
	};

	return [...nextElements, proxyElement];
};

export interface RestoreCompositionAudioOptions {
	elements: TimelineElement[];
	compositionId: string;
}

export const restoreCompositionAudio = ({
	elements,
	compositionId,
}: RestoreCompositionAudioOptions): TimelineElement[] => {
	const target = elements.find((element) => element.id === compositionId);
	if (!target || target.type !== "Composition") return elements;
	const restored = setCompositionSourceAudioMuted(target, false);
	if (restored === target) return elements;
	return elements.map((element) =>
		element.id === compositionId ? restored : element,
	);
};
