// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ViewportHost from "./ViewportHost";

const studioState = {
	activeMainView: "preview" as "preview" | "canvas",
};

let timelineMountCount = 0;
let timelineUnmountCount = 0;

vi.mock("@/studio/studioStore", () => ({
	useStudioStore: (
		selector: (state: typeof studioState) => unknown,
	): unknown => selector(studioState),
}));

vi.mock("./PreviewEditor", () => ({
	default: () => <div data-testid="preview-editor" />,
}));

vi.mock("@/studio/canvas/CanvasWorkspace", () => ({
	default: () => <div data-testid="canvas-workspace" />,
}));

vi.mock("./components/EditorSidebars", () => ({
	default: () => <div data-testid="editor-sidebars" />,
}));

vi.mock("./components/PreviewControlBar", () => ({
	default: () => <div data-testid="preview-control-bar" />,
}));

vi.mock("./TimelineEditor", () => ({
	default: () => {
		ReactModule.useEffect(() => {
			timelineMountCount += 1;
			return () => {
				timelineUnmountCount += 1;
			};
		}, []);
		return <div data-testid="timeline-editor" />;
	},
}));

describe("ViewportHost", () => {
	beforeEach(() => {
		studioState.activeMainView = "preview";
		timelineMountCount = 0;
		timelineUnmountCount = 0;
	});

	it("切换主视图时 TimelineEditor 保持挂载", () => {
		const noop = vi.fn();
		const { rerender } = render(
			<ViewportHost timelineMaxHeight={320} onResizeMouseDown={noop} />,
		);

		expect(timelineMountCount).toBe(1);
		expect(screen.getByTestId("timeline-editor")).toBeTruthy();
		const previewRoot = screen
			.getByTestId("preview-editor")
			.closest("[data-main-view-preview]");
		expect(previewRoot?.getAttribute("data-active")).toBe("true");

		studioState.activeMainView = "canvas";
		rerender(<ViewportHost timelineMaxHeight={320} onResizeMouseDown={noop} />);

		expect(screen.getByTestId("timeline-editor")).toBeTruthy();
		expect(timelineMountCount).toBe(1);
		expect(timelineUnmountCount).toBe(0);
		const canvasRoot = screen
			.getByTestId("canvas-workspace")
			.closest("[data-main-view-canvas]");
		expect(canvasRoot?.getAttribute("data-active")).toBe("true");
	});
});
