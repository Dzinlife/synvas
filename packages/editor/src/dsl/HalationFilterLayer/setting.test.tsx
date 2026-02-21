// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/dsl/transform";
import {
	HALATION_FILTER_DEFAULT_PROPS,
	type HalationFilterLayerProps,
} from "./model";
import { HalationFilterLayerSetting } from "./setting";

vi.mock("@/components/ui/dial-slider", () => ({
	DialSlider: ({
		label,
		value,
		onChange,
	}: {
		label: string;
		value: number;
		onChange: (value: number) => void;
	}) => (
		<input
			aria-label={label}
			value={String(value)}
			onChange={(event) => {
				onChange(Number(event.target.value));
			}}
		/>
	),
}));

const createHalationElement = (
	props: HalationFilterLayerProps = {},
): TimelineElement<HalationFilterLayerProps> => {
	return {
		id: "halation-1",
		type: "Filter",
		component: "filter/halation",
		name: "Halation",
		transform: createTransformMeta({
			width: 320,
			height: 180,
			positionX: 160,
			positionY: 90,
		}),
		timeline: {
			start: 0,
			end: 30,
			startTimecode: "00:00:00:00",
			endTimecode: "00:00:01:00",
			trackIndex: 1,
			trackId: "track-1",
			role: "effect",
		},
		render: {
			opacity: 1,
			visible: true,
			zIndex: 0,
		},
		props,
	};
};

afterEach(() => {
	cleanup();
});

describe("HalationFilterLayerSetting", () => {
	it("renders default values when props are missing", () => {
		render(
			<HalationFilterLayerSetting
				element={createHalationElement()}
				updateProps={() => {}}
			/>,
		);

		const intensityInput = screen.getByLabelText("Intensity") as HTMLInputElement;
		const thresholdInput = screen.getByLabelText("Threshold") as HTMLInputElement;
		const chromaticShiftInput = screen.getByLabelText(
			"Chromatic Shift",
		) as HTMLInputElement;

		expect(Number(intensityInput.value)).toBeCloseTo(
			HALATION_FILTER_DEFAULT_PROPS.intensity,
		);
		expect(Number(thresholdInput.value)).toBeCloseTo(
			HALATION_FILTER_DEFAULT_PROPS.threshold,
		);
		expect(Number(chromaticShiftInput.value)).toBeCloseTo(
			HALATION_FILTER_DEFAULT_PROPS.chromaticShift,
		);
	});

	it("clamps number values before update", () => {
		const updateProps = vi.fn();
		render(
			<HalationFilterLayerSetting
				element={createHalationElement()}
				updateProps={updateProps}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Intensity"), {
			target: { value: "10" },
		});
		fireEvent.change(screen.getByLabelText("Threshold"), {
			target: { value: "-1" },
		});

		expect(updateProps).toHaveBeenNthCalledWith(1, { intensity: 2 });
		expect(updateProps).toHaveBeenNthCalledWith(2, { threshold: 0 });
	});

	it("updates radius by user input", () => {
		const updateProps = vi.fn();
		render(
			<HalationFilterLayerSetting
				element={createHalationElement()}
				updateProps={updateProps}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Radius"), {
			target: { value: "12.5" },
		});
		expect(updateProps).toHaveBeenCalledWith({ radius: 12.5 });
	});
});
