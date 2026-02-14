// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScrubbableNumberInput } from "./scrubbable-number-input";

describe("ScrubbableNumberInput", () => {
	it("渲染标签与当前值", () => {
		render(
			<ScrubbableNumberInput
				ariaLabel="Position X"
				label="X"
				value={548}
				onValueChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("X")).not.toBeNull();
		expect(screen.getByLabelText("Position X drag handle")).not.toBeNull();
		const input = screen.getByLabelText("Position X") as HTMLInputElement;
		expect(input.value).toBe("548");
	});

	it("拖拽命中区域包含左右内边距", () => {
		render(
			<ScrubbableNumberInput
				ariaLabel="Position Padding"
				label="P"
				value={0}
				onValueChange={vi.fn()}
			/>,
		);

		const dragHandle = screen.getByLabelText("Position Padding drag handle");
		expect(dragHandle.className).toContain("pl-3");
		expect(dragHandle.className).toContain("pr-3");
	});

	it("输入文本时不立即触发回调，blur 时提交", () => {
		const onValueChange = vi.fn();
		render(
			<ScrubbableNumberInput
				ariaLabel="Opacity"
				label="%"
				value={10}
				onValueChange={onValueChange}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Opacity"), {
			target: { value: "12" },
		});
		expect(onValueChange).toHaveBeenCalledTimes(0);
		fireEvent.blur(screen.getByLabelText("Opacity"));
		expect(onValueChange).toHaveBeenCalledWith(12);
	});

	it("输入文本按 Enter 时提交", () => {
		const onValueChange = vi.fn();
		render(
			<ScrubbableNumberInput
				ariaLabel="Rotation"
				label="R"
				value={10}
				onValueChange={onValueChange}
			/>,
		);

		const input = screen.getByLabelText("Rotation");
		(input as HTMLInputElement).focus();
		fireEvent.change(input, {
			target: { value: "12.5" },
		});
		expect(onValueChange).toHaveBeenCalledTimes(0);
		fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
		expect(onValueChange).toHaveBeenCalledWith(12.5);
	});

	it("支持格式化 value 文本", () => {
		render(
			<ScrubbableNumberInput
				ariaLabel="Rotation Format"
				label="R"
				value={12}
				format={{
					style: "unit",
					unit: "degree",
					unitDisplay: "narrow",
				}}
				onValueChange={vi.fn()}
			/>,
		);

		const input = screen.getByLabelText("Rotation Format") as HTMLInputElement;
		expect(input.value).toContain("°");
	});

	it("拖拽标签时触发步进更新", () => {
		const onValueChange = vi.fn();
		render(
			<ScrubbableNumberInput
				ariaLabel="Position Y"
				label="Y"
				value={10}
				step={1}
				pixelSensitivity={2}
				onValueChange={onValueChange}
			/>,
		);

		const dragHandle = screen.getByLabelText("Position Y drag handle");
		fireEvent.pointerDown(dragHandle, {
			button: 0,
			clientX: 100,
			pointerId: 1,
		});
		fireEvent.pointerMove(dragHandle, { clientX: 104, pointerId: 1 });
		fireEvent.pointerUp(dragHandle, { pointerId: 1 });

		expect(onValueChange).toHaveBeenCalledWith(12);
	});

	it("拖拽变更时只触发一次 scrub 生命周期回调", () => {
		const onScrubStart = vi.fn();
		const onScrubEnd = vi.fn();
		render(
			<ScrubbableNumberInput
				ariaLabel="Position L"
				label="L"
				value={10}
				step={1}
				pixelSensitivity={2}
				onValueChange={vi.fn()}
				onScrubStart={onScrubStart}
				onScrubEnd={onScrubEnd}
			/>,
		);

		const dragHandle = screen.getByLabelText("Position L drag handle");
		fireEvent.pointerDown(dragHandle, {
			button: 0,
			clientX: 100,
			pointerId: 1,
		});
		fireEvent.pointerMove(dragHandle, { clientX: 102, pointerId: 1 });
		fireEvent.pointerMove(dragHandle, { clientX: 106, pointerId: 1 });
		fireEvent.pointerUp(dragHandle, { pointerId: 1 });

		expect(onScrubStart).toHaveBeenCalledTimes(1);
		expect(onScrubEnd).toHaveBeenCalledTimes(1);
		expect(onScrubEnd).toHaveBeenCalledWith(true);
	});

	it("拖拽开始时聚焦输入框", () => {
		render(
			<ScrubbableNumberInput
				ariaLabel="Position Z"
				label="Z"
				value={10}
				onValueChange={vi.fn()}
			/>,
		);

		const input = screen.getByLabelText("Position Z") as HTMLInputElement;
		const dragHandle = screen.getByLabelText("Position Z drag handle");
		fireEvent.pointerDown(dragHandle, {
			button: 0,
			clientX: 100,
			pointerId: 1,
		});

		expect(document.activeElement).toBe(input);
	});

	it("如果 Scrub 前未聚焦，Scrub 结束后会 blur", () => {
		render(
			<ScrubbableNumberInput
				ariaLabel="Position W"
				label="W"
				value={10}
				onValueChange={vi.fn()}
			/>,
		);

		const input = screen.getByLabelText("Position W") as HTMLInputElement;
		const dragHandle = screen.getByLabelText("Position W drag handle");
		expect(document.activeElement).not.toBe(input);

		fireEvent.pointerDown(dragHandle, {
			button: 0,
			clientX: 100,
			pointerId: 1,
		});
		expect(document.activeElement).toBe(input);
		fireEvent.pointerUp(dragHandle, { pointerId: 1 });

		expect(document.activeElement).not.toBe(input);
	});

	it("如果 Scrub 前已聚焦，Scrub 结束后保持 focus", () => {
		render(
			<ScrubbableNumberInput
				ariaLabel="Position H"
				label="H"
				value={10}
				onValueChange={vi.fn()}
			/>,
		);

		const input = screen.getByLabelText("Position H") as HTMLInputElement;
		const dragHandle = screen.getByLabelText("Position H drag handle");
		input.focus();
		expect(document.activeElement).toBe(input);

		fireEvent.pointerDown(dragHandle, {
			button: 0,
			clientX: 100,
			pointerId: 1,
		});
		fireEvent.pointerUp(dragHandle, { pointerId: 1 });

		expect(document.activeElement).toBe(input);
	});

	it("禁用时不可编辑", () => {
		render(
			<ScrubbableNumberInput
				ariaLabel="Scale X"
				label="X"
				value={1}
				disabled
				onValueChange={vi.fn()}
			/>,
		);

		const input = screen.getByLabelText("Scale X") as HTMLInputElement;
		expect(input.disabled).toBe(true);
	});
});
