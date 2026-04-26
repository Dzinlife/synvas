// @vitest-environment jsdom

import type { SceneDocument, SceneNode } from "@/studio/project/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import type { CanvasNodeTilePictureCapabilityContext } from "../types";
import type { SceneNodeFrameSnapshot } from "./frameSnapshot";
import { sceneNodeTilePictureCapability } from "./tilePicture";
import {
	clearSceneNodeLastLiveFrames,
	recordSceneNodeLastLiveFrame,
} from "./lastLiveFrame";

const { buildSkiaFrameSnapshotMock } = vi.hoisted(() => ({
	buildSkiaFrameSnapshotMock: vi.fn(),
}));

vi.mock("@/scene-editor/preview/buildSkiaTree", () => ({
	buildSkiaFrameSnapshot: buildSkiaFrameSnapshotMock,
}));

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", async () => {
	const ReactModule = await import("react");
	return {
		EditorRuntimeProvider: ({ children }: { children: React.ReactNode }) =>
			ReactModule.createElement(ReactModule.Fragment, null, children),
	};
});

const node = {
	id: "node-scene-1",
	type: "scene",
	name: "Scene 1",
	sceneId: "scene-1",
	x: 0,
	y: 0,
	width: 320,
	height: 180,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
} satisfies SceneNode;

const scene = {
	id: "scene-1",
	name: "Scene 1",
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
	posterFrame: 0,
	createdAt: 1,
	updatedAt: 2,
} satisfies SceneDocument;

const createRuntimeManager = (): StudioRuntimeManager => {
	const runtime = {
		id: "scene:scene-1",
		ref: { kind: "scene" as const, sceneId: "scene-1" },
		timelineStore: {
			getState: () => ({
				fps: 30,
				elements: [],
				tracks: [],
				canvasSize: { width: 1920, height: 1080 },
			}),
		},
		modelRegistry: {
			get: vi.fn(() => undefined),
		},
	} as unknown as TimelineRuntime;
	return {
		ensureTimelineRuntime: vi.fn(() => runtime),
		removeTimelineRuntime: vi.fn(),
		getTimelineRuntime: vi.fn(() => runtime),
		listTimelineRuntimes: vi.fn(() => [runtime]),
		setActiveEditTimeline: vi.fn(),
		getActiveEditTimelineRef: vi.fn(() => runtime.ref),
		getActiveEditTimelineRuntime: vi.fn(() => runtime),
	};
};

const createCapabilityContext = (
	runtimeManager: StudioRuntimeManager,
): CanvasNodeTilePictureCapabilityContext<SceneNode> => ({
	node,
	scene,
	asset: null,
	runtimeManager,
});

describe("sceneNodeTilePictureCapability", () => {
	beforeEach(() => {
		clearSceneNodeLastLiveFrames();
		buildSkiaFrameSnapshotMock.mockReset();
	});

	it("没有 live 成功帧时不覆盖 thumbnail", async () => {
		const runtimeManager = createRuntimeManager();
		const context = createCapabilityContext(runtimeManager);

		expect(sceneNodeTilePictureCapability.preferOverThumbnail?.(context)).toBe(
			false,
		);
		expect(sceneNodeTilePictureCapability.getSourceSignature?.(context)).toBe(
			null,
		);
		await expect(
			sceneNodeTilePictureCapability.generate(context),
		).resolves.toBeNull();
		expect(buildSkiaFrameSnapshotMock).not.toHaveBeenCalled();
	});

	it("会用最后 live 成功帧生成 offscreen picture", async () => {
		const runtimeManager = createRuntimeManager();
		const picture = { dispose: vi.fn() };
		const dispose = vi.fn();
		buildSkiaFrameSnapshotMock.mockResolvedValue({
			picture,
			dispose,
		});
		recordSceneNodeLastLiveFrame({
			node,
			scene,
			frame: {
				kind: "picture",
				picture: {
					dispose: vi.fn(),
				} as unknown as SceneNodeFrameSnapshot["picture"],
				frameIndex: 12,
				displayTime: 12,
				fps: 30,
				sourceWidth: 1920,
				sourceHeight: 1080,
				dispose: vi.fn(),
			},
		});
		const context = createCapabilityContext(runtimeManager);

		expect(sceneNodeTilePictureCapability.preferOverThumbnail?.(context)).toBe(
			true,
		);
		expect(sceneNodeTilePictureCapability.getSourceSignature?.(context)).toBe(
			'{"nodeId":"node-scene-1","sceneId":"scene-1","sceneUpdatedAt":2,"frameIndex":12,"displayTime":12,"fps":30,"sourceWidth":1920,"sourceHeight":1080,"commitRevision":1}',
		);
		const result = await sceneNodeTilePictureCapability.generate(context);

		expect(result?.picture).toBe(picture);
		expect(result?.sourceWidth).toBe(1920);
		expect(result?.sourceHeight).toBe(1080);
		expect(result?.dispose).toBe(dispose);
		expect(result?.disposeIncludesPicture).toBe(true);
		expect(buildSkiaFrameSnapshotMock).toHaveBeenCalledWith(
			expect.objectContaining({
				displayTime: 12,
				prepare: expect.objectContaining({
					frameChannel: "offscreen",
					canvasSize: { width: 1920, height: 1080 },
				}),
			}),
			expect.any(Object),
		);
	});

	it("同一帧再次提交 live 画面也会更新 source signature", () => {
		const runtimeManager = createRuntimeManager();
		const frame = {
			kind: "picture" as const,
			picture: {
				dispose: vi.fn(),
			} as unknown as SceneNodeFrameSnapshot["picture"],
			frameIndex: 12,
			displayTime: 12,
			fps: 30,
			sourceWidth: 1920,
			sourceHeight: 1080,
			dispose: vi.fn(),
		};
		recordSceneNodeLastLiveFrame({
			node,
			scene,
			frame,
		});
		const firstSignature = sceneNodeTilePictureCapability.getSourceSignature?.(
			createCapabilityContext(runtimeManager),
		);

		recordSceneNodeLastLiveFrame({
			node,
			scene,
			frame,
		});
		const secondSignature = sceneNodeTilePictureCapability.getSourceSignature?.(
			createCapabilityContext(runtimeManager),
		);

		expect(firstSignature).not.toBe(secondSignature);
		expect(secondSignature).toContain('"commitRevision":2');
	});
});
