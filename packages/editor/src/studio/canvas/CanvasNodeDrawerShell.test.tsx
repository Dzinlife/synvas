// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CanvasNodeDrawerShell from "./CanvasNodeDrawerShell";

const ORIGINAL_INNER_HEIGHT = window.innerHeight;

beforeEach(() => {
	Object.defineProperty(window, "innerHeight", {
		configurable: true,
		value: 1000,
	});
});

afterEach(() => {
	cleanup();
	Object.defineProperty(window, "innerHeight", {
		configurable: true,
		value: ORIGINAL_INNER_HEIGHT,
	});
});

describe("CanvasNodeDrawerShell", () => {
	it("resizable=false 时隐藏拖拽手柄并上报初始高度", async () => {
		const onHeightChange = vi.fn();
		render(
			<CanvasNodeDrawerShell
				resizable={false}
				defaultHeight={300}
				onHeightChange={onHeightChange}
			>
				<div>content</div>
			</CanvasNodeDrawerShell>,
		);
		expect(screen.queryByLabelText("调整 Drawer 高度")).toBeNull();
		await waitFor(() => {
			expect(onHeightChange).toHaveBeenCalledWith(300);
		});
	});

	it("resizable=true 时拖拽高度受 min/max 约束", async () => {
		const onHeightChange = vi.fn();
		render(
			<CanvasNodeDrawerShell
				resizable
				defaultHeight={320}
				minHeight={240}
				maxHeightRatio={0.5}
				onHeightChange={onHeightChange}
			>
				<div>content</div>
			</CanvasNodeDrawerShell>,
		);
		const handle = screen.getByLabelText("调整 Drawer 高度");

		fireEvent.mouseDown(handle, { clientY: 600 });
		fireEvent.mouseMove(document, { clientY: 200 });
		fireEvent.mouseUp(document);

		await waitFor(() => {
			expect(onHeightChange).toHaveBeenLastCalledWith(500);
		});

		fireEvent.mouseDown(handle, { clientY: 400 });
		fireEvent.mouseMove(document, { clientY: 1200 });
		fireEvent.mouseUp(document);

		await waitFor(() => {
			expect(onHeightChange).toHaveBeenLastCalledWith(240);
		});
	});
});
