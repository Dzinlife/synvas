// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ViewportHost from "./ViewportHost";

vi.mock("@/studio/canvas/CanvasWorkspace", () => ({
	default: () => <div data-testid="canvas-workspace" />,
}));

describe("ViewportHost", () => {
	it("主视图固定渲染 CanvasWorkspace", () => {
		render(<ViewportHost />);
		expect(screen.getByTestId("canvas-workspace")).toBeTruthy();
	});
});
