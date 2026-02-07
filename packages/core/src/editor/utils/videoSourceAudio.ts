import type { TimelineElement } from "../../dsl/types";

const isLegacyVideoSourceAudioMuted = (
	clip: TimelineElement["clip"] | undefined,
): boolean => {
	if (!clip) return false;
	const legacy = clip as unknown as {
		kind?: unknown;
		audio?: { enabled?: unknown };
	};
	return legacy.kind === "video" && legacy.audio?.enabled === false;
};

export const isVideoSourceAudioMuted = (
	element: TimelineElement | undefined | null,
): boolean => {
	if (!element || element.type !== "VideoClip") return false;
	return (
		element.clip?.muteSourceAudio === true ||
		isLegacyVideoSourceAudioMuted(element.clip)
	);
};
