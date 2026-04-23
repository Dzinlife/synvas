// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { StudioProject } from "@/studio/project/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import {
	createEditorRuntimeWrapper,
	createTestEditorRuntime,
} from "@/scene-editor/runtime/testUtils";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import { useSceneSessionBridge } from "./useSceneSessionBridge";

const BridgeMount = () => {
	useSceneSessionBridge();
	return null;
};

const runtime = createTestEditorRuntime("scene-session-bridge-test");
const studioRuntime = runtime as EditorRuntime & StudioRuntimeManager;
const wrapper = createEditorRuntimeWrapper(runtime);

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-1",
			kind: "image",
			name: "asset-1",
			locator: {
				type: "linked-file",
				filePath: "/asset-1.png",
			},
			meta: {
				fileName: "asset-1.png",
			},
		},
	],
	canvas: { nodes: [] },
	scenes: {
		"scene-1": {
			id: "scene-1",
			name: "Scene 1",
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
				settings: {
					snapEnabled: true,
					autoAttach: true,
					rippleEditingEnabled: false,
					previewAxisEnabled: true,
					audio: {
						exportSampleRate: 48000,
						exportBlockSize: 512,
						masterGainDb: 0,
						compressor: {
							enabled: true,
							thresholdDb: -12,
							ratio: 4,
							kneeDb: 6,
							attackMs: 10,
							releaseMs: 80,
							makeupGainDb: 0,
						},
					},
				},
				tracks: [],
				elements: [
					{
						id: "element-1",
						type: "Image",
						component: "image",
						name: "Image",
						assetId: "asset-1",
						props: {},
						timeline: {
							start: 0,
							end: 30,
							startTimecode: "00:00:00:00",
							endTimecode: "00:00:01:00",
							trackIndex: 0,
							role: "clip",
						},
					},
				],
			},
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: null,
		activeNodeId: null,
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	for (const timelineRuntime of studioRuntime.listTimelineRuntimes()) {
		studioRuntime.removeTimelineRuntime(timelineRuntime.ref);
	}
	studioRuntime.setActiveEditTimeline(null);

	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(),
		focusedSceneDrafts: {},
		sceneTimelineMutationOpIds: {},
		error: null,
	});
	useStudioHistoryStore.getState().clear();
});

afterEach(() => {
	cleanup();
});

describe("useSceneSessionBridge", () => {
	it("active scene 会绑定 active runtime", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			const activeRuntime = studioRuntime.getActiveEditTimelineRuntime();
			expect(activeRuntime?.ref.sceneId).toBe("scene-1");
			expect(activeRuntime?.timelineStore.getState().elements.length).toBe(0);
		});
	});

	it("仅负责切换 active runtime，不采集历史", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			expect(studioRuntime.getActiveEditTimelineRuntime()).toBeTruthy();
		});

		act(() => {
			const activeTimelineStore =
				studioRuntime.getActiveEditTimelineRuntime()?.timelineStore;
			activeTimelineStore?.getState().setElements((prev) => [
				...prev,
				{
					id: "element-2",
					type: "Image",
					component: "image",
					name: "Image 2",
					assetId: "asset-1",
					props: {},
					timeline: {
						start: 30,
						end: 60,
						startTimecode: "00:00:01:00",
						endTimecode: "00:00:02:00",
						trackIndex: 0,
						role: "clip",
					},
				},
			]);
		});

		expect(useStudioHistoryStore.getState().past.length).toBe(0);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements.length,
		).toBe(1);
	});
});
