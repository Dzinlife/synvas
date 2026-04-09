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

	it("Cmd+Arrow 导航会在 keydown 后立即同步 selection", () => {
		vi.useFakeTimers();
		const props = createBaseProps();
		const { container } = render(<HeadlessTextInputBridge {...props} />);
		const textarea = container.querySelector("textarea");
		expect(textarea).toBeTruthy();
		if (!textarea) return;
		textarea.setSelectionRange(5, 5);
		fireEvent.keyDown(textarea, {
			key: "ArrowLeft",
			metaKey: true,
		});
		textarea.setSelectionRange(0, 0);
		vi.runAllTimers();
		expect(props.onSelectionChange).toHaveBeenCalledWith({
			start: 0,
			end: 0,
			direction: "none",
		});
	});

	it("逆向选区同步到 textarea 时不会被折叠", () => {
		const props = createBaseProps();
		const { container } = render(
			<HeadlessTextInputBridge
				{...props}
				selection={{
					start: 4,
					end: 1,
					direction: "backward",
				}}
			/>,
		);
		const textarea = container.querySelector("textarea");
		expect(textarea).toBeTruthy();
		if (!textarea) return;
		expect(textarea.selectionStart).toBe(1);
		expect(textarea.selectionEnd).toBe(4);
	});

	it("从 textarea 读取 backward 选区会还原为内部逆向选区", () => {
		const props = createBaseProps();
		const { container } = render(<HeadlessTextInputBridge {...props} />);
		const textarea = container.querySelector("textarea");
		expect(textarea).toBeTruthy();
		if (!textarea) return;

		Object.defineProperty(textarea, "selectionStart", {
			configurable: true,
			get: () => 1,
		});
		Object.defineProperty(textarea, "selectionEnd", {
			configurable: true,
			get: () => 4,
		});
		Object.defineProperty(textarea, "selectionDirection", {
			configurable: true,
			get: () => "backward",
		});

		fireEvent.select(textarea);
		expect(props.onSelectionChange).toHaveBeenCalledWith({
			start: 4,
			end: 1,
			direction: "backward",
		});
	});
});
