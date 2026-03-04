// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PreviewEditor from "./PreviewEditor";

const { renderProbe, timelineStoreState } = vi.hoisted(() => {
	const createState = () => ({
		currentTime: 0,
		previewTime: null as number | null,
		fps: 30,
		elements: [] as unknown[],
		tracks: [] as unknown[],
		isPlaying: false,
		getRenderTime: () => state.previewTime ?? state.currentTime,
		getElements: () => state.elements,
	});

	let state = createState();
	const externalListeners = new Set<() => void>();
	const selectorListeners = new Set<{
		selector: (value: typeof state) => unknown;
		listener: (slice: unknown) => void;
		equalityFn?: ((prev: unknown, next: unknown) => boolean) | undefined;
		last: unknown;
	}>();

	const getState = () => state;
	const setState = (partial: Partial<typeof state>) => {
		state = { ...state, ...partial };
		for (const listener of externalListeners) {
			listener();
		}
		for (const sub of selectorListeners) {
			const next = sub.selector(state);
			const isEqual = sub.equalityFn
				? sub.equalityFn(sub.last, next)
				: Object.is(sub.last, next);
			if (isEqual) continue;
			sub.last = next;
			sub.listener(next);
		}
	};
	const reset = () => {
		state = createState();
	};
	const subscribeStore = (listener: () => void) => {
		externalListeners.add(listener);
		return () => {
			externalListeners.delete(listener);
		};
	};
	const subscribeSelector = (
		selector: (value: typeof state) => unknown,
		listener: (slice: unknown) => void,
		options?: {
			equalityFn?: (prev: unknown, next: unknown) => boolean;
			fireImmediately?: boolean;
		},
	) => {
		const sub = {
			selector,
			listener,
			equalityFn: options?.equalityFn,
			last: selector(state),
		};
		selectorListeners.add(sub);
		if (options?.fireImmediately) {
			listener(sub.last);
		}
		return () => {
			selectorListeners.delete(sub);
		};
	};

	return {
		renderProbe: {
			count: 0,
		},
		timelineStoreState: {
			getState,
			setState,
			reset,
			subscribeStore,
			subscribeSelector,
		},
	};
});

vi.mock("react-konva", async () => {
	const React = await import("react");
	const DivWithRef = React.forwardRef<
		HTMLDivElement,
		React.HTMLAttributes<HTMLDivElement>
	>(({ children }, ref) => {
		return <div ref={ref}>{children}</div>;
	});
	DivWithRef.displayName = "DivWithRef";
	const PlainDiv: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
		children,
	}) => {
		return <div>{children}</div>;
	};
	return {
		Line: DivWithRef,
		Rect: DivWithRef,
		Layer: PlainDiv,
		Stage: DivWithRef,
		Transformer: DivWithRef,
	};
});

vi.mock("./preview/SkiaPreviewCanvas", () => ({
	SkiaPreviewCanvas: () => <div data-testid="skia-preview-canvas" />,
}));

vi.mock("./preview/LabelLayer", () => ({
	LabelLayer: () => <div data-testid="label-layer" />,
}));

const sharedKonvaTree: unknown[] = [];
vi.mock("./preview/buildSkiaTree", () => ({
	buildKonvaTree: () => sharedKonvaTree,
}));

vi.mock("./contexts/PreviewProvider", () => ({
	usePreview: () => ({
		pictureWidth: 1920,
		pictureHeight: 1080,
		canvasWidth: 1920,
		canvasHeight: 1080,
		zoomLevel: 1,
		setZoomLevel: vi.fn(),
		zoomTransform: "translate3d(0,0,0)",
		setContainerSize: vi.fn(),
		offsetX: 0,
		offsetY: 0,
		pinchState: {
			isPinching: false,
			currentZoom: 1,
		},
		startPinchZoom: vi.fn(),
		updatePinchZoom: vi.fn(),
		endPinchZoom: vi.fn(),
		panOffset: {
			x: 0,
			y: 0,
		},
		setPanOffset: vi.fn(),
		resetPanOffset: vi.fn(),
		setCanvasRef: vi.fn(),
	}),
}));

vi.mock("./preview/usePreviewCoordinates", () => ({
	usePreviewCoordinates: () => {
		renderProbe.count += 1;
		return {
			getEffectiveZoom: () => 1,
			stageToCanvasCoords: () => ({ canvasX: 0, canvasY: 0 }),
			canvasToStageCoords: () => ({ stageX: 0, stageY: 0 }),
		};
	},
}));

vi.mock("./preview/usePreviewInteractions", () => ({
	usePreviewInteractions: () => ({
		stageRef: { current: null },
		transformerRef: { current: null },
		groupProxyRef: { current: null },
		groupProxyBox: null,
		selectedIds: [],
		hoveredId: null,
		draggingId: null,
		snapGuides: { vertical: [], horizontal: [] },
		selectionStageRect: null,
		getTrackIndexForElement: () => 0,
		transformerBoundBoxFunc: (_oldBox: unknown, newBox: unknown) => newBox,
		handleMouseDown: vi.fn(),
		handleMouseUp: vi.fn(),
		handleDragStart: vi.fn(),
		handleDrag: vi.fn(),
		handleDragEnd: vi.fn(),
		handleGroupTransformStart: vi.fn(),
		handleGroupTransform: vi.fn(),
		handleGroupTransformEnd: vi.fn(),
		handleTransformStart: vi.fn(),
		handleTransform: vi.fn(),
		handleTransformEnd: vi.fn(),
		handleMouseEnter: vi.fn(),
		handleMouseLeave: vi.fn(),
		handleStageClick: vi.fn(),
		handleStageMouseDown: vi.fn(),
		handleStageMouseMove: vi.fn(),
		handleStageMouseUp: vi.fn(),
		transformBaseRef: { current: {} },
	}),
}));

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", () => ({
	useTimelineStoreApi: () => ({
		getState: timelineStoreState.getState,
		subscribe: timelineStoreState.subscribeSelector,
	}),
}));

vi.mock("./contexts/TimelineContext", async () => {
	const React = await import("react");

	const useTimelineStore = ((
		selector: (
			state: ReturnType<typeof timelineStoreState.getState>,
		) => unknown,
	) => {
		return React.useSyncExternalStore(
			timelineStoreState.subscribeStore,
			() => selector(timelineStoreState.getState()),
			() => selector(timelineStoreState.getState()),
		);
	}) as unknown as typeof import("./contexts/TimelineContext").useTimelineStore;

	(useTimelineStore as unknown as { getState: () => unknown }).getState =
		timelineStoreState.getState;
	(
		useTimelineStore as unknown as {
			subscribe: (...args: unknown[]) => () => void;
		}
	).subscribe = timelineStoreState.subscribeSelector as (
		...args: unknown[]
	) => () => void;

	return {
		useTimelineStore,
		useTracks: () => ({
			tracks: useTimelineStore((state) => state.tracks as []),
			audioTrackStates: {},
		}),
	};
});

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	timelineStoreState.reset();
	renderProbe.count = 0;

	class ResizeObserverMock {
		observe() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

describe("PreviewEditor render isolation", () => {
	it("播放与时间相关状态变化不会触发 PreviewEditor render", async () => {
		render(<PreviewEditor />);
		await waitFor(() => {
			expect(renderProbe.count).toBeGreaterThan(0);
		});
		const stableRenderCount = renderProbe.count;

		act(() => {
			timelineStoreState.setState({ currentTime: 42 });
			timelineStoreState.setState({ previewTime: 24 });
			timelineStoreState.setState({ fps: 60 });
			timelineStoreState.setState({ isPlaying: true });
		});

		expect(renderProbe.count).toBe(stableRenderCount);
	});
});
