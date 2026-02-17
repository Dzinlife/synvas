import type { TimelineElement } from "core/dsl/types";
import { describe, expect, it, vi } from "vitest";
import { applyFreezeFrame, resolveFreezeCandidate } from "./timelineFreeze";

vi.mock("react-skia-lite", () => ({
	Skia: {},
}));

const createVideoClip = ({
	id,
	start,
	end,
	trackIndex = 0,
	offset = 0,
	reversed = false,
}: {
	id: string;
	start: number;
	end: number;
	trackIndex?: number;
	offset?: number;
	reversed?: boolean;
}): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	sourceId: `${id}-source`,
	timeline: {
		start,
		end,
		startTimecode: "",
		endTimecode: "",
		offset,
		trackIndex,
		role: "clip",
	},
	props: {
		reversed,
	},
});

const createIdFactory = (...ids: string[]) => {
	let index = 0;
	return () => {
		const next = ids[index];
		index += 1;
		return next ?? `generated-${index}`;
	};
};

describe("TimelineToolbar.freeze", () => {
	it("主轨 + 波纹开启时，右侧片段与后续片段按插入链路整体后移", () => {
		const target = createVideoClip({
			id: "target",
			start: 0,
			end: 90,
			trackIndex: 0,
		});
		const following = createVideoClip({
			id: "following",
			start: 90,
			end: 150,
			trackIndex: 0,
		});
		const elements = [target, following];
		const candidate = resolveFreezeCandidate({
			elements,
			selectedIds: ["target"],
			primaryId: "target",
			currentTime: 80,
		});
		expect(candidate).not.toBeNull();

		const next = applyFreezeFrame({
			elements,
			candidate: candidate as TimelineElement<{ reversed?: boolean }>,
			splitFrame: 80,
			fps: 30,
			rippleEditingEnabled: true,
			createElementId: createIdFactory("right-clip", "freeze-clip"),
		});

		const left = next.find((element) => element.id === "target");
		const freeze = next.find((element) => element.id === "freeze-clip");
		const right = next.find((element) => element.id === "right-clip");
		const shiftedFollowing = next.find((element) => element.id === "following");

		expect(left?.timeline.start).toBe(0);
		expect(left?.timeline.end).toBe(80);
		expect(freeze?.timeline.start).toBe(80);
		expect(freeze?.timeline.end).toBe(170);
		expect(right?.timeline.start).toBe(170);
		expect(right?.timeline.end).toBe(180);
		expect(shiftedFollowing?.timeline.start).toBe(180);
		expect(shiftedFollowing?.timeline.end).toBe(240);
		expect((freeze?.props as { sourceElementId?: string }).sourceElementId).toBe(
			"target",
		);
		expect((freeze?.props as { sourceFrame?: number }).sourceFrame).toBe(80);
		expect((freeze?.props as { sourceTime?: number }).sourceTime).toBeCloseTo(
			80 / 30,
		);
	});

	it("主轨 + 波纹关闭时，不做时间位移，仅通过轨道重排消除重叠", () => {
		const target = createVideoClip({
			id: "target",
			start: 0,
			end: 90,
			trackIndex: 0,
		});
		const following = createVideoClip({
			id: "following",
			start: 90,
			end: 150,
			trackIndex: 0,
		});
		const elements = [target, following];
		const candidate = resolveFreezeCandidate({
			elements,
			selectedIds: ["target"],
			primaryId: "target",
			currentTime: 30,
		});
		expect(candidate).not.toBeNull();

		const next = applyFreezeFrame({
			elements,
			candidate: candidate as TimelineElement<{ reversed?: boolean }>,
			splitFrame: 30,
			fps: 30,
			rippleEditingEnabled: false,
			createElementId: createIdFactory("right-clip", "freeze-clip"),
		});

		const freeze = next.find((element) => element.id === "freeze-clip");
		const right = next.find((element) => element.id === "right-clip");
		const untouchedFollowing = next.find((element) => element.id === "following");

		expect(freeze?.timeline.start).toBe(30);
		expect(freeze?.timeline.end).toBe(120);
		expect(freeze?.timeline.trackIndex).toBe(2);
		expect(right?.timeline.start).toBe(30);
		expect(right?.timeline.end).toBe(90);
		expect(right?.timeline.trackIndex).toBe(1);
		expect(untouchedFollowing?.timeline.start).toBe(90);
		expect(untouchedFollowing?.timeline.end).toBe(150);
	});

	it("非主轨时即使波纹开启也不做时间位移，走轨道重排", () => {
		const target = createVideoClip({
			id: "target",
			start: 0,
			end: 90,
			trackIndex: 1,
		});
		const following = createVideoClip({
			id: "following",
			start: 90,
			end: 150,
			trackIndex: 1,
		});
		const elements = [target, following];
		const candidate = resolveFreezeCandidate({
			elements,
			selectedIds: ["target"],
			primaryId: "target",
			currentTime: 30,
		});
		expect(candidate).not.toBeNull();

		const next = applyFreezeFrame({
			elements,
			candidate: candidate as TimelineElement<{ reversed?: boolean }>,
			splitFrame: 30,
			fps: 30,
			rippleEditingEnabled: true,
			createElementId: createIdFactory("right-clip", "freeze-clip"),
		});

		const freeze = next.find((element) => element.id === "freeze-clip");
		const right = next.find((element) => element.id === "right-clip");
		const untouchedFollowing = next.find((element) => element.id === "following");

		expect(freeze?.timeline.start).toBe(30);
		expect(freeze?.timeline.end).toBe(120);
		expect(freeze?.timeline.trackIndex).toBe(3);
		expect(right?.timeline.start).toBe(30);
		expect(right?.timeline.end).toBe(90);
		expect(right?.timeline.trackIndex).toBe(2);
		expect(untouchedFollowing?.timeline.start).toBe(90);
		expect(untouchedFollowing?.timeline.end).toBe(150);
	});

	it("sourceFrame/sourceTime 在倒放 + offset 场景下按源时间写入", () => {
		const target = createVideoClip({
			id: "target",
			start: 100,
			end: 220,
			trackIndex: 0,
			offset: 30,
			reversed: true,
		});
		const elements = [target];
		const candidate = resolveFreezeCandidate({
			elements,
			selectedIds: ["target"],
			primaryId: "target",
			currentTime: 130,
		});
		expect(candidate).not.toBeNull();

		const next = applyFreezeFrame({
			elements,
			candidate: candidate as TimelineElement<{ reversed?: boolean }>,
			splitFrame: 130,
			fps: 30,
			rippleEditingEnabled: false,
			createElementId: createIdFactory("right-clip", "freeze-clip"),
		});
		const freeze = next.find((element) => element.id === "freeze-clip");
		const sourceTime = (freeze?.props as { sourceTime?: number }).sourceTime;
		const sourceFrame = (freeze?.props as { sourceFrame?: number }).sourceFrame;

		expect(sourceTime).toBeCloseTo(4);
		expect(sourceFrame).toBe(120);
		expect((freeze?.props as { sourceElementId?: string }).sourceElementId).toBe(
			"target",
		);
	});
});
