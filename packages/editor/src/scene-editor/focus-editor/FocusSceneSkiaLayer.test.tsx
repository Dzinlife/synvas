// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import {
	canvasPointToTransformPosition,
	transformPositionToCanvasPoint,
} from "core/element/position";
import type { TimelineElement } from "core/element/types";
import type { SceneNode } from "core/studio/types";
import type { SkiaPointerEvent } from "react-skia-lite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { componentRegistry } from "@/element/model/componentRegistry";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "@/scene-editor/runtime/testUtils";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import { useFocusSceneSkiaInteractions } from "./useFocusSceneSkiaInteractions";

const CANVAS_SIZE = { width: 1000, height: 1000 };

const focusedNode: SceneNode = {
	id: "node-scene-1",
	type: "scene",
	name: "Scene 1",
	x: 0,
	y: 0,
	width: 1000,
	height: 1000,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	sceneId: "scene-1",
};

const createElement = (
	id: string,
	centerX: number,
	centerY: number,
	size: { width: number; height: number } = { width: 100, height: 80 },
	options?: {
		type?: TimelineElement["type"];
		component?: string;
		props?: Record<string, unknown>;
		scaleX?: number;
		scaleY?: number;
	},
): TimelineElement => {
	const { positionX, positionY } = canvasPointToTransformPosition(
		centerX,
		centerY,
		CANVAS_SIZE,
		CANVAS_SIZE,
	);
	return {
		id,
		type: options?.type ?? "Image",
		component: options?.component ?? "image",
		name: id,
		props: options?.props ?? {},
		timeline: {
			start: 0,
			end: 300,
			startTimecode: "00:00:00:00",
			endTimecode: "00:00:10:00",
			trackIndex: 0,
			role: "clip",
		},
		transform: {
			baseSize: {
				width: size.width,
				height: size.height,
			},
			position: {
				x: positionX,
				y: positionY,
				space: "canvas",
			},
			anchor: {
				x: 0.5,
				y: 0.5,
				space: "normalized",
			},
			scale: {
				x: options?.scaleX ?? 1,
				y: options?.scaleY ?? 1,
			},
			rotation: {
				value: 0,
				unit: "deg",
			},
		},
		render: {
			zIndex: 0,
			visible: true,
			opacity: 1,
		},
	};
};

const createPointerEvent = (
	x: number,
	y: number,
	patch: Partial<{
		button: number;
		buttons: number;
		shiftKey: boolean;
		altKey: boolean;
		ctrlKey: boolean;
		metaKey: boolean;
	}> = {},
) => {
	return {
		x,
		y,
		button: 0,
		buttons: 1,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		...patch,
	} as unknown as SkiaPointerEvent;
};

const resolveSceneCenter = (element: TimelineElement) => {
	if (!element.transform) {
		return { x: 0, y: 0 };
	}
	const point = transformPositionToCanvasPoint(
		element.transform.position.x,
		element.transform.position.y,
		CANVAS_SIZE,
		CANVAS_SIZE,
	);
	return {
		x: point.canvasX,
		y: point.canvasY,
	};
};

const resolveSceneBox = (element: TimelineElement) => {
	const center = resolveSceneCenter(element);
	const width =
		(element.transform?.baseSize.width ?? 0) *
		Math.abs(element.transform?.scale.x ?? 1);
	const height =
		(element.transform?.baseSize.height ?? 0) *
		Math.abs(element.transform?.scale.y ?? 1);
	return {
		x: center.x - width / 2,
		y: center.y - height / 2,
		width,
		height,
	};
};

const setupInteractions = (initialElements: TimelineElement[]) => {
	useStudioHistoryStore.getState().clear();
	const runtime = createTestEditorRuntime("focus-scene-interactions-test");
	const timelineRef = {
		kind: "scene" as const,
		sceneId: focusedNode.sceneId,
	};
	const timelineRuntime = runtime.ensureTimelineRuntime(timelineRef);
	runtime.setActiveEditTimeline(timelineRef);
	const timelineStore = timelineRuntime.timelineStore;
	timelineStore.getState().setCanvasSize(CANVAS_SIZE);
	timelineStore.getState().setElements(initialElements, { history: false });
	let interactiveElements = initialElements;
	const interactiveElementsRef = { current: interactiveElements };
	const hook = renderHook(
		() =>
			useFocusSceneSkiaInteractions({
				width: 1000,
				height: 1000,
				camera: { x: 0, y: 0, zoom: 1 },
				focusedNode,
				sourceWidth: 1000,
				sourceHeight: 1000,
				interactiveElements,
				interactiveElementsRef,
				timelineStore,
			}),
		{
			wrapper: createRuntimeProviderWrapper(runtime),
		},
	);
	const syncInteractiveElements = (
		nextElements: TimelineElement[] = timelineStore.getState().elements,
	) => {
		interactiveElements = nextElements;
		interactiveElementsRef.current = nextElements;
		hook.rerender();
	};
	return {
		timelineStore,
		modelRegistry: timelineRuntime.modelRegistry,
		syncInteractiveElements,
		...hook,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

const mockTextResizeBehavior = () => {
	vi.spyOn(componentRegistry, "get").mockImplementation((component: string) => {
		if (component === "text") {
			return {
				meta: {
					resizeBehavior: "text-width-reflow",
				},
			} as unknown as ReturnType<typeof componentRegistry.get>;
		}
		return undefined;
	});
};

const createEditableParagraphMock = () => {
	return {
		layout: vi.fn(),
		getHeight: vi.fn(() => 96),
		getGlyphPositionAtCoordinate: vi.fn((x: number) => {
			return Math.max(0, Math.round(x / 10));
		}),
		getRectsForRange: vi.fn((start: number, end: number) => {
			const orderedStart = Math.min(start, end);
			const orderedEnd = Math.max(start, end);
			return [
				{
					x: orderedStart * 10,
					y: 0,
					width: Math.max(0, (orderedEnd - orderedStart) * 10),
					height: 20,
				},
			];
		}),
		getLineMetrics: vi.fn(() => {
			return [
				{
					startIndex: 0,
					endIndex: 10_000,
					endExcludingWhitespaces: 10_000,
					endIncludingNewline: 10_000,
					isHardBreak: false,
					ascent: 16,
					descent: 4,
					height: 20,
					width: 500,
					left: 0,
					baseline: 16,
					lineNumber: 0,
				},
			];
		}),
		getGlyphInfoAt: vi.fn((index: number) => {
			if (index < 0 || index > 10_000) return null;
			return {
				graphemeLayoutBounds: {
					x: index * 10,
					y: 0,
					width: 10,
					height: 20,
				},
				graphemeClusterTextRange: {
					start: index,
					end: index + 1,
				},
				dir: 0,
				isEllipsis: false,
			};
		}),
	};
};

const registerEditableTextModel = (params: {
	modelRegistry: ReturnType<typeof setupInteractions>["modelRegistry"];
	elementId: string;
	paragraph: ReturnType<typeof createEditableParagraphMock>;
}) => {
	const { modelRegistry, elementId, paragraph } = params;
	const mockModelStore = {
		subscribe: () => () => {},
		getState: () =>
			({
				internal: {
					paragraph,
				},
				dispose: () => {},
			}) as unknown,
		setState: () => {},
		getInitialState: () => ({}),
	} as unknown as Parameters<typeof modelRegistry.register>[1];
	modelRegistry.register(elementId, mockModelStore);
};

describe("FocusSceneSkiaLayer interactions", () => {
	it("点击空白区域会取消选择", () => {
		const elementA = createElement("element-a", 200, 200);
		const { result } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(200, 200));
			result.current.onLayerPointerUp(createPointerEvent(200, 200));
		});
		expect(result.current.selectedIds).toEqual(["element-a"]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(920, 920));
			result.current.onLayerPointerUp(createPointerEvent(920, 920));
		});
		expect(result.current.selectedIds).toEqual([]);
	});

	it("支持单选", () => {
		const elementA = createElement("element-a", 200, 200);
		const { result } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(200, 200));
			result.current.onLayerPointerUp(createPointerEvent(200, 200));
		});

		expect(result.current.selectedIds).toEqual(["element-a"]);
	});

	it("支持框选", () => {
		const elementA = createElement("element-a", 200, 200);
		const elementB = createElement("element-b", 760, 200);
		const { result } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(100, 100));
			result.current.onLayerPointerMove(createPointerEvent(360, 320));
			result.current.onLayerPointerUp(createPointerEvent(360, 320));
		});

		expect(result.current.selectedIds).toEqual(["element-a"]);
	});

	it("支持拖拽与吸附线", () => {
		const elementA = createElement("element-a", 200, 200);
		const elementB = createElement("element-b", 500, 200);
		const { result, timelineStore } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(200, 200));
			result.current.onLayerPointerMove(createPointerEvent(497, 200));
		});

		expect(result.current.snapGuidesScreen.vertical.length).toBeGreaterThan(0);

		act(() => {
			result.current.onLayerPointerUp(createPointerEvent(497, 200));
		});

		const movedElement = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		const movedCenter = resolveSceneCenter(movedElement ?? elementA);
		expect(movedCenter.x).toBeCloseTo(500, 2);
		expect(movedCenter.y).toBeCloseTo(200, 2);
	});

	it("move 后 undo 不会出现旧选中框", () => {
		const elementA = createElement("element-a", 200, 200);
		const { result, timelineStore, syncInteractiveElements } =
			setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(200, 200));
			result.current.onLayerPointerUp(createPointerEvent(200, 200));
		});

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(200, 200));
			result.current.onLayerPointerMove(createPointerEvent(500, 200));
			result.current.onLayerPointerUp(createPointerEvent(500, 200));
		});

		act(() => {
			syncInteractiveElements(timelineStore.getState().elements);
		});

		expect(result.current.selectionFrameScreen?.cx ?? 0).toBeCloseTo(500, 2);

		act(() => {
			timelineStore.getState().setElements([elementA], { history: false });
			syncInteractiveElements(timelineStore.getState().elements);
		});

		expect(result.current.selectionFrameScreen?.cx ?? 0).toBeCloseTo(200, 2);
		expect(result.current.selectionFrameScreen?.cy ?? 0).toBeCloseTo(200, 2);
	});

	it("并列同尺寸元素吸附时会显示全部匹配吸附线", () => {
		const elementA = createElement("element-a", 200, 300);
		const elementB = createElement("element-b", 500, 300);
		const { result } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(200, 300));
			result.current.onLayerPointerMove(createPointerEvent(497, 300));
		});

		expect(result.current.snapGuidesScreen.vertical.length).toBeGreaterThan(0);
		expect(
			result.current.snapGuidesScreen.horizontal.length,
		).toBeGreaterThanOrEqual(3);

		act(() => {
			result.current.onLayerPointerUp(createPointerEvent(497, 300));
		});
	});

	it("支持单元素 transform（缩放 + Shift 旋转吸附）", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const bottomRightHandle = result.current.handleItems.find(
			(item) => item.handle === "bottom-right",
		);
		expect(bottomRightHandle).toBeTruthy();
		if (!bottomRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					bottomRightHandle.screenX,
					bottomRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					bottomRightHandle.screenX + 60,
					bottomRightHandle.screenY + 40,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					bottomRightHandle.screenX + 60,
					bottomRightHandle.screenY + 40,
				),
			);
		});

		const afterResize = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect(afterResize?.transform?.scale.x).toBeGreaterThan(1);
		expect(afterResize?.transform?.scale.y).toBeGreaterThan(1);

		const rotaterHandle = result.current.handleItems.find((item) =>
			item.handle.startsWith("rotate-"),
		);
		const selectionFrame = result.current.selectionFrameScreen;
		expect(rotaterHandle).toBeTruthy();
		expect(selectionFrame).toBeTruthy();
		if (!rotaterHandle || !selectionFrame) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(rotaterHandle.screenX, rotaterHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(selectionFrame.cx + 140, selectionFrame.cy, {
					shiftKey: true,
				}),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(selectionFrame.cx + 140, selectionFrame.cy, {
					shiftKey: true,
				}),
			);
		});

		const afterRotate = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		const rotateDeg = Math.abs(afterRotate?.transform?.rotation.value ?? 0);
		const snappedDeg = Math.round(rotateDeg / 45) * 45;
		expect(rotateDeg).toBeGreaterThan(0);
		expect(rotateDeg).toBeCloseTo(snappedDeg, 3);
	});

	it("单选 Text 时仅保留左右边 resize handle", () => {
		mockTextResizeBehavior();
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 100, height: 80 },
			{
				type: "Text",
				component: "text",
			},
		);
		const { result } = setupInteractions([textElement]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const handles = result.current.handleItems.map((item) => item.handle);
		expect(handles).toContain("middle-left");
		expect(handles).toContain("middle-right");
		expect(handles).not.toContain("top-center");
		expect(handles).not.toContain("bottom-center");
		expect(handles).toContain("top-left");
		expect(handles).toContain("bottom-right");
	});

	it("Text 左右 resize 会改 baseSize.width 且保持 scale 不变", () => {
		mockTextResizeBehavior();
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 100, height: 80 },
			{
				type: "Text",
				component: "text",
			},
		);
		const { result, timelineStore } = setupInteractions([textElement]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					middleRightHandle.screenX + 60,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					middleRightHandle.screenX + 60,
					middleRightHandle.screenY,
				),
			);
		});

		const resized = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		expect(resized).toBeTruthy();
		if (!resized?.transform) return;
		expect(resized.transform.baseSize.width).toBeGreaterThan(100);
		expect(resized.transform.scale.x).toBe(1);
		expect(resized.transform.scale.y).toBe(1);
	});

	it("Text 左右 resize 越过中心不会翻转 scaleX", () => {
		mockTextResizeBehavior();
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 100, height: 80 },
			{
				type: "Text",
				component: "text",
			},
		);
		const { result, timelineStore } = setupInteractions([textElement]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					middleRightHandle.screenX - 240,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					middleRightHandle.screenX - 240,
					middleRightHandle.screenY,
				),
			);
		});

		const resized = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		expect(resized).toBeTruthy();
		if (!resized?.transform) return;
		expect(resized.transform.scale.x).toBeGreaterThan(0);
		expect(resized.transform.baseSize.width).toBeGreaterThanOrEqual(5);
	});

	it("Text 左右 resize 拖拽中实时按 paragraph 回写高度", () => {
		mockTextResizeBehavior();
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 100, height: 80 },
			{
				type: "Text",
				component: "text",
			},
		);
		const { result, timelineStore, modelRegistry } = setupInteractions([
			textElement,
		]);
		const paragraph = {
			layout: vi.fn(),
			getHeight: vi.fn(() => 132),
		};
		const mockModelStore = {
			subscribe: () => () => {},
			getState: () =>
				({
					internal: {
						paragraph,
					},
					dispose: () => {},
				}) as unknown,
			setState: () => {},
			getInitialState: () => ({}),
		} as unknown as Parameters<typeof modelRegistry.register>[1];
		modelRegistry.register("text-a", mockModelStore);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					middleRightHandle.screenX + 50,
					middleRightHandle.screenY,
				),
			);
		});

		const resizing = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		expect(resizing).toBeTruthy();
		if (!resizing?.transform) return;
		expect(paragraph.layout).toHaveBeenCalled();
		expect(resizing.transform.baseSize.height).toBe(132);

		act(() => {
			result.current.onLayerPointerUp(
				createPointerEvent(
					middleRightHandle.screenX + 50,
					middleRightHandle.screenY,
				),
			);
		});
	});

	it("Text 角点 resize 仍走 scale 缩放", () => {
		mockTextResizeBehavior();
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 100, height: 80 },
			{
				type: "Text",
				component: "text",
			},
		);
		const { result, timelineStore } = setupInteractions([textElement]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const bottomRightHandle = result.current.handleItems.find(
			(item) => item.handle === "bottom-right",
		);
		expect(bottomRightHandle).toBeTruthy();
		if (!bottomRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					bottomRightHandle.screenX,
					bottomRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					bottomRightHandle.screenX + 40,
					bottomRightHandle.screenY + 30,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					bottomRightHandle.screenX + 40,
					bottomRightHandle.screenY + 30,
				),
			);
		});

		const resized = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		expect(resized).toBeTruthy();
		if (!resized?.transform) return;
		expect(resized.transform.scale.x).toBeGreaterThan(1);
		expect(resized.transform.scale.y).toBeGreaterThan(1);
		expect(resized.transform.baseSize.width).toBe(100);
	});

	it("resize 拖拽中 Alt 按下/松开可立即切换中心缩放", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		const targetX = middleRightHandle.screenX + 40;
		const targetY = middleRightHandle.screenY;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(createPointerEvent(targetX, targetY));
		});
		const afterEdgeResize = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		const edgeCenter = resolveSceneCenter(afterEdgeResize ?? elementA);
		const edgeBox = resolveSceneBox(afterEdgeResize ?? elementA);
		expect(edgeCenter.x).toBeCloseTo(320, 0);
		expect(edgeBox.width).toBeCloseTo(140, 0);

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Alt",
					altKey: true,
					bubbles: true,
				}),
			);
		});
		const afterCenterResize = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		const centerModeCenter = resolveSceneCenter(afterCenterResize ?? elementA);
		const centerModeBox = resolveSceneBox(afterCenterResize ?? elementA);
		expect(centerModeCenter.x).toBeCloseTo(300, 0);
		expect(centerModeBox.width).toBeCloseTo(180, 0);

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keyup", {
					key: "Alt",
					altKey: false,
					bubbles: true,
				}),
			);
		});
		const afterBackToEdge = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		const edgeModeCenter = resolveSceneCenter(afterBackToEdge ?? elementA);
		const edgeModeBox = resolveSceneBox(afterBackToEdge ?? elementA);
		expect(edgeModeCenter.x).toBeCloseTo(320, 0);
		expect(edgeModeBox.width).toBeCloseTo(140, 0);

		act(() => {
			result.current.onLayerPointerUp(createPointerEvent(targetX, targetY));
		});
	});

	it("resize 越过对边会翻转为负 scale", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					middleRightHandle.screenX - 120,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					middleRightHandle.screenX - 120,
					middleRightHandle.screenY,
				),
			);
		});

		const flipped = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect((flipped?.transform?.scale.x ?? 0) < 0).toBe(true);
	});

	it("Alt 中心缩放越过中点会翻转为负 scale", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					middleRightHandle.screenX - 70,
					middleRightHandle.screenY,
					{
						altKey: true,
					},
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					middleRightHandle.screenX - 70,
					middleRightHandle.screenY,
					{
						altKey: true,
					},
				),
			);
		});

		const flipped = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect((flipped?.transform?.scale.x ?? 0) < 0).toBe(true);
	});

	it("越界翻转后仍按拖拽边吸附，而不是中心吸附", () => {
		const elementA = createElement("element-a", 300, 300);
		const elementB = createElement("element-b", 170, 300);
		const { result, timelineStore } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					middleRightHandle.screenX - 126,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					middleRightHandle.screenX - 126,
					middleRightHandle.screenY,
				),
			);
		});

		const flipped = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect(flipped).toBeTruthy();
		if (!flipped) return;
		const flippedBox = resolveSceneBox(flipped);
		expect(flippedBox.x).toBeCloseTo(220, 1);
	});

	it("对角线 resize 越界后位置保持在正确象限", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const topLeftHandle = result.current.handleItems.find(
			(item) => item.handle === "top-left",
		);
		expect(topLeftHandle).toBeTruthy();
		if (!topLeftHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(topLeftHandle.screenX, topLeftHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					topLeftHandle.screenX + 120,
					topLeftHandle.screenY + 120,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					topLeftHandle.screenX + 120,
					topLeftHandle.screenY + 120,
				),
			);
		});

		const flipped = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect(flipped).toBeTruthy();
		if (!flipped) return;
		expect((flipped.transform?.scale.x ?? 0) < 0).toBe(true);
		expect((flipped.transform?.scale.y ?? 0) < 0).toBe(true);
		const box = resolveSceneBox(flipped);
		expect(box.x).toBeCloseTo(350, 1);
		expect(box.y).toBeCloseTo(340, 1);
	});

	it("对角线 resize 会按双轴平均 scale 保持等比", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const topLeftHandle = result.current.handleItems.find(
			(item) => item.handle === "top-left",
		);
		expect(topLeftHandle).toBeTruthy();
		if (!topLeftHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(topLeftHandle.screenX, topLeftHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(
					topLeftHandle.screenX - 30,
					topLeftHandle.screenY - 20,
				),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(
					topLeftHandle.screenX - 30,
					topLeftHandle.screenY - 20,
				),
			);
		});

		const resized = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect(resized).toBeTruthy();
		if (!resized) return;
		const box = resolveSceneBox(resized);
		expect(box.x).toBeCloseTo(222.5, 1);
		expect(box.y).toBeCloseTo(238, 1);
		expect(box.width).toBeCloseTo(127.5, 1);
		expect(box.height).toBeCloseTo(102, 1);
	});

	it("Shift 单次拖拽可从 45° 回吸附到 0°", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const rotaterHandle = result.current.handleItems.find((item) =>
			item.handle.startsWith("rotate-"),
		);
		const selectionFrame = result.current.selectionFrameScreen;
		expect(rotaterHandle).toBeTruthy();
		expect(selectionFrame).toBeTruthy();
		if (!rotaterHandle || !selectionFrame) return;

		const radius = Math.hypot(
			rotaterHandle.screenX - selectionFrame.cx,
			rotaterHandle.screenY - selectionFrame.cy,
		);
		const startAngle = Math.atan2(
			rotaterHandle.screenY - selectionFrame.cy,
			rotaterHandle.screenX - selectionFrame.cx,
		);
		const pointerDown = {
			x: rotaterHandle.screenX + 8,
			y: rotaterHandle.screenY - 3,
		};
		const point45 = {
			x: selectionFrame.cx + Math.cos(startAngle + Math.PI / 4) * radius,
			y: selectionFrame.cy + Math.sin(startAngle + Math.PI / 4) * radius,
		};
		const point0 = {
			x: selectionFrame.cx + Math.cos(startAngle) * radius,
			y: selectionFrame.cy + Math.sin(startAngle) * radius,
		};

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(pointerDown.x, pointerDown.y),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(point45.x, point45.y, { shiftKey: true }),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(point0.x, point0.y, { shiftKey: true }),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(point0.x, point0.y, { shiftKey: true }),
			);
		});

		const afterRotate = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect(afterRotate?.transform?.rotation.value ?? 0).toBeCloseTo(0, 0);
	});

	it("支持 resize 吸附", () => {
		const elementA = createElement("element-a", 300, 300);
		const elementB = createElement("element-b", 500, 300);
		const { result, timelineStore } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const middleRightHandle = result.current.handleItems.find(
			(item) => item.handle === "middle-right",
		);
		expect(middleRightHandle).toBeTruthy();
		if (!middleRightHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(
					middleRightHandle.screenX,
					middleRightHandle.screenY,
				),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(448, middleRightHandle.screenY),
			);
		});
		expect(result.current.snapGuidesScreen.vertical.length).toBeGreaterThan(0);

		act(() => {
			result.current.onLayerPointerUp(
				createPointerEvent(448, middleRightHandle.screenY),
			);
		});

		const resizedElement = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect(resizedElement).toBeTruthy();
		if (!resizedElement) return;
		const box = resolveSceneBox(resizedElement);
		expect(box.x + box.width).toBeCloseTo(450, 2);
	});

	it("Alt 对角线中心缩放吸附后保持等比", () => {
		const elementA = createElement("element-a", 300, 300);
		const elementB = createElement("element-b", 450, 700);
		const { result, timelineStore } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const topLeftHandle = result.current.handleItems.find(
			(item) => item.handle === "top-left",
		);
		expect(topLeftHandle).toBeTruthy();
		if (!topLeftHandle) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(topLeftHandle.screenX, topLeftHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(198, 220, { altKey: true }),
			);
		});
		expect(result.current.snapGuidesScreen.vertical.length).toBeGreaterThan(0);

		act(() => {
			result.current.onLayerPointerUp(
				createPointerEvent(198, 220, { altKey: true }),
			);
		});

		const resizedElement = timelineStore
			.getState()
			.elements.find((item) => item.id === "element-a");
		expect(resizedElement?.transform).toBeTruthy();
		if (!resizedElement?.transform) return;
		expect(Math.abs(resizedElement.transform.scale.x)).toBeCloseTo(
			Math.abs(resizedElement.transform.scale.y),
			3,
		);
		const box = resolveSceneBox(resizedElement);
		expect(box.width / box.height).toBeCloseTo(100 / 80, 3);
	});

	it("多选旋转后在 selection 变化前保持旋转框", () => {
		const elementA = createElement("element-a", 260, 300);
		const elementB = createElement("element-b", 420, 300);
		const { result } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(260, 300));
			result.current.onLayerPointerUp(createPointerEvent(260, 300));
			result.current.onLayerPointerDown(
				createPointerEvent(420, 300, { ctrlKey: true }),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(420, 300, { ctrlKey: true }),
			);
		});
		expect(result.current.selectedIds).toHaveLength(2);

		const rotaterHandle = result.current.handleItems.find((item) =>
			item.handle.startsWith("rotate-"),
		);
		const selectionFrame = result.current.selectionFrameScreen;
		expect(rotaterHandle).toBeTruthy();
		expect(selectionFrame).toBeTruthy();
		if (!rotaterHandle || !selectionFrame) return;

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(rotaterHandle.screenX, rotaterHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(selectionFrame.cx + 200, selectionFrame.cy, {
					shiftKey: true,
				}),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(selectionFrame.cx + 200, selectionFrame.cy, {
					shiftKey: true,
				}),
			);
		});

		expect(result.current.selectedIds).toHaveLength(2);
		expect(result.current.selectionFrameScreen).toBeTruthy();
		const rotatedRad = Math.abs(
			result.current.selectionFrameScreen?.rotationRad ?? 0,
		);
		const snappedRad = Math.round(rotatedRad / (Math.PI / 4)) * (Math.PI / 4);
		expect(rotatedRad).toBeGreaterThan(0);
		expect(rotatedRad).toBeCloseTo(snappedRad, 2);
		const frameAfterRotate = result.current.selectionFrameScreen;
		expect(frameAfterRotate).toBeTruthy();
		if (!frameAfterRotate) return;

		const dragHitLayout = result.current.elementLayouts.find(
			(item) => item.id === "element-a",
		);
		expect(dragHitLayout).toBeTruthy();
		if (!dragHitLayout) return;
		const hitX = dragHitLayout.frameScreen.cx;
		const hitY = dragHitLayout.frameScreen.cy;

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(hitX, hitY));
			result.current.onLayerPointerMove(
				createPointerEvent(hitX + 120, hitY + 40),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(hitX + 120, hitY + 40),
			);
		});

		expect(result.current.selectedIds).toHaveLength(2);
		expect(
			Math.abs(result.current.selectionFrameScreen?.rotationRad ?? 0),
		).toBeCloseTo(rotatedRad, 2);
		expect(result.current.selectionFrameScreen?.cx ?? 0).toBeGreaterThan(
			frameAfterRotate.cx + 100,
		);
	});

	it("支持 Alt 复制拖拽", () => {
		const elementA = createElement("element-a", 240, 240);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(
				createPointerEvent(240, 240, {
					altKey: true,
				}),
			);
			result.current.onLayerPointerMove(createPointerEvent(340, 320));
			result.current.onLayerPointerUp(createPointerEvent(340, 320));
		});

		const elements = timelineStore.getState().elements;
		expect(elements).toHaveLength(2);
		const copyElement = elements.find((item) => item.id !== "element-a");
		expect(copyElement).toBeTruthy();
		if (!copyElement) return;
		const copyCenter = resolveSceneCenter(copyElement);
		expect(copyCenter.x).toBeCloseTo(340, 2);
		expect(copyCenter.y).toBeCloseTo(320, 2);
		expect(copyElement.timeline.trackIndex).toBe(1);
		expect(result.current.selectedIds).toEqual([copyElement.id]);
	});

	it("双击 Text 元素进入编辑，双击非 Text 不进入", () => {
		const textElement = createElement(
			"text-a",
			260,
			260,
			{ width: 120, height: 80 },
			{
				type: "Text",
				component: "text",
				props: {
					text: "hello",
				},
			},
		);
		const imageElement = createElement("image-a", 560, 260);
		const { result, modelRegistry } = setupInteractions([
			textElement,
			imageElement,
		]);
		registerEditableTextModel({
			modelRegistry,
			elementId: "text-a",
			paragraph: createEditableParagraphMock(),
		});

		act(() => {
			result.current.onLayerDoubleClick(createPointerEvent(560, 260));
		});
		expect(result.current.editingElementId).toBe(null);

		act(() => {
			result.current.onLayerDoubleClick(createPointerEvent(260, 260));
		});
		expect(result.current.editingElementId).toBe("text-a");
		expect(result.current.textEditingBridgeState?.value).toBe("hello");
	});

	it("编辑中拖拽生成选区，输入会实时回写 text 与 reflow 高度", () => {
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 120, height: 80 },
			{
				type: "Text",
				component: "text",
				props: {
					text: "hello",
				},
			},
		);
		const { result, timelineStore, modelRegistry } = setupInteractions([
			textElement,
		]);
		const paragraph = createEditableParagraphMock();
		paragraph.getHeight.mockReturnValue(132);
		registerEditableTextModel({
			modelRegistry,
			elementId: "text-a",
			paragraph,
		});

		act(() => {
			result.current.onLayerDoubleClick(createPointerEvent(300, 300));
		});
		expect(result.current.editingElementId).toBe("text-a");

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(260, 300));
			result.current.onLayerPointerMove(createPointerEvent(320, 300));
			result.current.onLayerPointerUp(createPointerEvent(320, 300));
		});

		const currentSelection = result.current.textEditingBridgeState?.selection;
		expect(currentSelection).toBeTruthy();
		if (currentSelection) {
			expect(
				Math.max(currentSelection.start, currentSelection.end),
			).toBeGreaterThan(Math.min(currentSelection.start, currentSelection.end));
		}

		act(() => {
			result.current.textEditingBridgeState?.onValueChange("hello world", {
				start: 11,
				end: 11,
				direction: "none",
			});
		});

		const updatedElement = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		expect(updatedElement).toBeTruthy();
		if (!updatedElement?.transform) return;
		expect((updatedElement.props as { text?: string }).text).toBe(
			"hello world",
		);
		expect(updatedElement.transform.baseSize.height).toBe(132);
	});

	it("编辑会话提交只产生一条历史记录，取消会回滚且不记历史", () => {
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 120, height: 80 },
			{
				type: "Text",
				component: "text",
				props: {
					text: "hello",
				},
			},
		);
		const { result, timelineStore, modelRegistry } = setupInteractions([
			textElement,
		]);
		const paragraph = createEditableParagraphMock();
		paragraph.getHeight.mockReturnValue(140);
		registerEditableTextModel({
			modelRegistry,
			elementId: "text-a",
			paragraph,
		});

		const historyPushSpy = vi.spyOn(useStudioHistoryStore.getState(), "push");

		act(() => {
			result.current.onLayerDoubleClick(createPointerEvent(300, 300));
		});
		act(() => {
			result.current.textEditingBridgeState?.onValueChange("hello commit", {
				start: 12,
				end: 12,
				direction: "none",
			});
		});
		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(920, 920));
		});
		act(() => {
			result.current.onLayerPointerUp(createPointerEvent(920, 920));
		});

		expect(result.current.editingElementId).toBe(null);
		expect(historyPushSpy).toHaveBeenCalledTimes(1);
		const committedElement = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		expect((committedElement?.props as { text?: string })?.text).toBe(
			"hello commit",
		);

		act(() => {
			result.current.onLayerDoubleClick(createPointerEvent(300, 300));
		});
		act(() => {
			result.current.textEditingBridgeState?.onValueChange("will cancel", {
				start: 11,
				end: 11,
				direction: "none",
			});
		});
		act(() => {
			result.current.textEditingBridgeState?.onCancel();
		});

		expect(result.current.editingElementId).toBe(null);
		expect(historyPushSpy).toHaveBeenCalledTimes(1);
		const cancelledElement = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		expect((cancelledElement?.props as { text?: string })?.text).toBe(
			"hello commit",
		);
		expect(cancelledElement?.transform?.baseSize.height).toBe(140);
	});

	it("编辑中不会触发元素拖拽", () => {
		const textElement = createElement(
			"text-a",
			300,
			300,
			{ width: 120, height: 80 },
			{
				type: "Text",
				component: "text",
				props: {
					text: "drag-guard",
				},
			},
		);
		const { result, timelineStore, modelRegistry } = setupInteractions([
			textElement,
		]);
		registerEditableTextModel({
			modelRegistry,
			elementId: "text-a",
			paragraph: createEditableParagraphMock(),
		});
		const beforeCenter = resolveSceneCenter(textElement);

		act(() => {
			result.current.onLayerDoubleClick(createPointerEvent(300, 300));
		});
		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerMove(createPointerEvent(420, 360));
			result.current.onLayerPointerUp(createPointerEvent(420, 360));
		});

		const afterElement = timelineStore
			.getState()
			.elements.find((item) => item.id === "text-a");
		const afterCenter = resolveSceneCenter(afterElement ?? textElement);
		expect(afterCenter.x).toBeCloseTo(beforeCenter.x, 3);
		expect(afterCenter.y).toBeCloseTo(beforeCenter.y, 3);
	});
});
