import type { TimelineElement } from "core/dsl/types";
import { describe, expect, it } from "vitest";
import {
	getAudioPlaybackSessionKey,
	getVideoPlaybackSessionKey,
} from "./clipContinuityIndex";

const createTimeline = (
	start: number,
	end: number,
	offset = 0,
	trackIndex = 0,
) => ({
	start,
	end,
	startTimecode: "",
	endTimecode: "",
	offset,
	trackIndex,
});

const createVideoClip = ({
	id,
	start,
	end,
	offset = 0,
	uri = "a.mp4",
	reversed = false,
	trackIndex = 0,
}: {
	id: string;
	start: number;
	end: number;
	offset?: number;
	uri?: string;
	reversed?: boolean;
	trackIndex?: number;
}): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: createTimeline(start, end, offset, trackIndex),
	props: { uri, reversed },
});

const createAudioClip = ({
	id,
	start,
	end,
	offset = 0,
	uri = "a.mp3",
	trackIndex = -1,
}: {
	id: string;
	start: number;
	end: number;
	offset?: number;
	uri?: string;
	trackIndex?: number;
}): TimelineElement => ({
	id,
	type: "AudioClip",
	component: "audio-clip",
	name: id,
	timeline: createTimeline(start, end, offset, trackIndex),
	props: { uri },
});

const createTransition = ({
	id,
	start,
	end,
	boundary,
	fromId,
	toId,
}: {
	id: string;
	start: number;
	end: number;
	boundary: number;
	fromId: string;
	toId: string;
}): TimelineElement => ({
	id,
	type: "Transition",
	component: "transition/crossfade",
	name: id,
	timeline: createTimeline(start, end, 0, 0),
	props: {},
	transition: {
		duration: end - start,
		boundry: boundary,
		fromId,
		toId,
	},
});

describe("clipContinuityIndex", () => {
	it("同源前向硬切会归并到同一视频 session", () => {
		const elements = [
			createVideoClip({ id: "v1", start: 0, end: 30, offset: 10 }),
			createVideoClip({ id: "v2", start: 30, end: 60, offset: 40 }),
		];
		const key1 = getVideoPlaybackSessionKey(elements, "v1");
		const key2 = getVideoPlaybackSessionKey(elements, "v2");
		expect(key1).toBe(key2);
	});

	it("边界被转场接管时不归并", () => {
		const elements = [
			createVideoClip({ id: "v1", start: 0, end: 30, offset: 10 }),
			createVideoClip({ id: "v2", start: 30, end: 60, offset: 40 }),
			createTransition({
				id: "t1",
				start: 15,
				end: 45,
				boundary: 30,
				fromId: "v1",
				toId: "v2",
			}),
		];
		const key1 = getVideoPlaybackSessionKey(elements, "v1");
		const key2 = getVideoPlaybackSessionKey(elements, "v2");
		expect(key1).not.toBe(key2);
	});

	it("源时间不连续时不归并", () => {
		const elements = [
			createVideoClip({ id: "v1", start: 0, end: 30, offset: 10 }),
			createVideoClip({ id: "v2", start: 30, end: 60, offset: 41 }),
		];
		const key1 = getVideoPlaybackSessionKey(elements, "v1");
		const key2 = getVideoPlaybackSessionKey(elements, "v2");
		expect(key1).not.toBe(key2);
	});

	it("同源反向硬切在新 offset 语义下可归并", () => {
		const elements = [
			createVideoClip({
				id: "left",
				start: 0,
				end: 30,
				offset: 60,
				reversed: true,
			}),
			createVideoClip({
				id: "right",
				start: 30,
				end: 90,
				offset: 0,
				reversed: true,
			}),
		];
		const leftKey = getVideoPlaybackSessionKey(elements, "left");
		const rightKey = getVideoPlaybackSessionKey(elements, "right");
		expect(leftKey).toBe(rightKey);
	});

	it("AudioClip 同源硬切会归并到同一 session", () => {
		const elements = [
			createAudioClip({ id: "a1", start: 0, end: 30, offset: 100 }),
			createAudioClip({ id: "a2", start: 30, end: 60, offset: 130 }),
		];
		const key1 = getAudioPlaybackSessionKey(elements, "a1");
		const key2 = getAudioPlaybackSessionKey(elements, "a2");
		expect(key1).toBe(key2);
	});

	it("不存在归并信息时回退 clip key", () => {
		const elements = [
			createVideoClip({
				id: "v1",
				start: 0,
				end: 30,
				offset: 10,
				uri: "",
			}),
		];
		expect(getVideoPlaybackSessionKey(elements, "v1")).toBe("clip:v1");
	});
});
