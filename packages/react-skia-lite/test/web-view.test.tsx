// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebView } from "../src/web";

class ResizeObserverMock {
	static callback: ResizeObserverCallback | null = null;
	static instances: ResizeObserverMock[] = [];
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();

	constructor(callback: ResizeObserverCallback) {
		ResizeObserverMock.callback = callback;
		ResizeObserverMock.instances.push(this);
	}
}

describe("WebView", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("ResizeObserver", ResizeObserverMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		ResizeObserverMock.callback = null;
		ResizeObserverMock.instances = [];
	});

	it("会在 ResizeObserver 触发时派发 layout 事件", () => {
		const onLayout = vi.fn();
		render(
			<WebView testId="surface" onLayout={onLayout}>
				content
			</WebView>,
		);
		const element = screen.getByTestId("surface");

		expect(ResizeObserverMock.instances[0]?.observe).toHaveBeenCalledWith(
			element,
		);

		act(() => {
			ResizeObserverMock.callback?.(
				[
					{
						target: element,
						contentRect: {
							left: 4,
							top: 8,
							width: 320,
							height: 180,
						},
					} as ResizeObserverEntry,
				],
				{} as ResizeObserver,
			);
			vi.runAllTimers();
		});

		expect(onLayout).toHaveBeenCalledWith(
			expect.objectContaining({
				currentTarget: element,
				target: element,
				nativeEvent: {
					layout: { x: 4, y: 8, width: 320, height: 180 },
				},
			}),
		);
	});
});
