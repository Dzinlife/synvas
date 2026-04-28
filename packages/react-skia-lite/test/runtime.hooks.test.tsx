// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	useAnimatedReaction,
	useDerivedValue,
	useSharedValue,
} from "../src/animation/runtime";
import type { SharedValue } from "../src/animation/runtime";
import { installRafStub } from "./testUtils";

const { flushFrame } = installRafStub();

describe("animation hooks", () => {
	it("updates derived values from shared values", () => {
		let source!: SharedValue<number>;
		let derived!: SharedValue<number>;

		const Harness = () => {
			source = useSharedValue(2);
			derived = useDerivedValue(() => source.value * 3);
			return null;
		};

		render(<Harness />);
		expect(derived.value).toBe(6);

		act(() => {
			source.value = 4;
			flushFrame(16);
		});

		expect(derived.value).toBe(12);
	});

	it("runs animated reactions with previous values", () => {
		let source!: SharedValue<number>;
		const values: Array<[number, number | null]> = [];

		const Harness = () => {
			source = useSharedValue(1);
			useAnimatedReaction(
				() => source.value * 2,
				(current, previous) => {
					values.push([current, previous]);
				},
			);
			return null;
		};

		render(<Harness />);

		act(() => {
			source.value = 5;
			flushFrame(16);
		});

		act(() => {
			source.value = 7;
			flushFrame(16);
		});

		expect(values).toEqual([
			[10, 2],
			[14, 10],
		]);
	});
});
