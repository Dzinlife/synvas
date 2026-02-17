import type { TimelineElement, TimelineSource } from "../dsl/types";
import { describe, expect, it } from "vitest";
import { loadTimelineFromObject, saveTimelineToObject } from "./timelineLoader";

const createBaseTimeline = () => ({
	version: "1.0" as const,
	fps: 30,
	canvas: {
		width: 1920,
		height: 1080,
	},
	settings: {
		snapEnabled: true,
		autoAttach: true,
		rippleEditingEnabled: true,
		previewAxisEnabled: true,
	},
	sources: [
		{
			id: "source-video-1",
			kind: "video" as const,
			uri: "file:///clip.mp4",
		},
	],
	elements: [
		{
			id: "clip-1",
			type: "VideoClip" as const,
			component: "video-clip",
			name: "clip-1",
			sourceId: "source-video-1",
			timeline: {
				start: 0,
				end: 30,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:01:00",
				trackIndex: 0,
			},
			props: {
				reversed: false,
			},
		},
	],
});

describe("timelineLoader source schema", () => {
	it("支持 version=1.0 的 sources + sourceId 结构", () => {
		const loaded = loadTimelineFromObject(createBaseTimeline());
		expect(loaded.sources).toHaveLength(1);
		expect(loaded.sources[0]?.id).toBe("source-video-1");
		expect(loaded.elements[0]?.sourceId).toBe("source-video-1");
	});

	it("媒体元素缺少 sourceId 会校验失败", () => {
		const invalid = createBaseTimeline();
		delete (invalid.elements[0] as { sourceId?: string }).sourceId;
		expect(() => loadTimelineFromObject(invalid)).toThrow(
			"elements[0].sourceId: required",
		);
	});

	it("sourceId 指向不存在的 source 会校验失败", () => {
		const invalid = createBaseTimeline();
		(invalid.elements[0] as { sourceId?: string }).sourceId = "missing-source";
		expect(() => loadTimelineFromObject(invalid)).toThrow(
			'source "missing-source" not found',
		);
	});

	it("媒体元素携带 props.uri 会校验失败", () => {
		const invalid = createBaseTimeline();
		(invalid.elements[0] as { props: Record<string, unknown> }).props = {
			uri: "file:///legacy.mp4",
		};
		expect(() => loadTimelineFromObject(invalid)).toThrow(
			"elements[0].props.uri: must use sourceId instead",
		);
	});

	it("saveTimelineToObject 会保留 sourceId 并移除媒体 props.uri", () => {
		const source: TimelineSource = {
			id: "source-video-1",
			kind: "video",
			uri: "file:///clip.mp4",
		};
		const element: TimelineElement = {
			id: "clip-1",
			type: "VideoClip",
			component: "video-clip",
			name: "clip-1",
			sourceId: "source-video-1",
			timeline: {
				start: 0,
				end: 30,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:01:00",
				trackIndex: 0,
			},
			props: {
				uri: "file:///legacy.mp4",
				reversed: false,
			},
		};
		const saved = saveTimelineToObject(
			[element],
			30,
			{ width: 1920, height: 1080 },
			[],
			undefined,
			[source],
		);
		expect(saved.version).toBe("1.0");
		expect(saved.sources?.[0]?.id).toBe("source-video-1");
		expect(saved.elements[0]?.sourceId).toBe("source-video-1");
		expect((saved.elements[0]?.props as { uri?: string }).uri).toBeUndefined();
	});

	it("支持在 source.data.asr 中保存转写数据", () => {
		const timeline = createBaseTimeline();
		(timeline.sources[0] as TimelineSource).data = {
			asr: {
				id: "transcript-1",
				source: {
					type: "opfs-audio",
					uri: "opfs://projects/project-1/audios/voice.wav",
					fileName: "voice.wav",
					duration: 2.5,
				},
				language: "zh",
				model: "tiny",
				createdAt: 1,
				updatedAt: 2,
				segments: [
					{
						id: "seg-1",
						start: 0,
						end: 1,
						text: "你好",
						words: [
							{
								id: "word-1",
								text: "你好",
								start: 0,
								end: 1,
							},
						],
					},
				],
			},
		};
		const loaded = loadTimelineFromObject(timeline);
		expect(loaded.sources[0]?.data?.asr?.id).toBe("transcript-1");
	});
});
