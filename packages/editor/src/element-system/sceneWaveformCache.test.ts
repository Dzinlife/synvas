// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	buildCompositionAudioGraphMock,
	collectExportAudioTargetsMock,
	applyAudioMixPlanAtFrameMock,
	resolveExportAudioTransitionFrameStateMock,
	clearRectMock,
	beginPathMock,
	moveToMock,
	lineToMock,
	closePathMock,
	fillMock,
	strokeMock,
} = vi.hoisted(() => ({
	buildCompositionAudioGraphMock: vi.fn(),
	collectExportAudioTargetsMock: vi.fn(),
	applyAudioMixPlanAtFrameMock: vi.fn(),
	resolveExportAudioTransitionFrameStateMock: vi.fn(),
	clearRectMock: vi.fn(),
	beginPathMock: vi.fn(),
	moveToMock: vi.fn(),
	lineToMock: vi.fn(),
	closePathMock: vi.fn(),
	fillMock: vi.fn(),
	strokeMock: vi.fn(),
}));

vi.mock("@/scene-editor/audio/buildCompositionAudioGraph", () => ({
	buildCompositionAudioGraph: buildCompositionAudioGraphMock,
}));

vi.mock("core/render-system/exportVideo", () => ({
	__collectExportAudioTargetsForTests: collectExportAudioTargetsMock,
	__applyAudioMixPlanAtFrameForTests: applyAudioMixPlanAtFrameMock,
	__resolveExportAudioTransitionFrameStateForTests:
		resolveExportAudioTransitionFrameStateMock,
}));

describe("sceneWaveformCache", () => {
	const nativeGetContext = HTMLCanvasElement.prototype.getContext;

	beforeEach(() => {
		vi.resetModules();
		buildCompositionAudioGraphMock.mockReset().mockReturnValue({
			mixElements: [],
			mixTracks: [],
			previewTargets: new Map(),
			exportAudioSourceMap: new Map(),
			enabledMap: new Map(),
			sessionKeyMap: new Map(),
			physicalClipRefs: [],
		});
		collectExportAudioTargetsMock.mockReset().mockReturnValue({
			audioTargets: [],
			audioTargetsBySessionKey: new Map(),
			audioClips: [],
			audioClipTargetsById: new Map(),
		});
		applyAudioMixPlanAtFrameMock.mockReset();
		resolveExportAudioTransitionFrameStateMock
			.mockReset()
			.mockReturnValue({ activeTransitions: [] });
		clearRectMock.mockReset();
		beginPathMock.mockReset();
		moveToMock.mockReset();
		lineToMock.mockReset();
		closePathMock.mockReset();
		fillMock.mockReset();
		strokeMock.mockReset();
		HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(() => ({
			clearRect: clearRectMock,
			beginPath: beginPathMock,
			moveTo: moveToMock,
			lineTo: lineToMock,
			closePath: closePathMock,
			fill: fillMock,
			stroke: strokeMock,
			fillStyle: "",
			globalAlpha: 1,
			strokeStyle: "",
			lineWidth: 1,
			lineJoin: "round",
			lineCap: "round",
		})) as typeof nativeGetContext;
	});

	afterEach(() => {
		HTMLCanvasElement.prototype.getContext = nativeGetContext;
		vi.restoreAllMocks();
	});

	it("只改 gainDb 时会复用场景响度 chunk 缓存", async () => {
		const { getSceneWaveformThumbnail } = await import("./sceneWaveformCache");
		const sceneRuntime = {
			ref: {
				sceneId: "scene-child",
			},
			timelineStore: {
				getState: () => ({
					fps: 30,
				}),
			},
		} as never;

		const firstCanvas = await getSceneWaveformThumbnail({
			sceneRuntime,
			runtimeManager: {} as never,
			sceneRevision: 11,
			windowStartFrame: 0,
			windowEndFrame: 90,
			width: 180,
			height: 40,
			pixelRatio: 1,
			color: "rgba(34, 211, 238, 0.92)",
			gainDb: 0,
		});
		const secondCanvas = await getSceneWaveformThumbnail({
			sceneRuntime,
			runtimeManager: {} as never,
			sceneRevision: 11,
			windowStartFrame: 0,
			windowEndFrame: 90,
			width: 180,
			height: 40,
			pixelRatio: 1,
			color: "rgba(34, 211, 238, 0.92)",
			gainDb: 6,
		});

		expect(firstCanvas).not.toBeNull();
		expect(secondCanvas).not.toBeNull();
		expect(secondCanvas).not.toBe(firstCanvas);
		expect(buildCompositionAudioGraphMock).toHaveBeenCalledTimes(1);
		expect(collectExportAudioTargetsMock).toHaveBeenCalledTimes(1);
	});
});
