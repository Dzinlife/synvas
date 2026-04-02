// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TrackerModule = typeof import("../src/skia/web/resourceTracker");

const loadTrackerModule = async (): Promise<TrackerModule> => {
	vi.resetModules();
	return import("../src/skia/web/resourceTracker");
};

const createTrackedTarget = (type: string) => {
	return {
		__typename__: type,
		ref: {
			delete: () => {},
		},
	};
};

describe("skia resource tracker", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	afterEach(() => {
		window.localStorage.clear();
		delete (
			window as Window & {
				__AI_NLE_SKIA_RESOURCE_TRACKER__?: unknown;
			}
		).__AI_NLE_SKIA_RESOURCE_TRACKER__;
	});

	it("在无配置时返回默认值（追踪关闭）", async () => {
		const tracker = await loadTrackerModule();

		expect(tracker.getSkiaResourceTrackerConfig()).toEqual({
			enabled: false,
			captureStacks: false,
			autoProjectSwitchSnapshot: false,
			sampleLimitPerType: 3,
		});
	});

	it("支持 localStorage 配置读写并可热更新", async () => {
		const tracker = await loadTrackerModule();
		const next = tracker.setSkiaResourceTrackerConfig({
			enabled: true,
			captureStacks: true,
			autoProjectSwitchSnapshot: true,
			sampleLimitPerType: 9,
		});

		expect(next).toEqual({
			enabled: true,
			captureStacks: true,
			autoProjectSwitchSnapshot: true,
			sampleLimitPerType: 9,
		});
		const raw = window.localStorage.getItem(
			tracker.getSkiaResourceTrackerStorageKey(),
		);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw ?? "{}")).toEqual(next);

		const updated = tracker.setSkiaResourceTrackerConfig({
			captureStacks: false,
			sampleLimitPerType: 9999,
		});
		expect(updated).toEqual({
			enabled: true,
			captureStacks: false,
			autoProjectSwitchSnapshot: true,
			sampleLimitPerType: 200,
		});
		expect(tracker.getSkiaResourceTrackerConfig()).toEqual(updated);
	});

	it("非法 JSON 会兜底为默认配置", async () => {
		const tracker = await loadTrackerModule();
		window.localStorage.setItem(
			tracker.getSkiaResourceTrackerStorageKey(),
			"{invalid-json",
		);

		expect(tracker.getSkiaResourceTrackerConfig()).toEqual({
			enabled: false,
			captureStacks: false,
			autoProjectSwitchSnapshot: false,
			sampleLimitPerType: 3,
		});
	});

	it("enabled=false 时不会记录对象", async () => {
		const tracker = await loadTrackerModule();
		tracker.setSkiaResourceTrackerConfig({
			enabled: false,
		});

		const target = createTrackedTarget("Paint");
		tracker.registerTrackedSkiaHostObject(target);

		expect(tracker.getTrackedSkiaHostObjectCount()).toBe(0);
		expect(tracker.getTrackedSkiaHostObjectStats()).toEqual({
			total: 0,
			byType: {},
		});
	});

	it("enabled=true 时 snapshot/diff 正常，captureStacks 会影响样本栈字段", async () => {
		const tracker = await loadTrackerModule();
		tracker.setSkiaResourceTrackerConfig({
			enabled: true,
			captureStacks: false,
			sampleLimitPerType: 8,
		});

		const paintA = createTrackedTarget("Paint");
		const shaderA = createTrackedTarget("Shader");
		tracker.registerTrackedSkiaHostObject(paintA);
		tracker.registerTrackedSkiaHostObject(shaderA);
		const before = tracker.captureTrackedSkiaHostObjectsSnapshot({
			includeSamples: true,
		});
		const beforePaintSamples = before.samplesByType?.Paint ?? [];
		expect(before.total).toBe(2);
		expect(before.byType).toEqual({
			Paint: 1,
			Shader: 1,
		});
		expect(beforePaintSamples[0]?.creationStack).toBeUndefined();

		tracker.setSkiaResourceTrackerConfig({
			captureStacks: true,
		});
		const paintB = createTrackedTarget("Paint");
		tracker.registerTrackedSkiaHostObject(paintB);
		const after = tracker.captureTrackedSkiaHostObjectsSnapshot({
			includeSamples: true,
		});
		const diff = tracker.diffTrackedSkiaHostObjectSnapshots(before, after);
		const afterPaintSamples = after.samplesByType?.Paint ?? [];
		expect(after.total).toBe(3);
		expect(diff.totalDelta).toBe(1);
		expect(diff.byTypeDelta).toEqual({
			Paint: 1,
		});
		expect(
			afterPaintSamples.some((sample) => {
				return typeof sample.creationStack === "string";
			}),
		).toBe(true);

		tracker.unregisterTrackedSkiaHostObject(paintA);
		tracker.unregisterTrackedSkiaHostObject(shaderA);
		tracker.unregisterTrackedSkiaHostObject(paintB);
		expect(tracker.getTrackedSkiaHostObjectCount()).toBe(0);
	});
});
