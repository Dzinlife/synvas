// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	renderHook,
	waitFor,
} from "@testing-library/react";
import type { StudioProject } from "core/studio/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "@/scene-editor/runtime/testUtils";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

const mocks = vi.hoisted(() => ({
	sceneTogglePlayback: vi.fn(),
	getVideoController: vi.fn(),
	videoBind: vi.fn(),
	videoTogglePlayback: vi.fn(async () => {}),
}));

vi.mock("@/studio/scene/usePlaybackOwnerController", () => ({
	usePlaybackOwnerController: () => ({
		togglePlayback: mocks.sceneTogglePlayback,
	}),
}));

vi.mock("@/studio/canvas/node-system/video/playbackController", () => ({
	getVideoNodePlaybackController: mocks.getVideoController,
}));

import { useStudioHotkeys } from "./useStudioHotkeys";

const createProject = (
	activeNodeId: string | null,
	options: {
		includeVideoAsset?: boolean;
	} = {},
): StudioProject => {
	const includeVideoAsset = options.includeVideoAsset !== false;
	const assets = [
		...(includeVideoAsset
			? [
					{
						id: "asset-video-1",
						kind: "video" as const,
						uri: "file:///video-1.mp4",
						name: "video-1.mp4",
					},
				]
			: []),
		{
			id: "asset-audio-1",
			kind: "audio" as const,
			uri: "file:///audio-1.wav",
			name: "audio-1.wav",
		},
		{
			id: "asset-image-1",
			kind: "image" as const,
			uri: "file:///image-1.png",
			name: "image-1.png",
		},
	];
	return {
		id: "project-1",
		revision: 0,
		assets,
		canvas: {
			nodes: [
				{
					id: "node-scene-1",
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
					id: "node-video-1",
					type: "video",
					assetId: "asset-video-1",
					name: "Video 1",
					x: 320,
					y: 180,
					width: 640,
					height: 360,
					zIndex: 1,
					locked: false,
					hidden: false,
					createdAt: 1,
					updatedAt: 1,
				},
				{
					id: "node-audio-1",
					type: "audio",
					assetId: "asset-audio-1",
					name: "Audio 1",
					x: 160,
					y: 90,
					width: 320,
					height: 64,
					zIndex: 2,
					locked: false,
					hidden: false,
					createdAt: 1,
					updatedAt: 1,
				},
				{
					id: "node-text-1",
					type: "text",
					text: "hello",
					fontSize: 32,
					name: "Text 1",
					x: 120,
					y: 120,
					width: 200,
					height: 100,
					zIndex: 3,
					locked: false,
					hidden: false,
					createdAt: 1,
					updatedAt: 1,
				},
				{
					id: "node-image-1",
					type: "image",
					assetId: "asset-image-1",
					name: "Image 1",
					x: 240,
					y: 60,
					width: 200,
					height: 120,
					zIndex: 4,
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
					elements: [],
				},
			},
		},
		ui: {
			activeSceneId: "scene-1",
			focusedNodeId: null,
			activeNodeId,
			canvasSnapEnabled: true,
			camera: { x: 0, y: 0, zoom: 1 },
		},
		createdAt: 1,
		updatedAt: 1,
	};
};

const setProjectState = (project: StudioProject) => {
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: project.id,
		currentProject: project,
		focusedSceneDrafts: {},
		sceneTimelineMutationOpIds: {},
		error: null,
	});
};

describe("useStudioHotkeys", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.sceneTogglePlayback.mockReset();
		mocks.getVideoController.mockReset();
		mocks.videoBind.mockReset();
		mocks.videoTogglePlayback.mockReset();
		mocks.videoTogglePlayback.mockResolvedValue(undefined);
		mocks.getVideoController.mockReturnValue({
			bind: mocks.videoBind,
			togglePlayback: mocks.videoTogglePlayback,
		});
		setProjectState(createProject("node-scene-1"));
		useStudioHistoryStore.getState().clear();
	});

	afterEach(() => {
		cleanup();
	});

	it("active 为 scene 时，空格触发 scene 播放切换", () => {
		const runtime = createTestEditorRuntime("studio-hotkeys-scene-test");
		renderHook(() => useStudioHotkeys(), {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		fireEvent.keyDown(window, { code: "Space", key: " " });

		expect(mocks.sceneTogglePlayback).toHaveBeenCalledTimes(1);
		expect(mocks.sceneTogglePlayback).toHaveBeenCalledWith(
			toSceneTimelineRef("scene-1"),
		);
		expect(mocks.getVideoController).not.toHaveBeenCalled();
	});

	it("active 为 video 时，空格只触发 video 播放切换", async () => {
		setProjectState(createProject("node-video-1"));
		const runtime = createTestEditorRuntime("studio-hotkeys-video-test");
		renderHook(() => useStudioHotkeys(), {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		fireEvent.keyDown(window, { code: "Space", key: " " });

		await waitFor(() => {
			expect(mocks.videoTogglePlayback).toHaveBeenCalledTimes(1);
		});
		expect(mocks.sceneTogglePlayback).not.toHaveBeenCalled();
		expect(mocks.getVideoController).toHaveBeenCalledWith("node-video-1");
		expect(mocks.videoBind).toHaveBeenCalledWith(
			expect.objectContaining({
				assetUri: "file:///video-1.mp4",
				fps: 30,
				runtimeManager: expect.any(Object),
			}),
		);
	});

	it("active 为 text/image/null 时，空格不触发播放", () => {
		const runtime = createTestEditorRuntime("studio-hotkeys-non-playable-test");
		renderHook(() => useStudioHotkeys(), {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		act(() => {
			useProjectStore.getState().setActiveNode("node-text-1");
		});
		fireEvent.keyDown(window, { code: "Space", key: " " });

		act(() => {
			useProjectStore.getState().setActiveNode("node-image-1");
		});
		fireEvent.keyDown(window, { code: "Space", key: " " });

		act(() => {
			useProjectStore.getState().setActiveNode(null);
		});
		fireEvent.keyDown(window, { code: "Space", key: " " });

		expect(mocks.sceneTogglePlayback).not.toHaveBeenCalled();
		expect(mocks.getVideoController).not.toHaveBeenCalled();
		expect(mocks.videoTogglePlayback).not.toHaveBeenCalled();
	});

	it("空格 repeat 或输入态时不触发播放", () => {
		const runtime = createTestEditorRuntime("studio-hotkeys-repeat-test");
		renderHook(() => useStudioHotkeys(), {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });

		const input = document.createElement("input");
		document.body.appendChild(input);
		fireEvent.keyDown(input, { code: "Space", key: " " });
		input.remove();

		expect(mocks.sceneTogglePlayback).not.toHaveBeenCalled();
		expect(mocks.getVideoController).not.toHaveBeenCalled();
		expect(mocks.videoTogglePlayback).not.toHaveBeenCalled();
	});

	it("video 目标缺少 controller 或素材无效时安全 no-op", async () => {
		setProjectState(createProject("node-video-1"));
		const runtime = createTestEditorRuntime("studio-hotkeys-noop-test");
		renderHook(() => useStudioHotkeys(), {
			wrapper: createRuntimeProviderWrapper(runtime),
		});

		mocks.getVideoController.mockReturnValueOnce(null);
		fireEvent.keyDown(window, { code: "Space", key: " " });
		await waitFor(() => {
			expect(mocks.videoTogglePlayback).toHaveBeenCalledTimes(0);
		});

		act(() => {
			useProjectStore.setState((state) => ({
				currentProject: state.currentProject
					? createProject("node-video-1", { includeVideoAsset: false })
					: null,
			}));
		});
		fireEvent.keyDown(window, { code: "Space", key: " " });

		expect(mocks.sceneTogglePlayback).not.toHaveBeenCalled();
		expect(mocks.videoTogglePlayback).toHaveBeenCalledTimes(0);
	});
});
