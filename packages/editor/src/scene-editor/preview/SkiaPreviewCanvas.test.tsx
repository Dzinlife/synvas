// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import type { TimelineElement } from "core/element/types";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineTrack } from "@/scene-editor/timeline/types";

const {
	rootRenderSpy,
	buildSkiaFrameSnapshotMock,
	timelineStore,
	modelRegistry,
} = vi.hoisted(() => {
	type StoreState = {
		fps: number;
		isPlaying: boolean;
		currentTime: number;
		previewTime: number | null;
		elements: TimelineElement[];
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
	};
	const subscribers: StoreSubscriber[] = [];
	const useStore = ((selector: (storeState: StoreState) => unknown) =>
		selector(state)) as unknown as {
		selector: (storeState: StoreState) => unknown;
	};
	(
		useStore as unknown as {
			subscribe: (
				selector: (storeState: StoreState) => unknown,
				listener: (selected: unknown) => void,
				options?: { fireImmediately?: boolean },
			) => () => void;
		}
	).subscribe = (selector, listener, options) => {
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
		};
		subscribers.length = 0;
	};

	const subscribe = (
		useStore as unknown as {
			subscribe: (
				selector: (storeState: StoreState) => unknown,
				listener: (selected: unknown) => void,
				options?: { fireImmediately?: boolean },
			) => () => void;
		}
	).subscribe;

	return {
		rootRenderSpy: vi.fn(),
		buildSkiaFrameSnapshotMock: vi.fn(),
		modelRegistry: {
			get: vi.fn(() => undefined),
			subscribe: vi.fn(() => () => {}),
		},
		timelineStore: {
			useStore,
			setState,
			reset,
			getState: () => state,
			subscribe,
		},
	};
});

vi.mock("react-skia-lite", async () => {
	const ReactModule = await import("react");
	const Canvas = ReactModule.forwardRef((_props: unknown, ref) => {
		ReactModule.useImperativeHandle(
			ref,
			() =>
				({
					getRoot: () => ({
						render: rootRenderSpy,
					}),
				}) as unknown,
			[],
		);
		return ReactModule.createElement("div", { "data-testid": "canvas" });
	});
	Canvas.displayName = "MockCanvas";

	const Fill = (props: Record<string, unknown>) => {
		return ReactModule.createElement("fill", props);
	};

	const Picture = (props: Record<string, unknown>) => {
		return ReactModule.createElement("picture", props);
	};

	return {
		Canvas,
		Fill,
		Picture,
		useContextBridge: () => {
			return ({ children }: { children: React.ReactNode }) => children;
		},
	};
});

vi.mock("@/scene-editor/contexts/TimelineContext", () => ({
	useTimelineStore: timelineStore.useStore,
}));

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", async () => {
	const ReactModule = await import("react");
	return {
		EditorRuntimeContext: ReactModule.createContext(null),
		useEditorRuntime: () => ({
			id: "runtime",
		}),
		useTimelineStoreApi: () => ({
			getState: timelineStore.getState,
			subscribe: timelineStore.subscribe,
		}),
		useModelRegistry: () => modelRegistry,
	};
});

vi.mock("./buildSkiaTree", () => ({
	buildSkiaFrameSnapshot: buildSkiaFrameSnapshotMock,
}));

import { SkiaPreviewCanvas } from "./SkiaPreviewCanvas";

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
	picture: { label, dispose: vi.fn() } as unknown as { dispose: () => void },
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

const tracks: TimelineTrack[] = [
	{
		id: "main",
		role: "clip",
		hidden: false,
		locked: false,
		muted: false,
		solo: false,
	},
];

const getTrackIndexForElement = (element: TimelineElement) =>
	element.timeline.trackIndex ?? 0;

const sortByTrackIndex = (elements: TimelineElement[]) => elements;

describe("SkiaPreviewCanvas", () => {
	beforeEach(() => {
		rootRenderSpy.mockReset();
		buildSkiaFrameSnapshotMock.mockReset();
		timelineStore.reset();
		timelineStore.setState({
			elements: [createElement("clip-1")],
		});
	});

	it("渲染时只消费 picture 快照", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		buildSkiaFrameSnapshotMock.mockImplementation(async ({ displayTime }) =>
			createFrameSnapshot(`frame-${displayTime}`),
		);

		render(
			<SkiaPreviewCanvas
				canvasWidth={1920}
				canvasHeight={1080}
				tracks={tracks}
				getTrackIndexForElement={getTrackIndexForElement}
				sortByTrackIndex={sortByTrackIndex}
				getElements={() => timelineStore.getState().elements}
				getRenderTime={() => timelineStore.getState().currentTime}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		timelineStore.setState({ currentTime: 1 });

		await waitFor(() => {
			const hasPictureCommit = rootRenderSpy.mock.calls.some((call) => {
				const node = call[0] as React.ReactElement | undefined;
				const typeName =
					typeof node?.type === "function"
						? node.type.name
						: String(node?.type);
				return typeName === "Picture";
			});
			expect(hasPictureCommit).toBe(true);
		});
		errorSpy.mockRestore();
	});

	it("构帧失败时保留上一帧，不触发新渲染提交", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		buildSkiaFrameSnapshotMock.mockImplementation(async ({ displayTime }) => {
			if (displayTime === 10) {
				throw new Error("frame failed");
			}
			return createFrameSnapshot(`frame-${displayTime}`);
		});

		render(
			<SkiaPreviewCanvas
				canvasWidth={1920}
				canvasHeight={1080}
				tracks={tracks}
				getTrackIndexForElement={getTrackIndexForElement}
				sortByTrackIndex={sortByTrackIndex}
				getElements={() => timelineStore.getState().elements}
				getRenderTime={() => timelineStore.getState().currentTime}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalledTimes(1);
		});

		timelineStore.setState({ currentTime: 10 });
		await waitFor(() => {
			expect(buildSkiaFrameSnapshotMock).toHaveBeenCalled();
		});

		expect(rootRenderSpy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});

	it("首帧失败时回退黑帧", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		buildSkiaFrameSnapshotMock.mockRejectedValue(
			new Error("first frame failed"),
		);

		render(
			<SkiaPreviewCanvas
				canvasWidth={1920}
				canvasHeight={1080}
				tracks={tracks}
				getTrackIndexForElement={getTrackIndexForElement}
				sortByTrackIndex={sortByTrackIndex}
				getElements={() => timelineStore.getState().elements}
				getRenderTime={() => timelineStore.getState().currentTime}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const fallbackNode = rootRenderSpy.mock.calls[0]?.[0] as React.ReactElement;
		const fallbackTypeName =
			typeof fallbackNode?.type === "function"
				? fallbackNode.type.name
				: String(fallbackNode?.type);
		expect(fallbackTypeName).toBe("Fill");
		errorSpy.mockRestore();
	});

	it("非播放态连续拖拽时不应被慢帧阻塞", async () => {
		let resolveSlowFrame: (() => void) | undefined;
		buildSkiaFrameSnapshotMock.mockImplementation(({ displayTime }) => {
			if (displayTime === 0) {
				return new Promise((resolve) => {
					resolveSlowFrame = () => {
						resolve(createFrameSnapshot("frame-0"));
					};
				});
			}
			return Promise.resolve(createFrameSnapshot(`frame-${displayTime}`));
		});

		render(
			<SkiaPreviewCanvas
				canvasWidth={1920}
				canvasHeight={1080}
				tracks={tracks}
				getTrackIndexForElement={getTrackIndexForElement}
				sortByTrackIndex={sortByTrackIndex}
				getElements={() => timelineStore.getState().elements}
				getRenderTime={() => timelineStore.getState().currentTime}
			/>,
		);

		timelineStore.setState({ currentTime: 8 });

		await waitFor(() => {
			const hasFrame8Commit = rootRenderSpy.mock.calls.some((call) => {
				const node = call[0] as React.ReactElement | undefined;
				const picture = (node?.props as { picture?: { label?: string } })
					?.picture;
				return picture?.label === "frame-8";
			});
			expect(hasFrame8Commit).toBe(true);
		});

		resolveSlowFrame?.();
		await waitFor(() => {
			expect(buildSkiaFrameSnapshotMock).toHaveBeenCalled();
		});
	});

	it("播放中 seek 跳帧时应优先显示目标帧", async () => {
		let resolveSlowFrame: (() => void) | undefined;
		timelineStore.setState({ isPlaying: true });
		buildSkiaFrameSnapshotMock.mockImplementation(({ displayTime }) => {
			if (displayTime === 0) {
				return new Promise((resolve) => {
					resolveSlowFrame = () => {
						resolve(createFrameSnapshot("frame-0"));
					};
				});
			}
			return Promise.resolve(createFrameSnapshot(`frame-${displayTime}`));
		});

		render(
			<SkiaPreviewCanvas
				canvasWidth={1920}
				canvasHeight={1080}
				tracks={tracks}
				getTrackIndexForElement={getTrackIndexForElement}
				sortByTrackIndex={sortByTrackIndex}
				getElements={() => timelineStore.getState().elements}
				getRenderTime={() => timelineStore.getState().currentTime}
			/>,
		);

		timelineStore.setState({ currentTime: 100 });

		await waitFor(() => {
			const hasTargetFrameCommit = rootRenderSpy.mock.calls.some((call) => {
				const node = call[0] as React.ReactElement | undefined;
				const picture = (node?.props as { picture?: { label?: string } })
					?.picture;
				return picture?.label === "frame-100";
			});
			expect(hasTargetFrameCommit).toBe(true);
		});

		resolveSlowFrame?.();
	});
});
