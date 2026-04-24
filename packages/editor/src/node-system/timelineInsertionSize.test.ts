import { describe, expect, it } from "vitest";
import { resolveSceneTimelineInsertionSize } from "./timelineInsertionSize";

describe("resolveSceneTimelineInsertionSize", () => {
	it("原始尺寸小于 scene 时保持原始尺寸", () => {
		expect(
			resolveSceneTimelineInsertionSize({
				sourceSize: { width: 640, height: 360 },
				fallbackSize: { width: 320, height: 180 },
				targetSize: { width: 1920, height: 1080 },
			}),
		).toEqual({ width: 640, height: 360 });
	});

	it("原始尺寸大于 scene 时按 contain 缩小", () => {
		expect(
			resolveSceneTimelineInsertionSize({
				sourceSize: { width: 4000, height: 1000 },
				fallbackSize: { width: 320, height: 180 },
				targetSize: { width: 1920, height: 1080 },
			}),
		).toEqual({ width: 1920, height: 480 });
	});

	it("缺少原始尺寸时回退到节点尺寸", () => {
		expect(
			resolveSceneTimelineInsertionSize({
				sourceSize: null,
				fallbackSize: { width: 480, height: 270 },
				targetSize: { width: 1920, height: 1080 },
			}),
		).toEqual({ width: 480, height: 270 });
	});

	it("回退节点尺寸大于 scene 时也按 contain 缩小", () => {
		expect(
			resolveSceneTimelineInsertionSize({
				sourceSize: null,
				fallbackSize: { width: 3000, height: 3000 },
				targetSize: { width: 1920, height: 1080 },
			}),
		).toEqual({ width: 1080, height: 1080 });
	});
});
