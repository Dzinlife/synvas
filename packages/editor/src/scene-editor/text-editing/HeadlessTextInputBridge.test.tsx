// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadlessTextInputBridge } from "./HeadlessTextInputBridge";

const createBaseProps = () => {
	return {
		sessionId: "session-a",
		value: "hello",
		selection: {
			start: 5,
			end: 5,
			direction: "none" as const,
		},
		overlayRect: {
			x: 0,
			y: 0,
			width: 120,
			height: 40,
		},
		isComposing: false,
		onValueChange: vi.fn(),
		onSelectionChange: vi.fn(),
		onCompositionStart: vi.fn(),
		onCompositionUpdate: vi.fn(),
		onCompositionEnd: vi.fn(),
		onCommit: vi.fn(),
		onCancel: vi.fn(),
		onBlur: vi.fn(),
	};
};

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("HeadlessTextInputBridge", () => {
	it("覆盖区内 pointer 导致的 blur 不会触发 commit", () => {
		vi.useFakeTimers();
		const props = createBaseProps();
		const { container } = render(<HeadlessTextInputBridge {...props} />);
		const textarea = container.querySelector("textarea");
		expect(textarea).toBeTruthy();
		if (!textarea) return;
		vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			width: 120,
			height: 40,
			top: 0,
			left: 0,
			right: 120,
			bottom: 40,
			toJSON: () => "",
		});

		window.dispatchEvent(
			new PointerEvent("pointerdown", {
				clientX: 24,
				clientY: 16,
			}),
		);
		fireEvent.blur(textarea);
		vi.runAllTimers();

		expect(props.onBlur).not.toHaveBeenCalled();
	});

	it("覆盖区外 pointer 导致的 blur 会触发 commit", () => {
		const props = createBaseProps();
		const { container } = render(<HeadlessTextInputBridge {...props} />);
		const textarea = container.querySelector("textarea");
		expect(textarea).toBeTruthy();
		if (!textarea) return;
		vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			width: 120,
			height: 40,
			top: 0,
			left: 0,
			right: 120,
			bottom: 40,
			toJSON: () => "",
		});

		window.dispatchEvent(
			new PointerEvent("pointerdown", {
				clientX: 240,
				clientY: 120,
			}),
		);
		fireEvent.blur(textarea);

		expect(props.onBlur).toHaveBeenCalledTimes(1);
	});
});
