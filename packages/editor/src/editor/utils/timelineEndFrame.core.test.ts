import type { TimelineElement } from "core/dsl/types";
import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import { describe, expect, it } from "vitest";

const createElement = ({
	id,
	type,
	end,
}: {
	id: string;
	type: TimelineElement["type"];
	end: number;
}): TimelineElement => ({
	id,
	type,
	component: "mock",
	name: id,
	timeline: {
		start: 0,
		end,
		startTimecode: "",
		endTimecode: "",
		trackIndex: 0,
	},
	props: {},
});

describe("resolveTimelineEndFrame", () => {
	it("混合元素时取非 Filter 的最大 end", () => {
		const endFrame = resolveTimelineEndFrame([
			createElement({ id: "v-1", type: "VideoClip", end: 120 }),
			createElement({ id: "a-1", type: "AudioClip", end: 180 }),
			createElement({ id: "f-1", type: "Filter", end: 60 }),
		]);
		expect(endFrame).toBe(180);
	});

	it("Filter end 更大时会被忽略", () => {
		const endFrame = resolveTimelineEndFrame([
			createElement({ id: "v-1", type: "VideoClip", end: 120 }),
			createElement({ id: "f-1", type: "Filter", end: 300 }),
		]);
		expect(endFrame).toBe(120);
	});

	it("全是 Filter 时返回 0", () => {
		const endFrame = resolveTimelineEndFrame([
			createElement({ id: "f-1", type: "Filter", end: 100 }),
			createElement({ id: "f-2", type: "Filter", end: 240 }),
		]);
		expect(endFrame).toBe(0);
	});
});
