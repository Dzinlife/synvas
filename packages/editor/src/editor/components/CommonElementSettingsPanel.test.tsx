// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/dsl/transform";
import CommonElementSettingsPanel from "./CommonElementSettingsPanel";

const createElement = (
	partial: Partial<TimelineElement> = {},
): TimelineElement => ({
	id: "clip-1",
	type: "VideoClip",
	component: "video-clip",
	name: "Clip",
	transform: createTransformMeta({
		width: 1920,
		height: 1080,
		positionX: 960,
		positionY: 540,
	}),
	timeline: {
		start: 0,
		end: 60,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:02:00",
		trackIndex: 0,
		trackId: "main",
		role: "clip",
	},
	render: {
		visible: true,
		opacity: 1,
		zIndex: 0,
	},
	props: {},
	...partial,
});

afterEach(() => {
	cleanup();
});

describe("CommonElementSettingsPanel", () => {
	it("渲染 render 缺省值回退", () => {
		const element = createElement({ render: undefined });
		const updateElement = vi.fn();
		render(
			<CommonElementSettingsPanel element={element} updateElement={updateElement} />,
		);

		const visibleInput = screen.getByLabelText("Visible") as HTMLInputElement;
		const opacityInput = screen.getByLabelText("Opacity") as HTMLInputElement;

		expect(visibleInput.checked).toBe(true);
		expect(Number(opacityInput.value)).toBe(1);
	});

	it("实时更新并对 anchor 与 opacity 做 clamp", () => {
		let latest = createElement();
		const updateElement = vi.fn(
			(updater: (element: TimelineElement) => TimelineElement) => {
				latest = updater(latest);
			},
		);

		render(
			<CommonElementSettingsPanel element={latest} updateElement={updateElement} />,
		);

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "New Name" },
		});
		expect(latest.name).toBe("New Name");

		fireEvent.change(screen.getByLabelText("Anchor X"), {
			target: { value: "2" },
		});
		expect(latest.transform?.anchor.x).toBe(1);

		fireEvent.change(screen.getByLabelText("Opacity"), {
			target: { value: "-1" },
		});
		expect(latest.render?.opacity).toBe(0);

		fireEvent.click(screen.getByLabelText("Visible"));
		expect(latest.render?.visible).toBe(false);
	});

	it("无 transform 时禁用 transform 控件", () => {
		const element = createElement({
			type: "AudioClip",
			component: "audio-clip",
			transform: undefined,
		});

		render(
			<CommonElementSettingsPanel element={element} updateElement={vi.fn()} />,
		);

		const positionInput = screen.getByLabelText("Position X") as HTMLInputElement;
		expect(positionInput.disabled).toBe(true);
		expect(screen.queryByText("当前元素不包含 Transform 数据。")).not.toBeNull();
		expect(
			screen.queryByText("当前类型可能无可视效果，Transform 仅保存数据。"),
		).not.toBeNull();
	});
});
