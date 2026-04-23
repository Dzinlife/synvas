import type { TimelineElement } from "core/timeline-system/types";
import { describe, expect, it } from "vitest";
import {
	applyQuickSplitFrames,
	computeQuickSplitFramesFromScores,
	resolveQuickSplitCandidate,
} from "./timelineQuickSplit";

const createVideoClip = (options: {
	id: string;
	start: number;
	end: number;
	offset?: number;
	reversed?: boolean;
	assetId?: string;
}): TimelineElement => ({
	id: options.id,
	type: "VideoClip",
	component: "video-clip",
	name: options.id,
	assetId: options.assetId ?? "source-video",
	timeline: {
		start: options.start,
		end: options.end,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:03:00",
		offset: options.offset ?? 0,
		trackIndex: 0,
	},
	props: {
		reversed: options.reversed ?? false,
	},
});

const createTransition = (options: {
	id: string;
	fromId: string;
	toId: string;
	boundary: number;
}): TimelineElement => ({
	id: options.id,
	type: "Transition",
	component: "transition",
	name: options.id,
	timeline: {
		start: options.boundary - 8,
		end: options.boundary + 7,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:00:00",
		trackIndex: 0,
	},
	props: {},
	transition: {
		duration: 15,
		boundry: options.boundary,
		fromId: options.fromId,
		toId: options.toId,
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

describe("timelineQuickSplit", () => {
	it("resolveQuickSplitCandidate 仅接受主选单个 VideoClip", () => {
		const candidate = createVideoClip({
			id: "clip-1",
			start: 0,
			end: 90,
		});
		const audio: TimelineElement = {
			id: "audio-1",
			type: "AudioClip",
			component: "audio-clip",
			name: "audio-1",
			timeline: {
				start: 0,
				end: 90,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:00:00",
				trackIndex: -1,
			},
			props: {
			},
		};

		expect(
			resolveQuickSplitCandidate({
				elements: [candidate, audio],
				selectedIds: ["clip-1"],
				primaryId: "clip-1",
			}),
		).not.toBeNull();
		expect(
			resolveQuickSplitCandidate({
				elements: [candidate],
				selectedIds: ["clip-1", "audio-1"],
				primaryId: "clip-1",
			}),
		).toBeNull();
		expect(
			resolveQuickSplitCandidate({
				elements: [candidate],
				selectedIds: ["clip-1"],
				primaryId: "missing",
			}),
		).toBeNull();
		expect(
			resolveQuickSplitCandidate({
				elements: [
					createVideoClip({
						id: "clip-2",
						start: 0,
						end: 60,
						assetId: "",
					}),
				],
				selectedIds: ["clip-2"],
				primaryId: "clip-2",
			}),
		).toBeNull();
	});

	it("computeQuickSplitFramesFromScores 可提取局部峰值切点", () => {
		const splitFrames = computeQuickSplitFramesFromScores({
			sampleFrames: [0, 10, 20, 30, 40, 50, 60],
			scores: [0.1, 0.9, 0.1, 0.8, 0.1, 0.7],
			startFrame: 0,
			endFrame: 60,
			sensitivity: 100,
			minGapFrames: 12,
		});
		expect(splitFrames).toEqual([20, 40]);
	});

	it("applyQuickSplitFrames 前向切分保持 offset 连续", () => {
		const target = createVideoClip({
			id: "clip-1",
			start: 0,
			end: 90,
			offset: 30,
			reversed: false,
		});
		const next = applyQuickSplitFrames({
			elements: [target],
			targetId: target.id,
			splitFrames: [30, 60],
			fps: 30,
			createElementId: createIdFactory("clip-2", "clip-3"),
		});

		const parts = next.filter((element) => element.type === "VideoClip");
		expect(parts.map((element) => element.timeline.start)).toEqual([0, 30, 60]);
		expect(parts.map((element) => element.timeline.end)).toEqual([30, 60, 90]);
		expect(parts.map((element) => element.timeline.offset)).toEqual([30, 60, 90]);
	});

	it("applyQuickSplitFrames 反向切分保持 offset 连续", () => {
		const target = createVideoClip({
			id: "clip-1",
			start: 0,
			end: 90,
			offset: 30,
			reversed: true,
		});
		const next = applyQuickSplitFrames({
			elements: [target],
			targetId: target.id,
			splitFrames: [30, 60],
			fps: 30,
			createElementId: createIdFactory("clip-2", "clip-3"),
		});

		const parts = next.filter((element) => element.type === "VideoClip");
		expect(parts.map((element) => element.timeline.offset)).toEqual([90, 60, 30]);
	});

	it("applyQuickSplitFrames 会把片尾转场 fromId 重映射到最后一段", () => {
		const target = createVideoClip({
			id: "clip-1",
			start: 0,
			end: 90,
		});
		const nextClip = createVideoClip({
			id: "clip-next",
			start: 90,
			end: 150,
		});
		const transition = createTransition({
			id: "transition-1",
			fromId: "clip-1",
			toId: "clip-next",
			boundary: 90,
		});
		const next = applyQuickSplitFrames({
			elements: [target, nextClip, transition],
			targetId: target.id,
			splitFrames: [30, 60],
			fps: 30,
			createElementId: createIdFactory("clip-2", "clip-3"),
		});
		const mappedTransition = next.find((element) => element.id === "transition-1");
		expect(mappedTransition?.transition?.fromId).toBe("clip-3");
	});
});
