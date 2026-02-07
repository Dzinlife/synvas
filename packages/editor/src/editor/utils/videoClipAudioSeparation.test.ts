import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../../dsl/types";
import {
	detachVideoClipAudio,
	isVideoSourceAudioMuted,
	restoreVideoClipAudio,
} from "./videoClipAudioSeparation";

const createVideoElement = (id: string): TimelineElement => {
	return {
		id,
		type: "VideoClip",
		component: "video-clip",
		name: "video",
		props: {
			uri: "file:///video.mp4",
		},
		transform: {
			centerX: 0,
			centerY: 0,
			width: 1920,
			height: 1080,
			rotation: 0,
		},
		timeline: {
			start: 10,
			end: 100,
			startTimecode: "00:00:00:10",
			endTimecode: "00:00:03:10",
			offset: 7,
			trackIndex: 0,
			role: "clip",
		},
		render: {
			zIndex: 0,
			visible: true,
			opacity: 1,
		},
	};
};

describe("videoClipAudioSeparation", () => {
	it("分离会创建 AudioClip 并写入 sourceVideoClipId", () => {
		const video = createVideoElement("video-1");
		const next = detachVideoClipAudio({
			elements: [video],
			videoId: video.id,
			fps: 30,
		});
		expect(next).toHaveLength(2);
		const detached = next.find((element) => element.type === "AudioClip");
		expect(detached).toBeTruthy();
		expect(detached?.clip?.sourceVideoClipId).toBe("video-1");
		expect((detached?.props as { uri?: string } | undefined)?.uri).toBe(
			"file:///video.mp4",
		);
		expect(detached?.timeline.start).toBe(10);
		expect(detached?.timeline.end).toBe(100);
		expect(detached?.timeline.offset).toBe(7);
	});

	it("分离会把 VideoClip 标记为 muteSourceAudio", () => {
		const video = createVideoElement("video-1");
		const next = detachVideoClipAudio({
			elements: [video],
			videoId: video.id,
			fps: 30,
		});
		const updatedVideo = next.find((element) => element.id === video.id);
		expect(isVideoSourceAudioMuted(updatedVideo)).toBe(true);
		expect(updatedVideo?.clip).toEqual({ muteSourceAudio: true });
	});

	it("重复分离会每次新增一条 AudioClip", () => {
		const video = createVideoElement("video-1");
		const first = detachVideoClipAudio({
			elements: [video],
			videoId: video.id,
			fps: 30,
		});
		const second = detachVideoClipAudio({
			elements: first,
			videoId: video.id,
			fps: 30,
		});
		const detachedCount = second.filter(
			(element) => element.type === "AudioClip",
		);
		expect(detachedCount).toHaveLength(2);
	});

	it("还原仅恢复 VideoClip，不移除分离音轨", () => {
		const video = createVideoElement("video-1");
		const detached = detachVideoClipAudio({
			elements: [video],
			videoId: video.id,
			fps: 30,
		});
		const restored = restoreVideoClipAudio({
			elements: detached,
			videoId: video.id,
		});
		const restoredVideo = restored.find((element) => element.id === video.id);
		expect(isVideoSourceAudioMuted(restoredVideo)).toBe(false);
		expect(restoredVideo?.clip).toBeUndefined();
		expect(
			restored.filter((element) => element.type === "AudioClip"),
		).toHaveLength(1);
	});

	it("还原后允许同源音轨并存（可叠加播放）", () => {
		const video = createVideoElement("video-1");
		const detached = detachVideoClipAudio({
			elements: [video],
			videoId: video.id,
			fps: 30,
		});
		const restored = restoreVideoClipAudio({
			elements: detached,
			videoId: video.id,
		});
		const detachedAudio = restored.find(
			(element) => element.type === "AudioClip",
		);
		expect(detachedAudio?.clip?.sourceVideoClipId).toBe("video-1");
		expect(restored.some((element) => element.id === "video-1")).toBe(true);
	});

	it("兼容旧版 kind/audio.enabled=false 的静音判定", () => {
		const legacyVideo: TimelineElement = {
			...createVideoElement("video-legacy"),
			clip: {
				kind: "video",
				audio: { enabled: false },
			} as unknown as TimelineElement["clip"],
		};
		expect(isVideoSourceAudioMuted(legacyVideo)).toBe(true);
	});
});
