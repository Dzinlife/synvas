// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/element/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import { createEditorRuntime } from "@/scene-editor/runtime/createEditorRuntime";
import { EditorRuntimeProvider } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { useSceneReferenceRuntimeState } from "./useSceneReferenceRuntimeState";

const createElement = (id: string, end: number): TimelineElement => ({
	id,
	type: "Image",
	component: "image",
	name: id,
	assetId: "asset-1",
	props: {},
	timeline: {
		start: 0,
		end,
		startTimecode: "",
		endTimecode: "",
		trackIndex: 0,
		role: "clip",
	},
});

const Probe = () => {
	const state = useSceneReferenceRuntimeState("scene-child");
	return (
		<div
			data-testid="probe"
			data-runtime={state.runtime?.ref.sceneId ?? ""}
			data-revision={String(state.revision)}
			data-fps={String(state.fps)}
			data-duration={String(state.durationFrames)}
			data-canvas={`${state.canvasSize.width}x${state.canvasSize.height}`}
		/>
	);
};

describe("useSceneReferenceRuntimeState", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		useProjectStore.setState({
			currentProject: null,
		});
	});

	it("相同 store 快照会复用结果并正常响应运行时更新", () => {
		const runtime = createEditorRuntime({
			id: "runtime-root",
		}) as EditorRuntime & StudioRuntimeManager;
		const sceneRuntime = runtime.ensureTimelineRuntime(
			toSceneTimelineRef("scene-child"),
		);
		act(() => {
			sceneRuntime.timelineStore.getState().setFps(24);
			sceneRuntime.timelineStore.getState().setCanvasSize({
				width: 1280,
				height: 720,
			});
			sceneRuntime.timelineStore
				.getState()
				.setElements([createElement("clip-a", 60)], { history: false });
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		render(
			<EditorRuntimeProvider runtime={runtime}>
				<Probe />
			</EditorRuntimeProvider>,
		);

		let probe = screen.getByTestId("probe");
		expect(probe.dataset.runtime).toBe("scene-child");
		expect(probe.dataset.fps).toBe("24");
		expect(probe.dataset.duration).toBe("60");
		expect(probe.dataset.canvas).toBe("1280x720");

		act(() => {
			sceneRuntime.timelineStore
				.getState()
				.setElements([createElement("clip-b", 90)], { history: false });
		});

		probe = screen.getByTestId("probe");
		expect(probe.dataset.duration).toBe("90");

		const loggedErrors = errorSpy.mock.calls.map((call) => call.join(" "));
		expect(
			loggedErrors.some((message) =>
				message.includes("The result of getSnapshot should be cached"),
			),
		).toBe(false);
		expect(
			loggedErrors.some((message) =>
				message.includes("Maximum update depth exceeded"),
			),
		).toBe(false);
	});
});
