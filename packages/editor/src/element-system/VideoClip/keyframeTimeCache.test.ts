import type { Input } from "mediabunny";
import { afterEach, describe, expect, it, vi } from "vitest";

const keyframeMocks = vi.hoisted(() => ({
	packetSinkCtor: vi.fn(),
	getKeyPacket: vi.fn(),
}));

vi.mock("mediabunny", () => {
	class EncodedPacketSink {
		constructor(track: unknown) {
			keyframeMocks.packetSinkCtor(track);
		}

		getKeyPacket(timestamp: number) {
			return keyframeMocks.getKeyPacket(timestamp);
		}
	}

	return {
		EncodedPacketSink,
	};
});

import {
	__resetVideoKeyframeTimeCacheForTests,
	resolveVideoKeyframeTime,
} from "./keyframeTimeCache";

const createDeferred = <T>() => {
	let resolveInner: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		resolveInner = resolve;
	});
	return {
		promise,
		resolve: (value: T) => {
			if (!resolveInner) {
				throw new Error("Deferred resolver is not ready");
			}
			resolveInner(value);
		},
	};
};

const createInput = (track: unknown): Input => {
	return {
		getPrimaryVideoTrack: vi.fn().mockResolvedValue(track),
	} as unknown as Input;
};

describe("keyframeTimeCache", () => {
	afterEach(() => {
		__resetVideoKeyframeTimeCacheForTests();
		keyframeMocks.packetSinkCtor.mockReset();
		keyframeMocks.getKeyPacket.mockReset();
	});

	it("相同 uri 与 timeKey 会命中缓存，不重复请求关键帧", async () => {
		const input = createInput({ id: "track-1" });
		keyframeMocks.getKeyPacket.mockResolvedValue({ timestamp: 2.4 });

		const first = await resolveVideoKeyframeTime({
			uri: "demo.mp4",
			input,
			time: 2.5,
			timeKey: 2500,
		});
		const second = await resolveVideoKeyframeTime({
			uri: "demo.mp4",
			input,
			time: 2.5,
			timeKey: 2500,
		});

		expect(first).toBe(2.4);
		expect(second).toBe(2.4);
		expect(keyframeMocks.packetSinkCtor).toHaveBeenCalledTimes(1);
		expect(keyframeMocks.getKeyPacket).toHaveBeenCalledTimes(1);
	});

	it("相同 key 并发请求会复用 inflight promise", async () => {
		const input = createInput({ id: "track-2" });
		const packetDeferred = createDeferred<{ timestamp: number }>();
		keyframeMocks.getKeyPacket.mockReturnValue(packetDeferred.promise);

		const p1 = resolveVideoKeyframeTime({
			uri: "demo.mp4",
			input,
			time: 8.0,
			timeKey: 8000,
		});
		const p2 = resolveVideoKeyframeTime({
			uri: "demo.mp4",
			input,
			time: 8.0,
			timeKey: 8000,
		});

		await Promise.resolve();
		expect(keyframeMocks.getKeyPacket).toHaveBeenCalledTimes(1);
		packetDeferred.resolve({ timestamp: 7.9 });

		await expect(p1).resolves.toBe(7.9);
		await expect(p2).resolves.toBe(7.9);
	});

	it("同 uri 但 input 变化时会隔离缓存", async () => {
		const inputA = createInput({ id: "track-a" });
		const inputB = createInput({ id: "track-b" });
		keyframeMocks.getKeyPacket
			.mockResolvedValueOnce({ timestamp: 1.1 })
			.mockResolvedValueOnce({ timestamp: 1.2 });

		const first = await resolveVideoKeyframeTime({
			uri: "same.mp4",
			input: inputA,
			time: 1.5,
			timeKey: 1500,
		});
		const second = await resolveVideoKeyframeTime({
			uri: "same.mp4",
			input: inputB,
			time: 1.5,
			timeKey: 1500,
		});

		expect(first).toBe(1.1);
		expect(second).toBe(1.2);
		expect(keyframeMocks.packetSinkCtor).toHaveBeenCalledTimes(2);
		expect(keyframeMocks.getKeyPacket).toHaveBeenCalledTimes(2);
	});
});
