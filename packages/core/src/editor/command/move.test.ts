import type { TimelineElement } from "../../dsl/types";
import type { TimelineTrack } from "../timeline/types";
import { describe, expect, it } from "vitest";
import { applyTimelineCommandToSnapshot } from "./reducer";
import type { TimelineCommandSnapshot } from "./types";

const createTrack = (
	id: string,
	role: "clip" | "overlay",
	options?: { locked?: boolean },
): TimelineTrack => ({
	id,
	role,
	hidden: false,
	locked: options?.locked ?? false,
	muted: false,
	solo: false,
});

const createElement = (
	id: string,
	start: number,
	end: number,
	trackIndex: number,
	trackId?: string,
): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:03:00",
		trackIndex,
		...(trackId ? { trackId } : {}),
	},
	props: {},
});

const createSnapshot = (
	overrides?: Partial<TimelineCommandSnapshot>,
): TimelineCommandSnapshot => ({
	revision: 1,
	fps: 30,
	currentTime: 0,
	elements: [createElement("clip-1", 0, 30, 0, "main-track")],
	tracks: [createTrack("main-track", "clip")],
	audioTrackStates: {},
	autoAttach: false,
	rippleEditingEnabled: false,
	...overrides,
});

const unwrapMoveResult = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
) => {
	return applyTimelineCommandToSnapshot(snapshot, {
		id: "timeline.element.move",
		args,
		raw: "timeline.element.move",
	});
};

describe("timeline.element.move", () => {
	it("保持元素时长不变", () => {
		const snapshot = createSnapshot();
		const result = unwrapMoveResult(snapshot, {
			id: "clip-1",
			start: 100,
		});
		expect(result.ok).toBe(true);
		const moved = result.snapshot.elements.find((element) => element.id === "clip-1");
		expect(moved?.timeline.start).toBe(100);
		expect(moved?.timeline.end).toBe(130);
	});

	it("禁止通过 move 修改长度", () => {
		const snapshot = createSnapshot();
		const result = unwrapMoveResult(snapshot, {
			id: "clip-1",
			start: 100,
			end: 140,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("timeline.element.trim");
	});

	it("要求 start 与 delta 二选一", () => {
		const snapshot = createSnapshot();
		const withBoth = unwrapMoveResult(snapshot, {
			id: "clip-1",
			start: 10,
			delta: 1,
		});
		const withNone = unwrapMoveResult(snapshot, {
			id: "clip-1",
		});
		expect(withBoth.ok).toBe(false);
		expect(withBoth.error).toContain("不能同时提供");
		expect(withNone.ok).toBe(false);
		expect(withNone.error).toContain("请提供 start 或 delta");
	});

	it("主轨波纹移动应按插入语义重排", () => {
		const snapshot = createSnapshot({
			elements: [
				createElement("clip-1", 0, 30, 0, "main-track"),
				createElement("clip-2", 30, 60, 0, "main-track"),
			],
			rippleEditingEnabled: true,
		});
		const result = unwrapMoveResult(snapshot, {
			id: "clip-1",
			start: 40,
		});
		expect(result.ok).toBe(true);
		const clip1 = result.snapshot.elements.find((element) => element.id === "clip-1");
		const clip2 = result.snapshot.elements.find((element) => element.id === "clip-2");
		expect(clip2?.timeline.start).toBe(0);
		expect(clip1?.timeline.start).toBe(30);
	});

	it("autoAttach=true 时主元素位移会联动子元素", () => {
		const snapshot = createSnapshot({
			elements: [
				createElement("parent", 0, 30, 0, "main-track"),
				createElement("child", 10, 20, 1, "overlay-track"),
			],
			tracks: [
				createTrack("main-track", "clip"),
				createTrack("overlay-track", "overlay"),
			],
			autoAttach: true,
		});
		const result = unwrapMoveResult(snapshot, {
			id: "parent",
			delta: 15,
		});
		expect(result.ok).toBe(true);
		const child = result.snapshot.elements.find((element) => element.id === "child");
		expect(child?.timeline.start).toBe(25);
		expect(child?.timeline.end).toBe(35);
	});

	it("autoAttach=false 时子元素不联动", () => {
		const snapshot = createSnapshot({
			elements: [
				createElement("parent", 0, 30, 0, "main-track"),
				createElement("child", 10, 20, 1, "overlay-track"),
			],
			tracks: [
				createTrack("main-track", "clip"),
				createTrack("overlay-track", "overlay"),
			],
			autoAttach: false,
		});
		const result = unwrapMoveResult(snapshot, {
			id: "parent",
			delta: 15,
		});
		expect(result.ok).toBe(true);
		const child = result.snapshot.elements.find((element) => element.id === "child");
		expect(child?.timeline.start).toBe(10);
		expect(child?.timeline.end).toBe(20);
	});

	it("源轨或目标轨锁定时应失败", () => {
		const sourceLocked = createSnapshot({
			tracks: [createTrack("main-track", "clip", { locked: true })],
		});
		const targetLocked = createSnapshot({
			tracks: [
				createTrack("main-track", "clip"),
				createTrack("overlay-track", "overlay", { locked: true }),
			],
		});

		const sourceResult = unwrapMoveResult(sourceLocked, {
			id: "clip-1",
			start: 10,
		});
		const targetResult = unwrapMoveResult(targetLocked, {
			id: "clip-1",
			start: 10,
			trackIndex: 1,
		});

		expect(sourceResult.ok).toBe(false);
		expect(sourceResult.error).toContain("源轨道已锁定");
		expect(targetResult.ok).toBe(false);
		expect(targetResult.error).toContain("目标轨道已锁定");
	});
});
