import type { TimelineElement } from "core/timeline-system/types";
import { describe, expect, it } from "vitest";
import { resolveMainTrackDropPreview } from "./mainTrackInsertPreview";

const createMainClip = (
	id: string,
	start: number,
	end: number,
): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "",
		endTimecode: "",
		trackIndex: 0,
	},
	props: {},
});

describe("resolveMainTrackDropPreview", () => {
	it("插入位落在中间时返回 insert-line", () => {
		const result = resolveMainTrackDropPreview(
			[createMainClip("a", 0, 30), createMainClip("b", 30, 60)],
			40,
		);
		expect(result.mode).toBe("insert-line");
		expect(result.insertTime).toBe(30);
	});

	it("插入到最开头时返回 insert-line", () => {
		const result = resolveMainTrackDropPreview(
			[createMainClip("a", 20, 50), createMainClip("b", 50, 80)],
			0,
		);
		expect(result.mode).toBe("insert-line");
		expect(result.insertTime).toBe(20);
	});

	it("只在末尾插入时返回 box", () => {
		const result = resolveMainTrackDropPreview(
			[
				createMainClip("a", 0, 30),
				createMainClip("b", 30, 60),
				createMainClip("c", 60, 90),
			],
			100,
		);
		expect(result.mode).toBe("box");
		expect(result.insertTime).toBe(90);
	});

	it("排除被拖元素后仍按插入位显示 insert-line", () => {
		const result = resolveMainTrackDropPreview(
			[
				createMainClip("a", 0, 30),
				createMainClip("b", 30, 60),
				createMainClip("c", 60, 90),
			],
			30,
			{ excludeElementIds: ["a"] },
		);
		expect(result.mode).toBe("insert-line");
		expect(result.insertTime).toBe(30);
	});
});
