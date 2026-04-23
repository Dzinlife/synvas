import type { TimelineElement } from "core/timeline-system/types";
import { isVideoSourceAudioMuted as isVideoSourceAudioMutedCore } from "core/timeline-system/utils/videoSourceAudio";
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

const getVideoSourceId = (element: TimelineElement): string | null => {
	if (element.type !== "VideoClip") return null;
	const assetId = element.assetId;
	if (typeof assetId !== "string" || assetId.length === 0) return null;
	return assetId;
};

const buildAudioTimelineMeta = (
	video: TimelineElement,
	trackIndex: number,
	fps: number,
) => {
	const start = clampFrame(video.timeline.start);
	const end = clampFrame(video.timeline.end);
	const offset = video.timeline.offset;
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
		if (element.type !== "AudioClip") {
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
	video: TimelineElement,
	elements: TimelineElement[],
	trackLockedMap?: Map<number, boolean>,
): number => {
	let targetTrack = -1;
	let candidateTrack = -1;
	let guard = 0;

	while (guard < 256) {
		candidateTrack = findAvailableAudioTrack(
			video.timeline.start,
			video.timeline.end,
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

export const isVideoSourceAudioMuted = (
	element: TimelineElement | undefined | null,
): boolean => {
	return isVideoSourceAudioMutedCore(element);
};

export const setVideoSourceAudioMuted = (
	element: TimelineElement,
	muted: boolean,
): TimelineElement => {
	if (element.type !== "VideoClip") return element;
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

export interface DetachVideoClipAudioOptions {
	elements: TimelineElement[];
	videoId: string;
	fps: number;
	trackLockedMap?: Map<number, boolean>;
	hasSourceAudioTrack?: boolean;
}

export const detachVideoClipAudio = ({
	elements,
	videoId,
	fps,
	trackLockedMap,
	hasSourceAudioTrack,
}: DetachVideoClipAudioOptions): TimelineElement[] => {
	const videoIndex = elements.findIndex((element) => element.id === videoId);
	if (videoIndex < 0) return elements;
	const videoElement = elements[videoIndex];
	if (videoElement.type !== "VideoClip") return elements;
	const assetId = getVideoSourceId(videoElement);
	if (!assetId) return elements;
	if (hasSourceAudioTrack === false) return elements;
	const sourceReversed = Boolean(
		(videoElement.props as { reversed?: unknown } | undefined)?.reversed,
	);

	const mutedVideo = setVideoSourceAudioMuted(videoElement, true);
	const nextElements = [...elements];
	nextElements[videoIndex] = mutedVideo;

	const audioElementId = createElementId();
	const audioTrackIndex = resolveAudioTrack(
		videoElement,
		nextElements,
		trackLockedMap,
	);

	const audioElement: TimelineElement = {
		id: audioElementId,
		type: "AudioClip",
		component: "audio-clip",
		name: videoElement.name ? `${videoElement.name} 音频` : "分离音频",
		assetId,
		props: {
			...(sourceReversed ? { reversed: true } : {}),
		},
		...(videoElement.transform
			? {
					transform: {
						...videoElement.transform,
					},
				}
			: {}),
		timeline: buildAudioTimelineMeta(videoElement, audioTrackIndex, fps),
		render: {
			zIndex: 0,
			visible: true,
			opacity: 1,
		},
		clip: {
			sourceVideoClipId: videoElement.id,
		},
	};

	return [...nextElements, audioElement];
};

export interface RestoreVideoClipAudioOptions {
	elements: TimelineElement[];
	videoId: string;
}

export const restoreVideoClipAudio = ({
	elements,
	videoId,
}: RestoreVideoClipAudioOptions): TimelineElement[] => {
	const target = elements.find((element) => element.id === videoId);
	if (!target || target.type !== "VideoClip") return elements;
	const restored = setVideoSourceAudioMuted(target, false);
	if (restored === target) return elements;
	return elements.map((element) =>
		element.id === videoId ? restored : element,
	);
};
