// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewLoudnessSnapshot } from "@/audio/engine";
import PreviewLoudnessMeterCanvas from "./PreviewLoudnessMeterCanvas";

const createSilentSnapshot = (): PreviewLoudnessSnapshot => ({
	leftRms: 0,
	rightRms: 0,
	leftPeak: 0,
	rightPeak: 0,
	updatedAtMs: 0,
});

const { snapshotState, listeners } = vi.hoisted(() => ({
	snapshotState: {
		value: {
			leftRms: 0,
			rightRms: 0,
			leftPeak: 0,
			rightPeak: 0,
			updatedAtMs: 0,
		},
	},
	listeners: new Set<(snapshot: PreviewLoudnessSnapshot) => void>(),
}));

vi.mock("@/audio/engine", () => ({
	getPreviewLoudnessSnapshot: () => snapshotState.value,
	subscribePreviewLoudness: (
		listener: (snapshot: PreviewLoudnessSnapshot) => void,
	) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
}));

const emitSnapshot = (snapshot: PreviewLoudnessSnapshot) => {
	snapshotState.value = snapshot;
	for (const listener of listeners) {
		listener(snapshot);
	}
};

describe("PreviewLoudnessMeterCanvas", () => {
	let rafCallbacks: Map<number, FrameRequestCallback>;

	beforeEach(() => {
		snapshotState.value = createSilentSnapshot();
		listeners.clear();
		rafCallbacks = new Map<number, FrameRequestCallback>();
		let rafId = 1;
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			const nextId = rafId;
			rafId += 1;
			rafCallbacks.set(nextId, callback);
			return nextId;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => {
			rafCallbacks.delete(id);
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("静默状态下不会启动 RAF 循环", () => {
		render(<PreviewLoudnessMeterCanvas />);
		expect(rafCallbacks.size).toBe(0);
	});

	it("收到有效音量信号时会启动 RAF 渲染", () => {
		render(<PreviewLoudnessMeterCanvas />);

		act(() => {
			emitSnapshot({
				leftRms: 0.25,
				rightRms: 0.2,
				leftPeak: 0.4,
				rightPeak: 0.35,
				updatedAtMs: 1,
			});
		});

		expect(rafCallbacks.size).toBe(1);
	});

	it("inactive 时收到音量信号也不会启动 RAF", () => {
		render(<PreviewLoudnessMeterCanvas active={false} />);

		act(() => {
			emitSnapshot({
				leftRms: 0.25,
				rightRms: 0.2,
				leftPeak: 0.4,
				rightPeak: 0.35,
				updatedAtMs: 1,
			});
		});

		expect(rafCallbacks.size).toBe(0);
	});
});
