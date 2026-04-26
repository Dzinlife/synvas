// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import type { TimelineElement } from "core/timeline-system/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import type { SceneDocument, SceneNode } from "@/studio/project/types";

const { buildSkiaFrameSnapshotMock, timelineStoreState, thumbnailImageMock } =
	vi.hoisted(() => {
		type StoreState = {
			fps: number;
			isPlaying: boolean;
			currentTime: number;
			previewTime: number | null;
			elements: TimelineElement[];
			tracks: Array<{
				id: string;
				role: "clip" | "effect" | "audio";
				hidden: boolean;
				locked: boolean;
				muted: boolean;
				solo: boolean;
			}>;
			canvasSize: { width: number; height: number };
			getRenderTime: () => number;
		};
		type StoreSubscriber = {
			selector: (state: StoreState) => unknown;
			listener: (selected: unknown) => void;
			lastSelected: unknown;
		};

		let state: StoreState = {
			fps: 30,
			isPlaying: false,
			currentTime: 0,
			previewTime: null,
			elements: [],
			tracks: [],
			canvasSize: { width: 1920, height: 1080 },
			getRenderTime: () => state.currentTime,
		};
		const subscribers: StoreSubscriber[] = [];

		const subscribe = (
			selector: (storeState: StoreState) => unknown,
			listener: (selected: unknown) => void,
			options?: { fireImmediately?: boolean },
		): (() => void) => {
			const subscriber: StoreSubscriber = {
				selector,
				listener,
				lastSelected: selector(state),
			};
			subscribers.push(subscriber);
			if (options?.fireImmediately) {
				listener(subscriber.lastSelected);
			}
			return () => {
				const index = subscribers.indexOf(subscriber);
				if (index >= 0) subscribers.splice(index, 1);
			};
		};

		const setState = (patch: Partial<StoreState>) => {
			state = { ...state, ...patch };
			for (const subscriber of [...subscribers]) {
				const nextSelected = subscriber.selector(state);
				if (nextSelected === subscriber.lastSelected) continue;
				subscriber.lastSelected = nextSelected;
				subscriber.listener(nextSelected);
			}
		};

		const reset = () => {
			state = {
				fps: 30,
				isPlaying: false,
				currentTime: 0,
				previewTime: null,
				elements: [],
				tracks: [
					{
						id: "main",
						role: "clip",
						hidden: false,
						locked: false,
						muted: false,
						solo: false,
					},
				],
				canvasSize: { width: 1920, height: 1080 },
				getRenderTime: () => state.currentTime,
			};
			subscribers.length = 0;
		};

		return {
			buildSkiaFrameSnapshotMock: vi.fn(),
			thumbnailImageMock: vi.fn(),
			timelineStoreState: {
				getState: () => state,
				subscribe,
				setState,
				reset,
			},
		};
	});

const typographyRevisionMock = vi.hoisted(() => {
	const listeners = new Set<() => void>();
	return {
		subscribeRevision: vi.fn((listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}),
		emitRevision: () => {
			for (const listener of [...listeners]) {
				listener();
			}
		},
		reset: () => {
			listeners.clear();
		},
	};
});

vi.mock("react-skia-lite", async () => {
	const ReactModule = await import("react");
	let nextPictureId = 0;
	let listenerId = 0;

	type SharedValue<T> = {
		value: T;
		_isSharedValue: true;
		addListener: (listenerId: number, listener: (nextValue: T) => void) => void;
		removeListener: (listenerId: number) => void;
		modify: (modifier?: (value: T) => T, forceUpdate?: boolean) => void;
	};

	const createSharedValue = <T,>(value: T): SharedValue<T> => {
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
			_isSharedValue: true,
			addListener: (nextListenerId, listener) => {
				listeners.set(nextListenerId, listener);
			},
			removeListener: (nextListenerId) => {
				listeners.delete(nextListenerId);
			},
			modify: (modifier) => {
				const nextValue = modifier ? modifier(currentValue) : currentValue;
				currentValue = nextValue;
				for (const listener of listeners.values()) {
					listener(nextValue);
				}
			},
		};
	};

	const isSharedValue = <T,>(value: unknown): value is SharedValue<T> => {
		return Boolean(
			value &&
				typeof value === "object" &&
				"_isSharedValue" in (value as Record<string, unknown>) &&
				(value as { _isSharedValue?: unknown })._isSharedValue === true,
		);
	};

	const useSharedValueSnapshot = (value: unknown) => {
		const [snapshot, setSnapshot] = ReactModule.useState(() => {
			return isSharedValue(value) ? value.value : value;
		});
		ReactModule.useEffect(() => {
			if (!isSharedValue(value)) {
				setSnapshot(value);
				return;
			}
			const nextListenerId = listenerId++;
			value.addListener(nextListenerId, setSnapshot);
			setSnapshot(value.value);
			return () => {
				value.removeListener(nextListenerId);
			};
		}, [value]);
		return snapshot;
	};

	const Group = ({ children }: { children?: React.ReactNode }) => {
		return ReactModule.createElement("div", { "data-skia": "group" }, children);
	};
	const Picture = ({
		children,
		opacity,
	}: {
		children?: React.ReactNode;
		opacity?: unknown;
	}) => {
		const resolvedOpacity = useSharedValueSnapshot(opacity ?? 1);
		return ReactModule.createElement(
			"div",
			{ "data-skia": "picture", "data-opacity": String(resolvedOpacity) },
			children,
		);
	};
	const Rect = ({
		children,
		opacity,
	}: {
		children?: React.ReactNode;
		opacity?: unknown;
	}) => {
		const resolvedOpacity = useSharedValueSnapshot(opacity ?? 1);
		return ReactModule.createElement(
			"div",
			{ "data-skia": "rect", "data-opacity": String(resolvedOpacity) },
			children,
		);
	};
	const ImageShader = () =>
		ReactModule.createElement("div", {
			"data-skia": "image-shader",
		});
	return {
		Group,
		ImageShader,
		Picture,
		Rect,
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

vi.mock("../thumbnail/useCanvasNodeThumbnailImage", () => ({
	useCanvasNodeThumbnailImage: thumbnailImageMock,
}));

vi.mock("@/typography/textTypographyFacade", () => ({
	textTypographyFacade: {
		subscribeRevision: typographyRevisionMock.subscribeRevision,
	},
}));

import { SceneNodeSkiaRenderer } from "./renderer";
import {
	clearSceneNodeLastLiveFrames,
	getSceneNodeLastLiveFrame,
} from "./lastLiveFrame";

const createElement = (id: string): TimelineElement => ({
	id,
	type: "Image",
	component: "image",
	name: id,
	timeline: {
		start: 0,
		end: 60,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:02:00",
		trackIndex: 0,
	},
	props: {},
});

const createFrameSnapshot = (label: string) => ({
	picture: { label, dispose: vi.fn() },
	children: [],
	orderedElements: [],
	visibleElements: [],
	transitionFrameState: {
		activeTransitions: [],
		hiddenElementIds: [],
	},
	ready: Promise.resolve(),
	dispose: vi.fn(),
});

const createRuntimeManager = (): StudioRuntimeManager => {
	const runtime = {
		id: "runtime:scene-1",
		ref: {
			kind: "scene",
			sceneId: "scene-1",
		},
		timelineStore: {
			getState: timelineStoreState.getState,
			subscribe: timelineStoreState.subscribe,
		},
		modelRegistry: {
			get: vi.fn(() => undefined),
		},
	} as unknown as TimelineRuntime;
	return {
		ensureTimelineRuntime: vi.fn(() => runtime),
		getTimelineRuntime: vi.fn(() => runtime),
		removeTimelineRuntime: vi.fn(),
		listTimelineRuntimes: vi.fn(() => [runtime]),
		setActiveEditTimeline: vi.fn(),
		getActiveEditTimelineRef: vi.fn(() => runtime.ref),
		getActiveEditTimelineRuntime: vi.fn(() => runtime),
	};
};

const createRendererProps = (
	isActive: boolean,
	runtimeManager: StudioRuntimeManager = createRuntimeManager(),
) => ({
	node: {
		id: "node-scene-1",
		type: "scene",
		name: "Scene 1",
		sceneId: "scene-1",
		x: 0,
		y: 0,
		width: 960,
		height: 540,
		siblingOrder: 1,
		locked: false,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	} satisfies SceneNode,
	scene: {
		id: "scene-1",
		name: "Scene 1",
		timeline: {
			canvas: { width: 1920, height: 1080 },
		},
		posterFrame: 0,
		createdAt: 0,
		updatedAt: 0,
	} as unknown as SceneDocument,
	asset: null,
	isActive,
	isFocused: false,
	runtimeManager,
});

describe("SceneNodeSkiaRenderer", () => {
	beforeEach(() => {
		buildSkiaFrameSnapshotMock.mockReset();
		thumbnailImageMock.mockReset();
		thumbnailImageMock.mockReturnValue(null);
		clearSceneNodeLastLiveFrames();
		timelineStoreState.reset();
		typographyRevisionMock.reset();
		timelineStoreState.setState({
			elements: [createElement("clip-1")],
		});
	});

	it("会为整帧快照透传 picture render target", async () => {
		buildSkiaFrameSnapshotMock.mockImplementation(async ({ displayTime }) =>
			createFrameSnapshot(`frame-${displayTime}`),
		);

		render(<SceneNodeSkiaRenderer {...createRendererProps(true)} />);

		await waitFor(() => {
			expect(buildSkiaFrameSnapshotMock).toHaveBeenCalled();
		});
		const firstBuildArgs = buildSkiaFrameSnapshotMock.mock.calls[0]?.[0] as
			| {
					prepare?: {
						compositionRenderTarget?: string;
						frameSnapshotRenderTarget?: string;
					};
			  }
			| undefined;
		expect(firstBuildArgs?.prepare?.frameSnapshotRenderTarget).toBe("picture");
		expect(firstBuildArgs?.prepare?.compositionRenderTarget).toBe("picture");
	});

	it("inactive 首屏无已提交画面时展示 thumbnail 且不触发构帧", async () => {
		thumbnailImageMock.mockReturnValue({ id: "scene-thumb" });

		const view = render(
			<SceneNodeSkiaRenderer {...createRendererProps(false)} />,
		);

		expect(buildSkiaFrameSnapshotMock).not.toHaveBeenCalled();
		expect(
			view.container.querySelector('[data-skia="image-shader"]'),
		).toBeTruthy();
	});

	it("成功提交 live picture 后会记录最后一帧", async () => {
		buildSkiaFrameSnapshotMock.mockImplementation(async ({ displayTime }) =>
			createFrameSnapshot(`frame-${displayTime}`),
		);
		const props = createRendererProps(true);

		render(<SceneNodeSkiaRenderer {...props} />);

		await waitFor(() => {
			const record = getSceneNodeLastLiveFrame(props.node, props.scene);
			expect(record?.nodeId).toBe("node-scene-1");
			expect(record?.sceneId).toBe("scene-1");
			expect(record?.frameIndex).toBe(0);
			expect(record?.sourceWidth).toBe(1920);
			expect(record?.sourceHeight).toBe(1080);
		});
	});

	it("构帧失败时不会记录最后一帧", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		buildSkiaFrameSnapshotMock.mockRejectedValue(new Error("frame failed"));
		const props = createRendererProps(true);

		render(<SceneNodeSkiaRenderer {...props} />);

		await waitFor(() => {
			expect(buildSkiaFrameSnapshotMock).toHaveBeenCalled();
			expect(errorSpy).toHaveBeenCalled();
		});
		expect(getSceneNodeLastLiveFrame(props.node, props.scene)).toBeNull();
		errorSpy.mockRestore();
	});

	it("构帧失败时会清空为占位块并释放上一帧", async () => {
		const firstFrame = createFrameSnapshot("frame-0");
		buildSkiaFrameSnapshotMock.mockImplementation(async ({ displayTime }) => {
			if (displayTime === 10) {
				throw new Error("frame failed");
			}
			if (displayTime === 0) {
				return firstFrame;
			}
			return createFrameSnapshot(`frame-${displayTime}`);
		});

		const view = render(
			<div data-testid="root">
				<SceneNodeSkiaRenderer {...createRendererProps(true)} />
			</div>,
		);

		await waitFor(() => {
			expect(
				view.container
					.querySelector('[data-skia="picture"]')
					?.getAttribute("data-opacity"),
			).toBe("1");
			expect(
				view.container
					.querySelector('[data-skia="rect"]')
					?.getAttribute("data-opacity"),
			).toBe("0");
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		act(() => {
			timelineStoreState.setState({ currentTime: 10 });
		});

		await waitFor(() => {
			expect(
				view.container
					.querySelector('[data-skia="rect"]')
					?.getAttribute("data-opacity"),
			).toBe("1");
			expect(
				view.container
					.querySelector('[data-skia="picture"]')
					?.getAttribute("data-opacity"),
			).toBe("0");
		});
		expect(firstFrame.dispose).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});

	it("active -> inactive 后停止构帧并保留最后画面", async () => {
		buildSkiaFrameSnapshotMock.mockImplementation(async ({ displayTime }) =>
			createFrameSnapshot(`frame-${displayTime}`),
		);
		const runtimeManager = createRuntimeManager();

		const { rerender, container } = render(
			<SceneNodeSkiaRenderer {...createRendererProps(true, runtimeManager)} />,
		);

		await waitFor(() => {
			expect(
				container
					.querySelector('[data-skia="picture"]')
					?.getAttribute("data-opacity"),
			).toBe("1");
		});
		const buildCallCount = buildSkiaFrameSnapshotMock.mock.calls.length;

		rerender(
			<SceneNodeSkiaRenderer {...createRendererProps(false, runtimeManager)} />,
		);
		act(() => {
			timelineStoreState.setState({ currentTime: 5 });
		});

		expect(
			container
				.querySelector('[data-skia="picture"]')
				?.getAttribute("data-opacity"),
		).toBe("1");
		expect(buildSkiaFrameSnapshotMock.mock.calls.length).toBe(buildCallCount);
	});

	it("字体 revision 变化会触发当前帧重录", async () => {
		buildSkiaFrameSnapshotMock.mockImplementation(async ({ displayTime }) =>
			createFrameSnapshot(`frame-${displayTime}`),
		);
		render(<SceneNodeSkiaRenderer {...createRendererProps(true)} />);

		await waitFor(() => {
			expect(buildSkiaFrameSnapshotMock).toHaveBeenCalled();
		});
		const buildCallCount = buildSkiaFrameSnapshotMock.mock.calls.length;
		typographyRevisionMock.emitRevision();
		await waitFor(() => {
			expect(buildSkiaFrameSnapshotMock.mock.calls.length).toBeGreaterThan(
				buildCallCount,
			);
		});
	});
});
