import type { TimelineElement } from "core/dsl/types";
import { describe, expect, it } from "vitest";
import { createTransformMeta } from "@/dsl/transform";
import {
	detachVideoClipAudio,
	isVideoSourceAudioMuted,
	restoreVideoClipAudio,
} from "./videoClipAudioSeparation";

const createVideoElement = (
	id: string,
	options?: { reversed?: boolean },
): TimelineElement => {
	return {
		id,
		type: "VideoClip",
		component: "video-clip",
		name: "video",
		sourceId: "source-video-1",
		props: {
			reversed: Boolean(options?.reversed),
		},
		transform: createTransformMeta({
			width: 1920,
			height: 1080,
			positionX: 960,
			positionY: 540,
		}),
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
		expect(detached?.sourceId).toBe("source-video-1");
		expect(detached?.timeline.start).toBe(10);
		expect(detached?.timeline.end).toBe(100);
		expect(detached?.timeline.offset).toBe(7);
	});

	it("倒放视频分离时会继承 AudioClip 倒放属性", () => {
		const video = createVideoElement("video-1", { reversed: true });
		const next = detachVideoClipAudio({
			elements: [video],
			videoId: video.id,
			fps: 30,
		});
		const detached = next.find((element) => element.type === "AudioClip");
		expect((detached?.props as { reversed?: boolean } | undefined)?.reversed).toBe(
			true,
		);
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

	it("无源音轨时不会执行分离", () => {
		const video = createVideoElement("video-1");
		const elements = [video];
		const next = detachVideoClipAudio({
			elements,
			videoId: video.id,
			fps: 30,
			hasSourceAudioTrack: false,
		});
		expect(next).toBe(elements);
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
});
