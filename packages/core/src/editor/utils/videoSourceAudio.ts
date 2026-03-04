import type { TimelineElement } from "../../element/types";

export const isVideoSourceAudioMuted = (
	element: TimelineElement | undefined | null,
): boolean => {
	if (!element || element.type !== "VideoClip") return false;
	return element.clip?.muteSourceAudio === true;
};
