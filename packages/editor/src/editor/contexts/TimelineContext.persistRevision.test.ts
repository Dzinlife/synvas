import type { TimelineElement } from "core/dsl/types";
import { describe, expect, it } from "vitest";
import { createTimelineStore } from "./TimelineContext";

const createElement = (
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
	props: {
		uri: `${id}.mp4`,
	},
});

describe("TimelineContext persistRevision", () => {
	it("持久化字段变化会递增 persistRevision", () => {
		const timelineStore = createTimelineStore();

		const expectBump = (update: () => void) => {
			const before = timelineStore.getState().persistRevision;
			update();
			expect(timelineStore.getState().persistRevision).toBe(before + 1);
		};

		expectBump(() => {
			timelineStore.getState().setFps(60);
		});
		expectBump(() => {
			timelineStore
				.getState()
				.setElements([createElement("clip-1", 0, 30)], { history: false });
		});
		expectBump(() => {
			timelineStore.getState().setTracks((tracks) =>
				tracks.map((track, index) =>
					index === 0 ? { ...track, muted: !track.muted } : track,
				),
			);
		});
		expectBump(() => {
			timelineStore.getState().setCanvasSize({ width: 1280, height: 720 });
		});
		expectBump(() => {
			timelineStore.getState().setSnapEnabled(false);
		});
		expectBump(() => {
			timelineStore.getState().setAutoAttach(false);
		});
		expectBump(() => {
			timelineStore.getState().setRippleEditingEnabled(true);
		});
		expectBump(() => {
			timelineStore.getState().setPreviewAxisEnabled(false);
		});
		expectBump(() => {
			const audioSettings = timelineStore.getState().audioSettings;
			timelineStore.getState().setAudioSettings({
				...audioSettings,
				masterGainDb: audioSettings.masterGainDb + 1,
				compressor: { ...audioSettings.compressor },
			});
		});
	});

	it("非持久化字段变化不会递增 persistRevision", () => {
		const timelineStore = createTimelineStore();
		timelineStore
			.getState()
			.setElements([createElement("clip-1", 0, 120)], { history: false });
		timelineStore.getState().setTimelineMaxScrollLeft(200);

		const expectNoBump = (update: () => void) => {
			const before = timelineStore.getState().persistRevision;
			update();
			expect(timelineStore.getState().persistRevision).toBe(before);
		};

		expectNoBump(() => {
			timelineStore.getState().setCurrentTime(10);
		});
		expectNoBump(() => {
			timelineStore.getState().setPreviewTime(20);
		});
		expectNoBump(() => {
			timelineStore.setState({ isPlaying: true });
		});
		expectNoBump(() => {
			timelineStore.getState().setSelectedIds(["clip-1"], "clip-1");
		});
		expectNoBump(() => {
			timelineStore.getState().setScrollLeft(80);
		});
	});
});
