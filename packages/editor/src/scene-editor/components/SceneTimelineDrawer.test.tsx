// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneTimelineDrawer from "./SceneTimelineDrawer";

const timelineEditorPropsSpy = vi.fn();

vi.mock("@/scene-editor/TimelineEditor", () => ({
	default: (props: unknown) => {
		timelineEditorPropsSpy(props);
		return <div data-testid="timeline-editor" />;
	},
}));

afterEach(() => {
	cleanup();
	timelineEditorPropsSpy.mockReset();
});

describe("SceneTimelineDrawer", () => {
	it("渲染时间线", () => {
		render(<SceneTimelineDrawer onExitFocus={vi.fn()} />);
		expect(screen.getByTestId("timeline-editor")).toBeTruthy();
		expect(screen.getByLabelText("调整时间线高度")).toBeTruthy();
	});

	it("可通过配置关闭 resize", () => {
		render(<SceneTimelineDrawer onExitFocus={vi.fn()} resizable={false} />);
		expect(screen.queryByLabelText("调整时间线高度")).toBeNull();
	});

	it("会把 restore scene 引用回调透传给 TimelineEditor", () => {
		const onRestoreSceneReferenceToCanvas = vi.fn();
		render(
			<SceneTimelineDrawer
				onExitFocus={vi.fn()}
				onRestoreSceneReferenceToCanvas={onRestoreSceneReferenceToCanvas}
			/>,
		);
		expect(timelineEditorPropsSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				onRestoreSceneReferenceToCanvas,
			}),
		);
	});
});
