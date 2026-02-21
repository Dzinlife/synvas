import type { TimelineAsset, TimelineElement } from "../dsl/types";
import { describe, expect, it } from "vitest";
import { loadTimelineFromObject, saveTimelineToObject } from "./timelineLoader";

const createBaseTimeline = () => ({
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
	assets: [
		{
			id: "asset-video-1",
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
			assetId: "asset-video-1",
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

describe("timelineLoader asset schema", () => {
	it("支持 assets + assetId 结构", () => {
		const loaded = loadTimelineFromObject(createBaseTimeline());
		expect(loaded.assets).toHaveLength(1);
		expect(loaded.assets[0]?.id).toBe("asset-video-1");
		expect(loaded.elements[0]?.assetId).toBe("asset-video-1");
	});

	it("媒体元素缺少 assetId 会校验失败", () => {
		const invalid = createBaseTimeline();
		delete (invalid.elements[0] as { assetId?: string }).assetId;
		expect(() => loadTimelineFromObject(invalid)).toThrow(
			"elements[0].assetId: required",
		);
	});

	it("assetId 指向不存在的 asset 会校验失败", () => {
		const invalid = createBaseTimeline();
		(invalid.elements[0] as { assetId?: string }).assetId = "missing-asset";
		expect(() => loadTimelineFromObject(invalid)).toThrow(
			'asset "missing-asset" not found',
		);
	});

	it("媒体元素携带 props.uri 会校验失败", () => {
		const invalid = createBaseTimeline();
		(invalid.elements[0] as { props: Record<string, unknown> }).props = {
			uri: "file:///legacy.mp4",
		};
		expect(() => loadTimelineFromObject(invalid)).toThrow(
			"elements[0].props.uri: must use assetId instead",
		);
	});

	it("saveTimelineToObject 会保留 assetId 并移除媒体 props.uri", () => {
		const asset: TimelineAsset = {
			id: "asset-video-1",
			kind: "video",
			uri: "file:///clip.mp4",
		};
		const element: TimelineElement = {
			id: "clip-1",
			type: "VideoClip",
			component: "video-clip",
			name: "clip-1",
			assetId: "asset-video-1",
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
			[asset],
		);
		expect(saved.assets?.[0]?.id).toBe("asset-video-1");
		expect(saved.elements[0]?.assetId).toBe("asset-video-1");
		expect((saved.elements[0]?.props as { uri?: string }).uri).toBeUndefined();
	});

	it("支持在 asset.meta.asr 中保存转写数据", () => {
		const timeline = createBaseTimeline();
		(timeline.assets[0] as TimelineAsset).meta = {
			asr: {
				id: "transcript-1",
				source: {
					type: "asset",
					assetId: "asset-video-1",
					kind: "video",
					uri: "file:///clip.mp4",
					fileName: "clip.mp4",
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
		expect(loaded.assets[0]?.meta?.asr?.id).toBe("transcript-1");
	});

	it("不兼容旧版 opfs-audio 转写结构", () => {
		const timeline = createBaseTimeline();
		(timeline.assets[0] as TimelineAsset).meta = {
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
				segments: [],
			},
		} as unknown as TimelineAsset["meta"];
		expect(() => loadTimelineFromObject(timeline)).toThrow(
			"assets[0].meta.asr.source.type",
		);
	});
});
