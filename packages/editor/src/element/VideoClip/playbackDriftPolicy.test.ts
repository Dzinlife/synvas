import { describe, expect, it } from "vitest";
import { shouldSeekAfterStepPlayback } from "./playbackDriftPolicy";

describe("playbackDriftPolicy", () => {
	it("播放态低于时间线 fps 的素材不会因正常差异触发 seek（24 -> 30）", () => {
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: true,
			targetTime: 10,
			renderedTime: 9.97,
			timelineFrameInterval: 1 / 30,
			observedFrameInterval: 1 / 24,
			stalledDurationSeconds: 0.05,
		});
		expect(shouldSeek).toBe(false);
	});

	it("播放态高于时间线 fps 的素材不会因正常差异触发 seek（60 -> 24）", () => {
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: true,
			targetTime: 6,
			renderedTime: 5.99,
			timelineFrameInterval: 1 / 24,
			observedFrameInterval: 1 / 60,
			stalledDurationSeconds: 0.04,
		});
		expect(shouldSeek).toBe(false);
	});

	it("播放态低 fps 素材在高 fps 时间线按自适应阈值不误触发 seek", () => {
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: true,
			targetTime: 8.0,
			renderedTime: 7.3,
			timelineFrameInterval: 1 / 60,
			observedFrameInterval: 0.4,
			stalledDurationSeconds: 0.5,
		});
		expect(shouldSeek).toBe(false);
	});

	it("播放态出现持续无进展且大漂移时触发 seek", () => {
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: true,
			targetTime: 12.0,
			renderedTime: 11.7,
			timelineFrameInterval: 1 / 30,
			observedFrameInterval: 1 / 30,
			stalledDurationSeconds: 0.2,
		});
		expect(shouldSeek).toBe(true);
	});

	it("播放态漂移超过硬阈值时，即使短停滞也会触发 seek", () => {
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: true,
			targetTime: 10,
			renderedTime: 9.72,
			timelineFrameInterval: 1 / 30,
			observedFrameInterval: 1 / 30,
			stalledDurationSeconds: 0.03,
		});
		expect(shouldSeek).toBe(true);
	});

	it("播放态在没有 observedFrameInterval 时，长停滞触发兜底 seek", () => {
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: true,
			targetTime: 2,
			renderedTime: 1.6,
			timelineFrameInterval: 1 / 30,
			observedFrameInterval: null,
			stalledDurationSeconds: 0.3,
		});
		expect(shouldSeek).toBe(true);
	});

	it("播放态在没有 observedFrameInterval 时，短停滞不触发兜底 seek", () => {
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: true,
			targetTime: 2,
			renderedTime: 1.6,
			timelineFrameInterval: 1 / 30,
			observedFrameInterval: null,
			stalledDurationSeconds: 0.05,
		});
		expect(shouldSeek).toBe(false);
	});

	it("非播放态保持半帧落后回退 seek 逻辑", () => {
		const timelineFrameInterval = 1 / 30;
		const shouldSeek = shouldSeekAfterStepPlayback({
			isPlaying: false,
			targetTime: 4,
			renderedTime: 4 - timelineFrameInterval * 0.51,
			timelineFrameInterval,
			observedFrameInterval: null,
			stalledDurationSeconds: null,
		});
		const shouldNotSeek = shouldSeekAfterStepPlayback({
			isPlaying: false,
			targetTime: 4,
			renderedTime: 4 - timelineFrameInterval * 0.49,
			timelineFrameInterval,
			observedFrameInterval: null,
			stalledDurationSeconds: null,
		});
		const shouldSeekWhenNoRenderedFrame = shouldSeekAfterStepPlayback({
			isPlaying: false,
			targetTime: 4,
			renderedTime: null,
			timelineFrameInterval,
			observedFrameInterval: null,
			stalledDurationSeconds: null,
		});
		expect(shouldSeek).toBe(true);
		expect(shouldNotSeek).toBe(false);
		expect(shouldSeekWhenNoRenderedFrame).toBe(true);
	});
});
