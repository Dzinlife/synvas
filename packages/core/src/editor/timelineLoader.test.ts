import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../element/types";
import { loadTimelineFromObject, saveTimelineToObject } from "./timelineLoader";

type TimelineFixture = {
	fps: number;
	canvas: {
		width: number;
		height: number;
	};
	settings: {
		snapEnabled: boolean;
		autoAttach: boolean;
		rippleEditingEnabled: boolean;
		previewAxisEnabled: boolean;
	};
	elements: Array<Record<string, unknown>>;
};

const createBaseTimeline = (): TimelineFixture => ({
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

describe("timelineLoader asset reference", () => {
	it("支持 assetId + 外部 assetIdSet 校验", () => {
		const loaded = loadTimelineFromObject(
			createBaseTimeline(),
			new Set(["asset-video-1"]),
		);
		expect(loaded.elements[0]?.assetId).toBe("asset-video-1");
	});

	it("媒体元素缺少 assetId 会校验失败", () => {
		const invalid = createBaseTimeline();
		delete (invalid.elements[0] as { assetId?: string }).assetId;
		expect(() => loadTimelineFromObject(invalid)).toThrow(
			"elements[0].assetId: required",
		);
	});

	it("assetId 指向不存在 asset 时在 strict 模式下失败", () => {
		const invalid = createBaseTimeline();
		(invalid.elements[0] as { assetId?: string }).assetId = "missing-asset";
		expect(() =>
			loadTimelineFromObject(invalid, new Set(["asset-video-1"])),
		).toThrow('asset "missing-asset" not found');
	});

	it("assetId 在非 strict 模式允许保留外部引用", () => {
		const timeline = createBaseTimeline();
		(timeline.elements[0] as { assetId?: string }).assetId = "external-asset";
		expect(() => loadTimelineFromObject(timeline)).not.toThrow();
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

	it("saveTimelineToObject 会移除媒体 props.uri 并保留 assetId", () => {
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
		);
		expect(saved.elements[0]?.assetId).toBe("asset-video-1");
		expect((saved.elements[0]?.props as { uri?: string }).uri).toBeUndefined();
		expect(Object.hasOwn(saved, "assets")).toBe(false);
	});

	it("Composition 缺少 props.sceneId 会校验失败", () => {
		const timeline = createBaseTimeline();
		timeline.elements = [
			{
				id: "composition-1",
				type: "Composition",
				component: "composition",
				name: "composition-1",
				timeline: {
					start: 0,
					end: 30,
					startTimecode: "00:00:00:00",
					endTimecode: "00:00:01:00",
					trackIndex: 0,
				},
				props: {},
			},
		];

		expect(() => loadTimelineFromObject(timeline)).toThrow(
			"elements[0].props.sceneId",
		);
	});

	it("Composition 携带合法 props.sceneId 时可正常加载", () => {
		const timeline = createBaseTimeline();
		timeline.elements = [
			{
				id: "composition-1",
				type: "Composition",
				component: "composition",
				name: "composition-1",
				timeline: {
					start: 0,
					end: 30,
					startTimecode: "00:00:00:00",
					endTimecode: "00:00:01:00",
					trackIndex: 0,
				},
				props: {
					sceneId: "scene-2",
				},
			},
		];

		const loaded = loadTimelineFromObject(timeline);
		expect((loaded.elements[0]?.props as { sceneId?: string }).sceneId).toBe(
			"scene-2",
		);
	});

	it("CompositionAudioClip 缺少 props.sceneId 会校验失败", () => {
		const timeline = createBaseTimeline();
		timeline.elements = [
			{
				id: "composition-audio-1",
				type: "CompositionAudioClip",
				component: "composition-audio-clip",
				name: "composition-audio-1",
				timeline: {
					start: 0,
					end: 30,
					startTimecode: "00:00:00:00",
					endTimecode: "00:00:01:00",
					trackIndex: -1,
					role: "audio",
				},
				props: {},
			},
		];

		expect(() => loadTimelineFromObject(timeline)).toThrow(
			"elements[0].props.sceneId",
		);
	});

	it("CompositionAudioClip 使用合法 sceneId 和负轨道时可正常加载", () => {
		const timeline = createBaseTimeline();
		timeline.elements = [
			{
				id: "composition-audio-1",
				type: "CompositionAudioClip",
				component: "composition-audio-clip",
				name: "composition-audio-1",
				timeline: {
					start: 0,
					end: 30,
					startTimecode: "00:00:00:00",
					endTimecode: "00:00:01:00",
					trackIndex: -1,
					role: "audio",
				},
				props: {
					sceneId: "scene-2",
				},
				clip: {
					sourceCompositionId: "composition-1",
				},
			},
		];

		const loaded = loadTimelineFromObject(timeline);
		expect(loaded.elements[0]?.type).toBe("CompositionAudioClip");
		expect((loaded.elements[0]?.props as { sceneId?: string }).sceneId).toBe(
			"scene-2",
		);
		expect(loaded.elements[0]?.clip?.sourceCompositionId).toBe("composition-1");
	});

	it("CompositionAudioClip 使用非负轨道会校验失败", () => {
		const timeline = createBaseTimeline();
		timeline.elements = [
			{
				id: "composition-audio-1",
				type: "CompositionAudioClip",
				component: "composition-audio-clip",
				name: "composition-audio-1",
				timeline: {
					start: 0,
					end: 30,
					startTimecode: "00:00:00:00",
					endTimecode: "00:00:01:00",
					trackIndex: 0,
					role: "audio",
				},
				props: {
					sceneId: "scene-2",
				},
			},
		];

		expect(() => loadTimelineFromObject(timeline)).toThrow(
			"AudioClip/CompositionAudioClip must use a negative trackIndex",
		);
	});
});
