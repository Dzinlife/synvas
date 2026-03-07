// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import {
	canvasPointToTransformPosition,
	transformPositionToCanvasPoint,
} from "core/element/position";
import type { TimelineElement } from "core/element/types";
import type { SceneNode } from "core/studio/types";
import { describe, expect, it } from "vitest";
import { createTimelineStore } from "@/scene-editor/contexts/TimelineContext";
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
	zIndex: 0,
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
): TimelineElement => {
	const { positionX, positionY } = canvasPointToTransformPosition(
		centerX,
		centerY,
		CANVAS_SIZE,
		CANVAS_SIZE,
	);
	return {
		id,
		type: "Image",
		component: "image",
		name: id,
		props: {},
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
				x: 1,
				y: 1,
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
	} as any;
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

const setupInteractions = (elements: TimelineElement[]) => {
	const timelineStore = createTimelineStore();
	timelineStore.getState().setCanvasSize(CANVAS_SIZE);
	timelineStore.getState().setElements(elements, { history: false });
	const renderElementsRef = { current: elements };
	const hook = renderHook(() =>
		useFocusSceneSkiaInteractions({
			width: 1000,
			height: 1000,
			camera: { x: 0, y: 0, zoom: 1 },
			focusedNode,
			sourceWidth: 1000,
			sourceHeight: 1000,
			renderElements: elements,
			renderElementsRef,
			timelineStore,
		}),
	);
	return {
		timelineStore,
		...hook,
	};
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

	it("并列同尺寸元素吸附时会显示全部匹配吸附线", () => {
		const elementA = createElement("element-a", 200, 300);
		const elementB = createElement("element-b", 500, 300);
		const { result } = setupInteractions([elementA, elementB]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(200, 300));
			result.current.onLayerPointerMove(createPointerEvent(497, 300));
		});

		expect(result.current.snapGuidesScreen.vertical.length).toBeGreaterThan(0);
		expect(result.current.snapGuidesScreen.horizontal.length).toBeGreaterThanOrEqual(3);

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
				createPointerEvent(bottomRightHandle.screenX, bottomRightHandle.screenY),
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

		const rotaterHandle = result.current.handleItems.find(
			(item) => item.handle === "rotater",
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
		expect(afterRotate?.transform?.rotation.value ?? 0).toBeCloseTo(90, 0);
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
				createPointerEvent(middleRightHandle.screenX, middleRightHandle.screenY),
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
				createPointerEvent(middleRightHandle.screenX, middleRightHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(middleRightHandle.screenX - 120, middleRightHandle.screenY),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(middleRightHandle.screenX - 120, middleRightHandle.screenY),
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
				createPointerEvent(middleRightHandle.screenX, middleRightHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(middleRightHandle.screenX - 70, middleRightHandle.screenY, {
					altKey: true,
				}),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(middleRightHandle.screenX - 70, middleRightHandle.screenY, {
					altKey: true,
				}),
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
				createPointerEvent(middleRightHandle.screenX, middleRightHandle.screenY),
			);
			result.current.onLayerPointerMove(
				createPointerEvent(middleRightHandle.screenX - 126, middleRightHandle.screenY),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(middleRightHandle.screenX - 126, middleRightHandle.screenY),
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
				createPointerEvent(topLeftHandle.screenX + 120, topLeftHandle.screenY + 120),
			);
			result.current.onLayerPointerUp(
				createPointerEvent(topLeftHandle.screenX + 120, topLeftHandle.screenY + 120),
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

	it("Shift 单次拖拽可从 45° 回吸附到 0°", () => {
		const elementA = createElement("element-a", 300, 300);
		const { result, timelineStore } = setupInteractions([elementA]);

		act(() => {
			result.current.onLayerPointerDown(createPointerEvent(300, 300));
			result.current.onLayerPointerUp(createPointerEvent(300, 300));
		});

		const rotaterHandle = result.current.handleItems.find(
			(item) => item.handle === "rotater",
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
				createPointerEvent(middleRightHandle.screenX, middleRightHandle.screenY),
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

		const rotaterHandle = result.current.handleItems.find(
			(item) => item.handle === "rotater",
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
		expect(
			Math.abs(result.current.selectionFrameScreen?.rotationRad ?? 0),
		).toBeCloseTo(Math.PI / 2, 2);
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
		).toBeCloseTo(Math.PI / 2, 2);
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
		expect(result.current.selectedIds).toEqual([copyElement.id]);
	});
});
