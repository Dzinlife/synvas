// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import type { SceneDocument, SceneNode } from "core/studio/types";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { SceneNodeSkiaRenderer } from "./renderer";

const { buildSkiaFrameSnapshotMock } = vi.hoisted(() => ({
	buildSkiaFrameSnapshotMock: vi.fn(),
}));

vi.mock("@/scene-editor/preview/buildSkiaTree", () => ({
	buildSkiaFrameSnapshot: buildSkiaFrameSnapshotMock,
}));

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", () => ({
	EditorRuntimeProvider: ({ children }: { children: React.ReactNode }) => {
		return children;
	},
}));

vi.mock("react-skia-lite", async () => {
	const ReactModule = await import("react");
	let nextPictureId = 0;
	const createSharedValue = <T,>(value: T) => {
		const listeners = new Map<number, (nextValue: T) => void>();
		let currentValue = value;
		return {
			get value() {
				return currentValue;
			},
			set value(nextValue: T) {
				currentValue = nextValue;
				for (const listener of listeners.values()) {
					listener(nextValue);
				}
			},
			_isSharedValue: true as const,
			addListener: (listenerId: number, listener: (nextValue: T) => void) => {
				listeners.set(listenerId, listener);
			},
			removeListener: (listenerId: number) => {
				listeners.delete(listenerId);
			},
			modify: (modifier?: (value: T) => T, _forceUpdate?: boolean) => {
				const nextValue = modifier ? modifier(currentValue) : currentValue;
				currentValue = nextValue;
				for (const listener of listeners.values()) {
					listener(nextValue);
				}
			},
		};
	};

	return {
		Group: ({ children }: { children?: React.ReactNode }) => children ?? null,
		Picture: () => null,
		Rect: () => null,
		useSharedValue: <T,>(initialValue: T) => {
			const ref = ReactModule.useRef(createSharedValue(initialValue));
			return ref.current;
		},
		Skia: {
			PictureRecorder: () => ({
				beginRecording: () => ({}),
				finishRecordingAsPicture: () => ({
					id: `empty-picture-${nextPictureId++}`,
					dispose: vi.fn(),
				}),
			}),
		},
	};
});

const flushMicrotasks = async () => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
};

describe("SceneNodeSkiaRenderer flicker fix", () => {
	beforeEach(() => {
		buildSkiaFrameSnapshotMock.mockReset();
	});

	it("用 shared value 提交 picture 时不会触发 React 重渲染，并会延后一帧释放旧 picture", async () => {
		const rafQueue: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((requestId) => {
			const index = Number(requestId) - 1;
			if (index < 0 || index >= rafQueue.length) return;
			rafQueue[index] = () => undefined;
		});

		const timelineStore = createTimelineStore();
		const timelineRef = toSceneTimelineRef("scene-1");
		const runtime: TimelineRuntime = {
			id: "scene:scene-1",
			ref: timelineRef,
			timelineStore,
			modelRegistry: {
				get: () => null,
			} as unknown as TimelineRuntime["modelRegistry"],
		};
		const runtimeManager: StudioRuntimeManager = {
			ensureTimelineRuntime: () => runtime,
			removeTimelineRuntime: () => {},
			getTimelineRuntime: (ref) => {
				return ref.sceneId === timelineRef.sceneId ? runtime : null;
			},
			listTimelineRuntimes: () => [runtime],
			setActiveEditTimeline: () => {},
			getActiveEditTimelineRef: () => timelineRef,
			getActiveEditTimelineRuntime: () => runtime,
		};
		const node = {
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
			updatedAt: 1,
		} satisfies SceneDocument;
		const disposeFirst = vi.fn();
		const disposeSecond = vi.fn();

		buildSkiaFrameSnapshotMock
			.mockResolvedValueOnce({
				picture: { id: "picture-1" },
				dispose: disposeFirst,
			})
			.mockResolvedValueOnce({
				picture: { id: "picture-2" },
				dispose: disposeSecond,
			});

		const profileSpy = vi.fn();
		const profilerId = `scene-node-renderer-${Date.now()}`;

		render(
			<React.Profiler id={profilerId} onRender={profileSpy}>
				<SceneNodeSkiaRenderer
					node={node}
					scene={scene}
					asset={null}
					isActive={false}
					isFocused={false}
					isDimmed={false}
					runtimeManager={runtimeManager}
				/>
			</React.Profiler>,
		);

		expect(profileSpy).toHaveBeenCalledTimes(1);

		await flushMicrotasks();

		expect(profileSpy).toHaveBeenCalledTimes(1);
		expect(disposeFirst).not.toHaveBeenCalled();

		act(() => {
			timelineStore.setState({ currentTime: 1 });
		});

		await flushMicrotasks();

		expect(profileSpy).toHaveBeenCalledTimes(1);
		expect(disposeFirst).not.toHaveBeenCalled();
		expect(disposeSecond).not.toHaveBeenCalled();

		await act(async () => {
			const callbacks = rafQueue.splice(0);
			for (const callback of callbacks) {
				callback(performance.now());
			}
		});

		expect(disposeFirst).toHaveBeenCalledTimes(1);
		expect(disposeSecond).not.toHaveBeenCalled();
	});
});
