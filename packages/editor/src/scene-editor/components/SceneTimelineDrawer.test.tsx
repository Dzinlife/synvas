// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneTimelineDrawer from "./SceneTimelineDrawer";

vi.mock("@/scene-editor/TimelineEditor", () => ({
	default: () => <div data-testid="timeline-editor" />,
}));

vi.mock("./ScenePlaybackControlBar", () => ({
	default: ({ onExitFocus }: { onExitFocus: () => void }) => (
		<button type="button" onClick={onExitFocus} data-testid="scene-playback-bar">
			exit
		</button>
	),
}));

afterEach(() => {
	cleanup();
});

describe("SceneTimelineDrawer", () => {
	it("渲染播放器与时间线", () => {
		render(<SceneTimelineDrawer onExitFocus={vi.fn()} />);
		expect(screen.getByTestId("scene-playback-bar")).toBeTruthy();
		expect(screen.getByTestId("timeline-editor")).toBeTruthy();
		expect(screen.getByLabelText("调整时间线高度")).toBeTruthy();
	});

	it("退出回调可触发", () => {
		const onExitFocus = vi.fn();
		render(<SceneTimelineDrawer onExitFocus={onExitFocus} />);
		fireEvent.click(screen.getAllByTestId("scene-playback-bar")[0]!);
		expect(onExitFocus).toHaveBeenCalledTimes(1);
	});

	it("可通过配置关闭 resize", () => {
		render(<SceneTimelineDrawer onExitFocus={vi.fn()} resizable={false} />);
		expect(screen.queryByLabelText("调整时间线高度")).toBeNull();
	});
});
