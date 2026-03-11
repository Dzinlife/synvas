import { describe, expect, it, vi } from "vitest";
import {
	Easing,
	cancelAnimation,
	makeMutable,
	withSpring,
	withTiming,
} from "../src/animation/runtime";
import { installRafStub } from "./testUtils";

const { flushFrame } = installRafStub();

describe("animation runtime", () => {
	it("supports immediate assignment and listener lifecycle", () => {
		const shared = makeMutable(1);
		const values: number[] = [];

		shared.addListener?.(1, (value) => {
			values.push(value);
		});

		shared.value = 2;
		expect(shared.value).toBe(2);
		expect(values).toEqual([]);

		flushFrame();
		expect(values).toEqual([2]);

		shared.removeListener?.(1);
		shared.value = 3;
		flushFrame();
		expect(values).toEqual([2]);
	});

	it("runs timing animations and completes with callback", () => {
		const shared = makeMutable(0);
		const callback = vi.fn();

		shared.value = withTiming(10, { duration: 32, easing: Easing.linear }, callback);

		flushFrame(16);
		expect(shared.value).toBeGreaterThanOrEqual(0);
		expect(shared.value).toBeLessThan(10);

		flushFrame(16);
		flushFrame(16);
		expect(shared.value).toBeCloseTo(10, 5);
		expect(callback).toHaveBeenCalledWith(true, 10);
	});

	it("cancels timing animations", () => {
		const shared = makeMutable(0);
		const callback = vi.fn();

		shared.value = withTiming(10, { duration: 100, easing: Easing.linear }, callback);
		flushFrame(16);

		cancelAnimation(shared);
		expect(callback).toHaveBeenCalledWith(false, shared.value);

		const valueAfterCancel = shared.value;
		flushFrame(16);
		expect(shared.value).toBe(valueAfterCancel);
	});

	it("converges spring animations", () => {
		const shared = makeMutable(0);
		const callback = vi.fn();

		shared.value = withSpring(
			10,
			{
				stiffness: 220,
				damping: 28,
				restDisplacementThreshold: 0.0001,
				restSpeedThreshold: 0.0001,
			},
			callback,
		);

		for (let index = 0; index < 120; index += 1) {
			flushFrame(16);
		}

		expect(shared.value).toBeCloseTo(10, 2);
		expect(callback).toHaveBeenCalledWith(true, expect.any(Number));
	});

	it("animates colors through normalized intermediate values", () => {
		const shared = makeMutable("#ff0000");

		shared.value = withTiming("#00ff00", {
			duration: 32,
			easing: Easing.linear,
		});

		flushFrame(16);
		expect(typeof shared.value).toBe("string");
		expect(String(shared.value)).toContain("rgba(");

		flushFrame(16);
		flushFrame(16);
		expect(shared.value).toBe("rgba(0, 255, 0, 1)");
	});

	it("animates object values", () => {
		const shared = makeMutable({
			x: 0,
			y: 0,
			width: 10,
			height: 20,
		});

		shared.value = withTiming(
			{
				x: 10,
				y: 5,
				width: 30,
				height: 40,
			},
			{ duration: 32, easing: Easing.linear },
		);

		flushFrame(16);
		flushFrame(16);
		flushFrame(16);

		expect(shared.value).toEqual({
			x: 10,
			y: 5,
			width: 30,
			height: 40,
		});
	});

	it("animates transform arrays with stable shape", () => {
		const shared = makeMutable([{ translateX: 0 }, { scale: 1 }]);

		shared.value = withTiming(
			[{ translateX: 12 }, { scale: 2 }],
			{ duration: 32, easing: Easing.linear },
		);

		flushFrame(16);
		flushFrame(16);
		flushFrame(16);

		expect(shared.value).toEqual([{ translateX: 12 }, { scale: 2 }]);
	});

	it("falls back to immediate assignment for incompatible shapes", () => {
		const shared = makeMutable({ x: 0, y: 0 });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const callback = vi.fn();

		shared.value = withTiming({ x: 10 }, { duration: 32 }, callback);

		expect(shared.value).toEqual({ x: 10 });
		expect(callback).toHaveBeenCalledWith(true, { x: 10 });
		expect(warn).toHaveBeenCalledOnce();
	});
});
