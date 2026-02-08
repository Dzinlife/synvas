// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "@/dsl/types";
import {
	HALATION_FILTER_DEFAULT_PROPS,
	type HalationFilterLayerProps,
} from "./model";
import { HalationFilterLayerSetting } from "./setting";

const createHalationElement = (
	props: HalationFilterLayerProps = {},
): TimelineElement<HalationFilterLayerProps> => {
	return {
		id: "halation-1",
		type: "Filter",
		component: "filter/halation",
		name: "Halation",
		transform: {
			centerX: 0,
			centerY: 0,
			width: 320,
			height: 180,
			rotation: 0,
		},
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

		const intensityInput = screen.getByLabelText(
			"Intensity input",
		) as HTMLInputElement;
		const thresholdInput = screen.getByLabelText(
			"Threshold input",
		) as HTMLInputElement;
		const chromaticShiftInput = screen.getByLabelText(
			"Chromatic Shift input",
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
		expect(screen.queryByLabelText("Corner Radius input")).not.toBeNull();
	});

	it("clamps number input values before update", () => {
		const updateProps = vi.fn();
		render(
			<HalationFilterLayerSetting
				element={createHalationElement()}
				updateProps={updateProps}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Intensity input"), {
			target: { value: "10" },
		});
		fireEvent.change(screen.getByLabelText("Threshold input"), {
			target: { value: "-1" },
		});

		expect(updateProps).toHaveBeenNthCalledWith(1, { intensity: 2 });
		expect(updateProps).toHaveBeenNthCalledWith(2, { threshold: 0 });
	});

	it("hides corner radius control when shape is circle", () => {
		const updateProps = vi.fn();
		const { rerender } = render(
			<HalationFilterLayerSetting
				element={createHalationElement({ shape: "rect" })}
				updateProps={updateProps}
			/>,
		);

		expect(screen.queryByLabelText("Corner Radius input")).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Circle" }));
		expect(updateProps).toHaveBeenCalledWith({ shape: "circle" });

		rerender(
			<HalationFilterLayerSetting
				element={createHalationElement({ shape: "circle" })}
				updateProps={updateProps}
			/>,
		);

		expect(screen.queryByLabelText("Corner Radius input")).toBeNull();
	});
});
