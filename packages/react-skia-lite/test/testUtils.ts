import { afterEach, beforeEach, vi } from "vitest";

type FrameRequest = {
	callback: FrameRequestCallback;
	id: number;
};

export const installRafStub = () => {
	let now = 0;
	let nextId = 1;
	let queue: FrameRequest[] = [];

	beforeEach(() => {
		now = 0;
		nextId = 1;
		queue = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			const id = nextId++;
			queue.push({ callback, id });
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => {
			queue = queue.filter((entry) => entry.id !== id);
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		queue = [];
	});

	return {
		flushFrame(deltaMs = 16) {
			now += deltaMs;
			const pending = queue;
			queue = [];
			for (const frame of pending) {
				frame.callback(now);
			}
		},
		getQueueLength() {
			return queue.length;
		},
	};
};
