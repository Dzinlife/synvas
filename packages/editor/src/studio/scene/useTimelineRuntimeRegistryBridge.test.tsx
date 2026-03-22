// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { TimelineJSON } from "core/editor/timelineLoader";
import type { StudioProject } from "core/studio/types";
import { framesToTimecode } from "core/utils/timecode";
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
import { usePlaybackOwnerStore } from "./playbackOwnerStore";
import { toSceneTimelineRef } from "./timelineRefAdapter";
import { useTimelineRuntimeRegistryBridge } from "./useTimelineRuntimeRegistryBridge";

const BridgeMount = () => {
	useTimelineRuntimeRegistryBridge();
	return null;
};

const runtime = createTestEditorRuntime(
	"timeline-runtime-registry-bridge-test",
);
const studioRuntime = runtime as EditorRuntime & StudioRuntimeManager;
const wrapper = createEditorRuntimeWrapper(runtime);

const createTimeline = (
	sceneId: string,
	elementCount: number,
): TimelineJSON => ({
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
	elements: Array.from({ length: elementCount }).map((_, index) => {
		const start = index * 30;
		const end = start + 30;
		return {
			id: `${sceneId}-element-${index}`,
			type: "Image" as const,
			component: "image",
			name: `Image ${index}`,
			assetId: `asset-${sceneId}`,
			props: {},
			timeline: {
				start,
				end,
				startTimecode: framesToTimecode(start, 30),
				endTimecode: framesToTimecode(end, 30),
				trackIndex: 0,
				role: "clip" as const,
			},
		};
	}),
});

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-scene-1",
			kind: "image",
			name: "asset-scene-1",
			locator: {
				type: "linked-file",
				filePath: "/asset-scene-1.png",
			},
			meta: {
				fileName: "asset-scene-1.png",
			},
		},
		{
			id: "asset-scene-2",
			kind: "image",
			name: "asset-scene-2",
			locator: {
				type: "linked-file",
				filePath: "/asset-scene-2.png",
			},
			meta: {
				fileName: "asset-scene-2.png",
			},
		},
	],
	canvas: {
		nodes: [
			{
				id: "node-1",
				type: "scene",
				sceneId: "scene-1",
				name: "Scene 1",
				x: 0,
				y: 0,
				width: 960,
				height: 540,
				zIndex: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-2",
				type: "scene",
				sceneId: "scene-2",
				name: "Scene 2",
				x: 200,
				y: 200,
				width: 960,
				height: 540,
				zIndex: 1,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
		],
	},
	scenes: {
		"scene-1": {
			id: "scene-1",
			name: "Scene 1",
			timeline: createTimeline("scene-1", 1),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
		"scene-2": {
			id: "scene-2",
			name: "Scene 2",
			timeline: createTimeline("scene-2", 2),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: null,
		activeNodeId: "node-1",
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
	usePlaybackOwnerStore.getState().clearOwner();
	useStudioHistoryStore.getState().clear();

	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(),
		focusedSceneDrafts: {},
		sceneTimelineMutationOpIds: {},
		error: null,
	});
});

afterEach(() => {
	cleanup();
});

describe("useTimelineRuntimeRegistryBridge", () => {
	it("项目加载时会为全部 scene timeline 创建 runtime 并同步数据", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(2);
		});

		const scene1Runtime = studioRuntime.getTimelineRuntime(
			toSceneTimelineRef("scene-1"),
		);
		const scene2Runtime = studioRuntime.getTimelineRuntime(
			toSceneTimelineRef("scene-2"),
		);
		expect(scene1Runtime?.timelineStore.getState().elements).toHaveLength(1);
		expect(scene2Runtime?.timelineStore.getState().elements).toHaveLength(2);
	});

	it("runtime timeline 变更会回写 project scene timeline", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(2);
		});

		act(() => {
			const scene2Runtime = studioRuntime.getTimelineRuntime(
				toSceneTimelineRef("scene-2"),
			);
			scene2Runtime?.timelineStore
				.getState()
				.setElements((prev) => prev.slice(0, 1));
		});

		expect(
			useProjectStore.getState().currentProject?.scenes["scene-2"].timeline
				.elements.length,
		).toBe(1);
	});

	it("runtime 变更会同时回写 project 并入全局历史", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(2);
		});

		act(() => {
			const scene1Runtime = studioRuntime.getTimelineRuntime(
				toSceneTimelineRef("scene-1"),
			);
			scene1Runtime?.timelineStore.getState().setElements((prev) => [
				...prev,
				{
					id: "scene-1-element-extra",
					type: "Image",
					component: "image",
					name: "Image extra",
					assetId: "asset-scene-1",
					props: {},
					timeline: {
						start: 60,
						end: 90,
						startTimecode: framesToTimecode(60, 30),
						endTimecode: framesToTimecode(90, 30),
						trackIndex: 0,
						role: "clip",
					},
				},
			]);
		});

		expect(
			useProjectStore.getState().currentProject?.scenes["scene-1"].timeline
				.elements.length,
		).toBe(2);
		expect(useStudioHistoryStore.getState().past.length).toBeGreaterThan(0);
	});

	it("两个 runtime 使用相同 txnId 提交时，历史按命令级分别记录", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(2);
		});

		act(() => {
			const scene1Runtime = studioRuntime.getTimelineRuntime(
				toSceneTimelineRef("scene-1"),
			);
			scene1Runtime?.timelineStore
				.getState()
				.setElements((prev) => prev.slice(0, 0), {
					txnId: "shared-op-id",
				});
		});

		act(() => {
			const scene2Runtime = studioRuntime.getTimelineRuntime(
				toSceneTimelineRef("scene-2"),
			);
			scene2Runtime?.timelineStore
				.getState()
				.setElements((prev) => prev.slice(0, 1), {
					txnId: "shared-op-id",
				});
		});

		await waitFor(() => {
			expect(useStudioHistoryStore.getState().past).toHaveLength(2);
		});
		expect(useStudioHistoryStore.getState().past[0]?.kind).toBe("timeline.ot");
		expect(useStudioHistoryStore.getState().past[1]?.kind).toBe("timeline.ot");
	});

	it("scene 增删时会维护 runtime 池", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(2);
		});

		act(() => {
			useProjectStore
				.getState()
				.removeSceneGraphForHistory("scene-2", "node-2");
		});

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(1);
		});

		const scene2 = {
			id: "scene-2",
			name: "Scene 2",
			timeline: createTimeline("scene-2", 2),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		};
		const node2 = {
			id: "node-2",
			type: "scene" as const,
			sceneId: "scene-2",
			name: "Scene 2",
			x: 200,
			y: 200,
			width: 960,
			height: 540,
			zIndex: 1,
			locked: false,
			hidden: false,
			createdAt: 1,
			updatedAt: 1,
		};

		act(() => {
			useProjectStore.getState().restoreSceneGraphForHistory(scene2, node2);
		});

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(2);
		});
	});

	it("应用全局历史时不会重复采集历史", async () => {
		render(<BridgeMount />, { wrapper });

		await waitFor(() => {
			expect(studioRuntime.listTimelineRuntimes()).toHaveLength(2);
		});

		act(() => {
			const scene1Runtime = studioRuntime.getTimelineRuntime(
				toSceneTimelineRef("scene-1"),
			);
			scene1Runtime?.timelineStore
				.getState()
				.setElements((prev) => prev.slice(0, 0));
		});

		await waitFor(() => {
			expect(useStudioHistoryStore.getState().past).toHaveLength(1);
		});

		act(() => {
			useStudioHistoryStore.getState().undo({ runtimeManager: studioRuntime });
		});
		expect(useStudioHistoryStore.getState().past).toHaveLength(0);
		expect(useStudioHistoryStore.getState().future).toHaveLength(1);

		act(() => {
			useStudioHistoryStore.getState().redo({ runtimeManager: studioRuntime });
		});
		expect(useStudioHistoryStore.getState().past).toHaveLength(1);
		expect(useStudioHistoryStore.getState().future).toHaveLength(0);
	});
});
