// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StudioProject } from "core/studio/types";
import {
	createEditorRuntimeWrapper,
	createTestEditorRuntime,
} from "@/editor/runtime/testUtils";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import { useSceneSessionBridge } from "./useSceneSessionBridge";

const BridgeMount = () => {
	useSceneSessionBridge();
	return null;
};

const runtime = createTestEditorRuntime("scene-session-bridge-test");
const timelineStore = runtime.timelineStore;
const wrapper = createEditorRuntimeWrapper(runtime);

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
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
				assets: [
					{
						id: "asset-1",
						uri: "file:///asset-1.png",
						kind: "image",
						name: "asset-1",
					},
				],
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
		focusedSceneId: null,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(),
		currentProjectData: null,
		focusedSceneDrafts: {},
		error: null,
	});
	useStudioHistoryStore.getState().clear();
	timelineStore.setState({
		elements: [],
		assets: [],
		tracks: [],
		timelineViewportWidth: 1280,
		timelineMaxScrollLeft: 4096,
		historyPast: [],
		historyFuture: [],
	});
});

afterEach(() => {
	cleanup();
});

describe("useSceneSessionBridge", () => {
	it("focus scene 时加载 timeline 到 timelineStore", async () => {
		render(<BridgeMount />, { wrapper });
		act(() => {
			useProjectStore.getState().setFocusedScene("scene-1");
		});
		await waitFor(() => {
			expect(timelineStore.getState().elements.length).toBe(1);
		});
		expect(timelineStore.getState().timelineViewportWidth).toBe(1280);
		expect(timelineStore.getState().timelineMaxScrollLeft).toBe(4096);
	});

	it("timeline 变更会回写 scene 并进入全局历史", async () => {
		render(<BridgeMount />, { wrapper });
		act(() => {
			useProjectStore.getState().setFocusedScene("scene-1");
		});
		await waitFor(() => {
			expect(timelineStore.getState().elements.length).toBe(1);
		});
		act(() => {
			timelineStore.getState().setElements((prev) => [
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
		expect(useStudioHistoryStore.getState().past.length).toBeGreaterThan(0);
		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements.length,
		).toBe(2);
	});
});
