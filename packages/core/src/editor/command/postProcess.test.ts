import type { TimelineElement } from "../../dsl/types";
import { describe, expect, it } from "vitest";
import { executePlanOnSnapshot, postProcessSnapshot } from "./postProcess";
import type { ParsedCommand, TimelineCommandSnapshot } from "./types";

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
	tracks: [
		{
			id: "main-track",
			role: "clip",
			hidden: false,
			locked: false,
			muted: false,
			solo: false,
		},
	],
	audioTrackStates: {},
	autoAttach: false,
	rippleEditingEnabled: false,
	...overrides,
});

describe("postProcess", () => {
	it("executePlanOnSnapshot 应完成 reconcile 并补齐 trackId", () => {
		const snapshot = createSnapshot();
		const commands: ParsedCommand[] = [
			{
				id: "timeline.element.move",
				args: {
					id: "clip-1",
					start: 0,
					trackIndex: 3,
				},
				raw: "timeline.element.move --id clip-1 --start 0 --track-index 3",
			},
		];
		const result = executePlanOnSnapshot(commands, snapshot);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(1);
		const moved = result.snapshot.elements.find((element) => element.id === "clip-1");
		expect((moved?.timeline.trackIndex ?? -1) >= 1).toBe(true);
		const movedTrackIndex = moved?.timeline.trackIndex ?? 0;
		expect(result.snapshot.tracks[movedTrackIndex]).toBeTruthy();
		expect(moved?.timeline.trackId).toBe(
			result.snapshot.tracks[movedTrackIndex]?.id,
		);
	});

	it("postProcessSnapshot 应清理无效音轨状态并保留 -1", () => {
		const snapshot = createSnapshot({
			audioTrackStates: {
				[-1]: { locked: false, muted: true, solo: false },
				[-2]: { locked: true, muted: false, solo: false },
			},
		});
		const next = postProcessSnapshot(snapshot);
		expect(next.audioTrackStates[-1]).toBeTruthy();
		expect(next.audioTrackStates[-2]).toBeUndefined();
	});
});
