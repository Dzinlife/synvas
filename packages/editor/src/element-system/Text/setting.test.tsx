// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/timeline-system/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/element-system/transform";
import type { TextProps } from "./model";
import { TextSetting } from "./setting";

const createTextElement = (
	props: Partial<TextProps> = {},
): TimelineElement<TextProps> => {
	return {
		id: "text-1",
		type: "Text",
		component: "text",
		name: "Text",
		transform: createTransformMeta({
			width: 500,
			height: 160,
			positionX: 0,
			positionY: 0,
		}),
		timeline: {
			start: 0,
			end: 150,
			startTimecode: "00:00:00:00",
			endTimecode: "00:00:05:00",
			trackIndex: 1,
			trackId: "overlay-1",
			role: "overlay",
		},
		render: {
			zIndex: 2,
			visible: true,
			opacity: 1,
		},
		props: {
			text: "新建文本",
			fontSize: 48,
			color: "#ffffff",
			textAlign: "left",
			lineHeight: 1.2,
			...props,
		},
	};
};

afterEach(() => {
	cleanup();
});

describe("TextSetting", () => {
	it("编辑文本内容会更新 props", () => {
		const updateProps = vi.fn();
		render(
			<TextSetting element={createTextElement()} updateProps={updateProps} />,
		);

		fireEvent.change(screen.getByLabelText("Content"), {
			target: { value: "Hello Timeline" },
		});

		expect(updateProps).toHaveBeenCalledWith({ text: "Hello Timeline" });
	});

	it("编辑字号/颜色/对齐/行高会更新 props", () => {
		const updateProps = vi.fn();
		render(
			<TextSetting
				element={createTextElement({
					fontSize: 36,
					color: "#112233",
					textAlign: "center",
					lineHeight: 1.4,
				})}
				updateProps={updateProps}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Font Size"), {
			target: { value: "64" },
		});
		fireEvent.change(screen.getByLabelText("Color"), {
			target: { value: "#ffffff" },
		});
		fireEvent.change(screen.getByLabelText("Align"), {
			target: { value: "right" },
		});
		fireEvent.change(screen.getByLabelText("Line Height"), {
			target: { value: "1.8" },
		});

		expect(updateProps).toHaveBeenCalledWith({ fontSize: 64 });
		expect(updateProps).toHaveBeenCalledWith({ color: "#ffffff" });
		expect(updateProps).toHaveBeenCalledWith({ textAlign: "right" });
		expect(updateProps).toHaveBeenCalledWith({ lineHeight: 1.8 });
	});
});
