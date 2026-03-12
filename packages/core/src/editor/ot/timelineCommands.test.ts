import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../../element/types";
import type { TimelineTrack } from "../timeline/types";
import {
	applyTimelineOtCommand,
	buildTimelineBatchCommandFromSnapshots,
	invertTimelineOtCommand,
	transformTimelineOtCommand,
} from "./timelineCommands";

const createElement = (id: string, start = 0, end = 30): TimelineElement => ({
	id,
	type: "Image",
	component: "image",
	name: id,
	assetId: "asset-1",
	props: {},
	timeline: {
		start,
		end,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:00",
		trackIndex: 0,
		role: "clip",
	},
});

const createTrack = (id: string): TimelineTrack => ({
	id,
	role: "clip",
	hidden: false,
	locked: false,
	muted: false,
	solo: false,
});

describe("timelineCommands", () => {
	it("batch command apply + invert 可闭包回放", () => {
		const before = {
			elements: [createElement("e1"), createElement("e2")],
			tracks: [createTrack("t1")],
			audioTrackStates: {},
			rippleEditingEnabled: false,
		};
		const after = {
			elements: [createElement("e2", 10, 40), createElement("e3", 40, 70)],
			tracks: [createTrack("t1"), createTrack("t2")],
			audioTrackStates: {
				[-1]: { locked: true, muted: false, solo: false },
			},
			rippleEditingEnabled: true,
		};
		const command = buildTimelineBatchCommandFromSnapshots({ before, after });
		expect(command).toBeTruthy();
		if (!command) return;
		const forward = applyTimelineOtCommand(before, command);
		expect(forward).toEqual(after);
		const inverse = invertTimelineOtCommand(command);
		expect(inverse).toBeTruthy();
		if (!inverse) return;
		const restored = applyTimelineOtCommand(forward, inverse);
		expect(restored.rippleEditingEnabled).toBe(before.rippleEditingEnabled);
		expect(restored.tracks.map((item) => item.id)).toEqual(
			before.tracks.map((item) => item.id),
		);
		expect(restored.elements.map((item) => item.id).sort()).toEqual(
			before.elements.map((item) => item.id).sort(),
		);
	});

	it("transform 遇到删改冲突时删除优先", () => {
		const left = {
			id: "timeline.batch.apply" as const,
			args: {
				elementOps: [
					{
						kind: "update" as const,
						elementId: "e1",
						before: createElement("e1", 0, 30),
						after: createElement("e1", 30, 60),
					},
				],
				trackOps: [],
				audioTrackOps: [],
				settingOps: [],
			},
		};
		const right = {
			id: "timeline.batch.apply" as const,
			args: {
				elementOps: [
					{
						kind: "remove" as const,
						elementId: "e1",
						before: createElement("e1", 0, 30),
					},
				],
				trackOps: [],
				audioTrackOps: [],
				settingOps: [],
			},
		};
		const transformed = transformTimelineOtCommand(left, right, "left");
		expect(transformed.args.elementOps).toHaveLength(0);
	});
});
