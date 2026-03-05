import type { BuildSkiaFrameSnapshot } from "core/editor/exportVideo";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRegistryClass } from "@/element/model/registry";
import type { EditorRuntime } from "@/scene-editor/runtime/types";

let timelineState: {
	elements: Array<{ type?: string; timeline: { end: number } }>;
	tracks: unknown[];
	fps: number;
	canvasSize: { width: number; height: number };
	isPlaying: boolean;
	currentTime: number;
	previewTime: number | null;
	previewAxisEnabled: boolean;
	isExporting: boolean;
	exportTime: number | null;
	audioTrackStates: Record<string, never>;
	audioSettings: Record<string, never>;
	pause: ReturnType<typeof vi.fn>;
	play: ReturnType<typeof vi.fn>;
	setPreviewAxisEnabled: ReturnType<typeof vi.fn>;
	setPreviewTime: ReturnType<typeof vi.fn>;
	setIsExporting: ReturnType<typeof vi.fn>;
	setExportTime: ReturnType<typeof vi.fn>;
	setCurrentTime: ReturnType<typeof vi.fn>;
};
let runtime: EditorRuntime;
type FrameSnapshotArgs = Parameters<BuildSkiaFrameSnapshot>[0];

const {
	exportTimelineAsVideoCoreMock,
	buildSkiaFrameSnapshotMock,
	buildCompositionAudioGraphMock,
} = vi.hoisted(() => ({
	exportTimelineAsVideoCoreMock: vi.fn(),
	buildSkiaFrameSnapshotMock: vi.fn(),
	buildCompositionAudioGraphMock: vi.fn(),
}));

vi.mock("@/scene-editor/playback/clipContinuityIndex", () => ({
	getAudioPlaybackSessionKey: vi.fn(() => null),
}));

vi.mock("@/scene-editor/preview/buildSkiaTree", () => ({
	buildSkiaFrameSnapshot: buildSkiaFrameSnapshotMock,
}));

vi.mock("@/scene-editor/audio/buildCompositionAudioGraph", () => ({
	buildCompositionAudioGraph: buildCompositionAudioGraphMock,
}));

vi.mock("core/editor/exportVideo", () => ({
	exportTimelineAsVideoCore: exportTimelineAsVideoCoreMock,
}));

import { buildCompositionAudioGraph } from "@/scene-editor/audio/buildCompositionAudioGraph";
import { buildSkiaFrameSnapshot } from "@/scene-editor/preview/buildSkiaTree";
import { exportTimelineAsVideo } from "./exportVideo";

const createAbortError = (): Error => {
	if (typeof DOMException !== "undefined") {
		return new DOMException("已取消", "AbortError");
	}
	const error = new Error("已取消");
	error.name = "AbortError";
	return error;
};

const createTimelineState = (overrides?: Partial<typeof timelineState>) => {
	const state: typeof timelineState = {
		elements: [{ timeline: { end: 120 } }],
		tracks: [],
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		isPlaying: false,
		currentTime: 32,
		previewTime: 12,
		previewAxisEnabled: true,
		isExporting: false,
		exportTime: null,
		audioTrackStates: {},
		audioSettings: {},
		pause: vi.fn(() => {
			state.isPlaying = false;
		}),
		play: vi.fn(() => {
			state.isPlaying = true;
		}),
		setPreviewAxisEnabled: vi.fn((enabled: boolean) => {
			state.previewAxisEnabled = enabled;
		}),
		setPreviewTime: vi.fn((time: number | null) => {
			state.previewTime = time;
		}),
		setIsExporting: vi.fn((isExporting: boolean) => {
			state.isExporting = isExporting;
		}),
		setExportTime: vi.fn((time: number | null) => {
			state.exportTime = time;
		}),
		setCurrentTime: vi.fn((time: number) => {
			state.currentTime = time;
		}),
		...overrides,
	};
	return state;
};

describe("editor.exportTimelineAsVideo", () => {
	beforeEach(() => {
		timelineState = createTimelineState();
		runtime = {
			id: "test-runtime",
			timelineStore: {
				getState: () => timelineState,
			} as unknown as EditorRuntime["timelineStore"],
			modelRegistry: {
				get: vi.fn(() => null),
			} as unknown as ModelRegistryClass,
		};
		exportTimelineAsVideoCoreMock.mockReset();
		buildSkiaFrameSnapshotMock.mockReset();
		buildCompositionAudioGraphMock.mockReset();
		buildSkiaFrameSnapshotMock.mockResolvedValue({
			children: [],
			orderedElements: [],
			visibleElements: [],
			transitionFrameState: {
				activeTransitions: [],
				hiddenElementIds: [],
			},
			picture: {},
			ready: Promise.resolve(),
			dispose: () => {},
		});
		buildCompositionAudioGraphMock.mockReset();
		vi.mocked(buildCompositionAudioGraph).mockReturnValue(null as never);
	});

	it("透传 signal 与 onFrame，并同步导出帧", async () => {
		const controller = new AbortController();
		const onFrame = vi.fn();
		exportTimelineAsVideoCoreMock.mockImplementationOnce(async (options) => {
			options.onFrame?.(15);
		});

		await exportTimelineAsVideo({
			filename: "demo.mp4",
			fps: 24,
			startFrame: 10,
			endFrame: 20,
			signal: controller.signal,
			onFrame,
			runtime,
		});

		expect(exportTimelineAsVideoCoreMock).toHaveBeenCalledTimes(1);
		const passed = exportTimelineAsVideoCoreMock.mock.calls[0]?.[0];
		expect(passed).toMatchObject({
			filename: "demo.mp4",
			fps: 24,
			startFrame: 10,
			endFrame: 20,
			signal: controller.signal,
		});
		expect(typeof passed.buildSkiaFrameSnapshot).toBe("function");
		expect(
			(passed as { buildSkiaRenderState?: unknown }).buildSkiaRenderState,
		).toBeUndefined();
		expect(onFrame).toHaveBeenCalledWith(15);
		expect(timelineState.setExportTime).toHaveBeenCalledWith(10);
		expect(timelineState.setExportTime).toHaveBeenCalledWith(15);
	});

	it("失败时恢复时间轴状态", async () => {
		timelineState = createTimelineState({
			isPlaying: true,
			currentTime: 88,
			previewTime: 44,
			previewAxisEnabled: true,
			isExporting: false,
			exportTime: null,
		});
		exportTimelineAsVideoCoreMock.mockRejectedValueOnce(new Error("failed"));

		await expect(exportTimelineAsVideo({ runtime })).rejects.toThrow("failed");

		expect(timelineState.setIsExporting).toHaveBeenNthCalledWith(1, true);
		expect(timelineState.setIsExporting).toHaveBeenLastCalledWith(false);
		expect(timelineState.setPreviewAxisEnabled).toHaveBeenNthCalledWith(
			1,
			false,
		);
		expect(timelineState.setPreviewAxisEnabled).toHaveBeenLastCalledWith(true);
		expect(timelineState.setPreviewTime).toHaveBeenNthCalledWith(1, null);
		expect(timelineState.setPreviewTime).toHaveBeenLastCalledWith(44);
		expect(timelineState.setCurrentTime).toHaveBeenCalledWith(88);
		expect(timelineState.play).toHaveBeenCalledTimes(1);
	});

	it("picture 构建失败上抛时同样恢复时间轴状态", async () => {
		timelineState = createTimelineState({
			isPlaying: true,
			currentTime: 48,
			previewTime: 20,
			previewAxisEnabled: true,
			isExporting: false,
			exportTime: null,
		});
		exportTimelineAsVideoCoreMock.mockRejectedValueOnce(
			new Error("导出失败：无法构建第 12 帧 picture（已中止导出）"),
		);

		await expect(exportTimelineAsVideo({ runtime })).rejects.toThrow(
			"导出失败：无法构建第 12 帧 picture（已中止导出）",
		);

		expect(timelineState.setIsExporting).toHaveBeenNthCalledWith(1, true);
		expect(timelineState.setIsExporting).toHaveBeenLastCalledWith(false);
		expect(timelineState.setPreviewAxisEnabled).toHaveBeenNthCalledWith(
			1,
			false,
		);
		expect(timelineState.setPreviewAxisEnabled).toHaveBeenLastCalledWith(true);
		expect(timelineState.setPreviewTime).toHaveBeenNthCalledWith(1, null);
		expect(timelineState.setPreviewTime).toHaveBeenLastCalledWith(20);
		expect(timelineState.setCurrentTime).toHaveBeenCalledWith(48);
		expect(timelineState.play).toHaveBeenCalledTimes(1);
	});

	it("取消时同样恢复时间轴状态", async () => {
		timelineState = createTimelineState({
			isPlaying: false,
			currentTime: 16,
			previewTime: null,
			previewAxisEnabled: false,
			isExporting: false,
			exportTime: null,
		});
		exportTimelineAsVideoCoreMock.mockRejectedValueOnce(createAbortError());

		await expect(exportTimelineAsVideo({ runtime })).rejects.toBeDefined();

		expect(timelineState.setIsExporting).toHaveBeenNthCalledWith(1, true);
		expect(timelineState.setIsExporting).toHaveBeenLastCalledWith(false);
		expect(timelineState.setCurrentTime).toHaveBeenCalledWith(16);
		expect(timelineState.play).not.toHaveBeenCalled();
		expect(timelineState.pause).toHaveBeenCalled();
	});

	it("未传 endFrame 时会忽略 Filter 计算末帧", async () => {
		timelineState = createTimelineState({
			elements: [
				{ type: "VideoClip", timeline: { end: 120 } },
				{ type: "Filter", timeline: { end: 300 } },
			],
		});
		exportTimelineAsVideoCoreMock.mockResolvedValueOnce(undefined);

		await exportTimelineAsVideo({
			startFrame: 0,
			runtime,
		});

		const passed = exportTimelineAsVideoCoreMock.mock.calls[0]?.[0];
		expect(passed?.endFrame).toBe(120);
	});

	it("存在 composition 音频图时导出会使用扁平音频，但视频渲染仍使用根 scene", async () => {
		const rootElements = [
			{ id: "composition-1", type: "Composition", timeline: { end: 120 } },
		];
		const rootTracks = [{ id: "track-1" }];
		timelineState = createTimelineState({
			elements: rootElements,
			tracks: rootTracks,
		});
		const rootRuntime = {
			id: "scene:scene-1",
			ref: {
				kind: "scene",
				sceneId: "scene-1",
			},
			timelineStore: {
				getState: () => timelineState,
			},
			modelRegistry: {
				get: vi.fn(() => null),
			},
		};
		const graph = {
			mixElements: [
				{
					id: "virtual-audio-1",
					type: "AudioClip",
					component: "audio-clip",
					name: "virtual-audio-1",
					timeline: { start: 0, end: 120 },
					props: {},
				},
			],
			mixTracks: [{ id: "__mix-track__" }],
			previewTargets: new Map(),
			exportAudioSourceMap: new Map([
				[
					"virtual-audio-1",
					{
						audioSink: {},
						audioDuration: 4,
					},
				],
			]),
			enabledMap: new Map([["virtual-audio-1", true]]),
			sessionKeyMap: new Map([["virtual-audio-1", "session:virtual-audio-1"]]),
			physicalClipRefs: [],
		};
		vi.mocked(buildCompositionAudioGraph).mockReturnValue(graph as never);

		runtime = {
			id: "test-runtime",
			timelineStore: {
				getState: () => timelineState,
			} as unknown as EditorRuntime["timelineStore"],
			modelRegistry: {
				get: vi.fn(() => null),
			} as unknown as ModelRegistryClass,
			getActiveEditTimelineRef: vi.fn(() => ({
				kind: "scene",
				sceneId: "scene-1",
			})),
			getTimelineRuntime: vi.fn(() => rootRuntime),
		} as unknown as EditorRuntime;

		exportTimelineAsVideoCoreMock.mockImplementationOnce(async (options) => {
			expect(options.elements).toEqual(graph.mixElements);
			expect(options.tracks).toEqual(graph.mixTracks);
			expect(
				options.audio?.getAudioSourceByElementId?.("virtual-audio-1"),
			).toEqual({
				audioSink: {},
				audioDuration: 4,
			});
			expect(
				options.audio?.getAudioSessionKeyByElementId?.("virtual-audio-1"),
			).toBe("session:virtual-audio-1");
			expect(options.audio?.isElementAudioEnabled?.("virtual-audio-1")).toBe(
				true,
			);
			const snapshotInput: FrameSnapshotArgs = {
				elements: graph.mixElements as unknown as FrameSnapshotArgs["elements"],
				displayTime: 10,
				tracks: graph.mixTracks as unknown as FrameSnapshotArgs["tracks"],
				getTrackIndexForElement: () => 0,
				sortByTrackIndex: (elements: FrameSnapshotArgs["elements"]) => elements,
				prepare: {
					isExporting: true,
					fps: 30,
					canvasSize: {
						width: 1920,
						height: 1080,
					},
				},
			};
			await options.buildSkiaFrameSnapshot({
				...snapshotInput,
			});
		});

		await exportTimelineAsVideo({ runtime });

		const snapshotCall = vi
			.mocked(buildSkiaFrameSnapshot)
			.mock.calls.at(-1)?.[0];
		expect(snapshotCall?.elements).toBe(rootElements);
		expect(snapshotCall?.tracks).toBe(rootTracks);
	});
});
