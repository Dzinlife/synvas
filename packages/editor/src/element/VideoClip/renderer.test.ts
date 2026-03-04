import { describe, expect, it, vi } from "vitest";
import { applyPlayingPlaybackStrategy } from "./playbackStrategy";

describe("VideoClipRenderer playback strategy", () => {
	it("播放且倒放时走 seek，并附带 reverse-playback reason", () => {
		const seekToTime = vi.fn(async () => {});
		const stepPlayback = vi.fn(async () => {});

		const action = applyPlayingPlaybackStrategy({
			reversed: true,
			videoTime: 3.25,
			seekToTime,
			stepPlayback,
		});

		expect(action).toBe("seek");
		expect(seekToTime).toHaveBeenCalledWith(3.25, {
			reason: "reverse-playback",
		});
		expect(stepPlayback).not.toHaveBeenCalled();
	});

	it("播放且正放时走 stepPlayback", () => {
		const seekToTime = vi.fn(async () => {});
		const stepPlayback = vi.fn(async () => {});

		const action = applyPlayingPlaybackStrategy({
			reversed: false,
			videoTime: 4.5,
			seekToTime,
			stepPlayback,
		});

		expect(action).toBe("step");
		expect(stepPlayback).toHaveBeenCalledWith(4.5);
		expect(seekToTime).not.toHaveBeenCalled();
	});
});
