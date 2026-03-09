// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import type { StudioProject, VideoCanvasNode } from "core/studio/types";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import { NodeInteractionWrapper } from "./NodeInteractionWrapper";

const { rootRenderSpy } = vi.hoisted(() => ({
	rootRenderSpy: vi.fn(),
}));
const {
	focusLayerPointerDownSpy,
	focusLayerPointerMoveSpy,
	focusLayerPointerUpSpy,
	focusLayerPointerLeaveSpy,
} = vi.hoisted(() => ({
	focusLayerPointerDownSpy: vi.fn(),
	focusLayerPointerMoveSpy: vi.fn(),
	focusLayerPointerUpSpy: vi.fn(),
	focusLayerPointerLeaveSpy: vi.fn(),
}));
const { focusLayerMockState } = vi.hoisted(() => ({
	focusLayerMockState: {
		handleItems: [] as Array<{
			id: string;
			handle: string;
			kind: string;
			screenX: number;
			screenY: number;
			rectLocal: {
				x: number;
				y: number;
				width: number;
				height: number;
			};
			cursor: string;
			visibleCornerMarker: boolean;
		}>,
		activeHandle: null as string | null,
		selectedIds: [] as string[],
		selectionFrameScreen: null as {
			cx: number;
			cy: number;
			width: number;
			height: number;
			rotationRad: number;
		} | null,
	},
}));

vi.mock("@use-gesture/react", () => ({
	useDrag: (handler: (state: Record<string, unknown>) => void) => {
		return () => ({
			onPointerDown: (event: Record<string, unknown>) => {
				const clientX = Number(event.clientX ?? 0);
				const clientY = Number(event.clientY ?? 0);
				handler({
					first: true,
					last: false,
					tap: false,
					movement: [0, 0],
					xy: [clientX, clientY],
					event: {
						button: Number(event.button ?? 0),
						buttons: Number(event.buttons ?? 1),
					},
				});
				handler({
					first: false,
					last: false,
					tap: false,
					movement: [12, 8],
					xy: [clientX + 12, clientY + 8],
					event: {
						button: Number(event.button ?? 0),
						buttons: Number(event.buttons ?? 1),
					},
				});
				handler({
					first: false,
					last: true,
					tap: false,
					movement: [12, 8],
					xy: [clientX + 12, clientY + 8],
					event: {
						button: Number(event.button ?? 0),
						buttons: 0,
					},
				});
			},
		});
	},
}));

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

	return {
		Canvas,
		Group: "group",
		Rect: "rect",
		Path: "path",
		Shader: "shader",
		Skia: {
			RuntimeEffect: {
				Make: () => ({ type: "runtime-effect" }),
			},
		},
	};
});

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", () => ({
	useStudioRuntimeManager: () => ({}),
}));

vi.mock("./useFocusSceneTimelineElements", () => ({
	useFocusSceneTimelineElements: ({ sceneId }: { sceneId: string | null }) => ({
		runtime: sceneId ? ({ timelineStore: {} } as any) : null,
		renderElements: [],
		renderElementsRef: { current: [] },
		sourceWidth: 1920,
		sourceHeight: 1080,
	}),
}));

vi.mock("./useFocusSceneSkiaInteractions", () => ({
	useFocusSceneSkiaInteractions: () => ({
		elementLayouts: [],
		selectedIds: focusLayerMockState.selectedIds,
		hoveredId: null,
		draggingId: null,
		selectionRectScreen: null,
		snapGuidesScreen: { vertical: [], horizontal: [] },
		selectionFrameScreen: focusLayerMockState.selectionFrameScreen,
		handleItems: focusLayerMockState.handleItems,
		activeHandle: focusLayerMockState.activeHandle,
		labelItems: [],
		onLayerPointerDown: focusLayerPointerDownSpy,
		onLayerPointerMove: focusLayerPointerMoveSpy,
		onLayerPointerUp: focusLayerPointerUpSpy,
		onLayerPointerLeave: focusLayerPointerLeaveSpy,
	}),
}));

vi.mock("./node-system/registry", () => ({
	getCanvasNodeDefinition: () => ({
		skiaRenderer: () => null,
	}),
}));

type AnyElement = React.ReactElement<Record<string, any>, any>;

const isElement = (node: React.ReactNode): node is AnyElement => {
	return React.isValidElement(node);
};

const collectElements = (
	node: React.ReactNode,
	predicate: (element: AnyElement) => boolean,
): AnyElement[] => {
	const result: AnyElement[] = [];

	const walk = (current: React.ReactNode) => {
		if (!current) return;
		if (Array.isArray(current)) {
			for (const item of current) {
				walk(item);
			}
			return;
		}
		if (!isElement(current)) return;

		if (predicate(current)) {
			result.push(current);
		}
		walk(current.props.children as React.ReactNode);
	};

	walk(node);
	return result;
};

const getLatestRenderTree = (): React.ReactNode => {
	const latestCall = rootRenderSpy.mock.calls.at(-1);
	if (!latestCall) {
		throw new Error("未捕获到 Skia render 调用");
	}
	return latestCall[0] as React.ReactNode;
};

const collectAnchorGroups = (tree: React.ReactNode): AnyElement[] => {
	const directGroups = collectElements(
		tree,
		(element) =>
			element.type === "group" &&
			Boolean(element.props.hitRect) &&
			typeof element.props.onPointerDown === "function" &&
			collectElements(
				element.props.children as React.ReactNode,
				(child) => child.type === "path",
			).length > 0,
	);
	const overlayElement = collectElements(
		tree,
		(element) => element.type === CanvasNodeOverlayLayer,
	)[0];
	if (!overlayElement || typeof overlayElement.type !== "function") {
		return directGroups;
	}
	const overlayTree = overlayElement.type(
		overlayElement.props as Record<string, unknown>,
	);
	const overlayGroups = collectElements(
		overlayTree,
		(element) =>
			element.type === "group" &&
			Boolean(element.props.hitRect) &&
			typeof element.props.onPointerDown === "function" &&
			collectElements(
				element.props.children as React.ReactNode,
				(child) => child.type === "path",
			).length > 0,
	);
	return [...directGroups, ...overlayGroups];
};

const createVideoNode = (
	id: string,
	zIndex: number,
	patch: Partial<VideoCanvasNode> = {},
): VideoCanvasNode => ({
	id,
	type: "video",
	name: id,
	x: 20,
	y: 30,
	width: 160,
	height: 90,
	zIndex,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: `${id}-asset`,
	...patch,
});

const createSceneNode = (id: string, zIndex: number) => ({
	id,
	type: "scene" as const,
	name: id,
	x: 20,
	y: 30,
	width: 320,
	height: 180,
	zIndex,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	sceneId: "scene-1",
});

const emptyScenes: StudioProject["scenes"] = {};

describe("InfiniteSkiaCanvas", () => {
	beforeEach(() => {
		rootRenderSpy.mockReset();
		focusLayerPointerDownSpy.mockReset();
		focusLayerPointerMoveSpy.mockReset();
		focusLayerPointerUpSpy.mockReset();
		focusLayerPointerLeaveSpy.mockReset();
		focusLayerMockState.handleItems = [];
		focusLayerMockState.activeHandle = null;
		focusLayerMockState.selectedIds = [];
		focusLayerMockState.selectionFrameScreen = null;
	});

	it("active 节点渲染四个 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(4);
		const cursors = anchorGroups.map((group) => group.props.cursor);
		expect(cursors.filter((cursor) => cursor === "nwse-resize")).toHaveLength(2);
		expect(cursors.filter((cursor) => cursor === "nesw-resize")).toHaveLength(2);
	});

	it("locked active 节点不渲染 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0, { locked: true })]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(0);
	});

	it("focus 状态下不显示 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId="node-a"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(0);
	});

	it("focus scene 模式会抑制普通 node 交互并接管 Focus 层事件", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createSceneNode("node-scene", 0), createVideoNode("node-video", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-scene"
				focusedNodeId="node-scene"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const wrappers = collectElements(
			tree,
			(element) => element.type === NodeInteractionWrapper,
		);
		expect(wrappers).toHaveLength(2);
		expect(wrappers.every((wrapper) => wrapper.props.disabled === true)).toBe(
			true,
		);

		const focusLayer = collectElements(
			tree,
			(element) => element.props.onLayerPointerDown === focusLayerPointerDownSpy,
		)[0];
		expect(focusLayer).toBeTruthy();

		act(() => {
			focusLayer?.props.onLayerPointerDown?.({
				x: 240,
				y: 120,
				button: 0,
				buttons: 1,
			});
		});
		expect(focusLayerPointerDownSpy).toHaveBeenCalledTimes(1);
	});

	it("focus resize handles 会携带对应 cursor", async () => {
		focusLayerMockState.handleItems = [
			{
				id: "rotate-top-left",
				handle: "rotate-top-left",
				kind: "rotate-corner",
				screenX: 90,
				screenY: 90,
				rectLocal: { x: -55, y: -55, width: 10, height: 10 },
				cursor: "rotate-cursor-top-left",
				visibleCornerMarker: false,
			},
			{
				id: "rotate-top-right",
				handle: "rotate-top-right",
				kind: "rotate-corner",
				screenX: 190,
				screenY: 90,
				rectLocal: { x: 45, y: -55, width: 10, height: 10 },
				cursor: "rotate-cursor-top-right",
				visibleCornerMarker: false,
			},
			{
				id: "rotate-bottom-right",
				handle: "rotate-bottom-right",
				kind: "rotate-corner",
				screenX: 190,
				screenY: 190,
				rectLocal: { x: 45, y: 45, width: 10, height: 10 },
				cursor: "rotate-cursor-bottom-right",
				visibleCornerMarker: false,
			},
			{
				id: "rotate-bottom-left",
				handle: "rotate-bottom-left",
				kind: "rotate-corner",
				screenX: 90,
				screenY: 190,
				rectLocal: { x: -55, y: 45, width: 10, height: 10 },
				cursor: "rotate-cursor-bottom-left",
				visibleCornerMarker: false,
			},
			{
				id: "top-left",
				handle: "top-left",
				kind: "resize-corner",
				screenX: 100,
				screenY: 100,
				rectLocal: { x: -44, y: -44, width: 8, height: 8 },
				cursor: "nwse-resize",
				visibleCornerMarker: true,
			},
			{
				id: "top-right",
				handle: "top-right",
				kind: "resize-corner",
				screenX: 180,
				screenY: 100,
				rectLocal: { x: 36, y: -44, width: 8, height: 8 },
				cursor: "nesw-resize",
				visibleCornerMarker: true,
			},
			{
				id: "bottom-right",
				handle: "bottom-right",
				kind: "resize-corner",
				screenX: 180,
				screenY: 180,
				rectLocal: { x: 36, y: 36, width: 8, height: 8 },
				cursor: "nwse-resize",
				visibleCornerMarker: true,
			},
			{
				id: "bottom-left",
				handle: "bottom-left",
				kind: "resize-corner",
				screenX: 100,
				screenY: 180,
				rectLocal: { x: -44, y: 36, width: 8, height: 8 },
				cursor: "nesw-resize",
				visibleCornerMarker: true,
			},
			{
				id: "top-center",
				handle: "top-center",
				kind: "resize-edge",
				screenX: 140,
				screenY: 100,
				rectLocal: { x: -40, y: -43, width: 80, height: 6 },
				cursor: "ns-resize",
				visibleCornerMarker: false,
			},
			{
				id: "middle-right",
				handle: "middle-right",
				kind: "resize-edge",
				screenX: 180,
				screenY: 140,
				rectLocal: { x: 37, y: -40, width: 6, height: 80 },
				cursor: "ew-resize",
				visibleCornerMarker: false,
			},
			{
				id: "bottom-center",
				handle: "bottom-center",
				kind: "resize-edge",
				screenX: 140,
				screenY: 180,
				rectLocal: { x: -40, y: 37, width: 80, height: 6 },
				cursor: "ns-resize",
				visibleCornerMarker: false,
			},
			{
				id: "middle-left",
				handle: "middle-left",
				kind: "resize-edge",
				screenX: 100,
				screenY: 140,
				rectLocal: { x: -43, y: -40, width: 6, height: 80 },
				cursor: "ew-resize",
				visibleCornerMarker: false,
			},
		];
		focusLayerMockState.selectedIds = ["element-a"];
		focusLayerMockState.selectionFrameScreen = {
			cx: 140,
			cy: 140,
			width: 80,
			height: 80,
			rotationRad: 0,
		};

		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createSceneNode("node-scene", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-scene"
				focusedNodeId="node-scene"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const focusLayerElement = collectElements(
			tree,
			(element) => element.props.onLayerPointerDown === focusLayerPointerDownSpy,
		)[0];
		expect(focusLayerElement).toBeTruthy();
		if (!focusLayerElement) return;
		const focusLayerRender =
			typeof focusLayerElement.type === "function"
				? focusLayerElement.type(
						focusLayerElement.props as Record<string, unknown>,
					)
				: null;
		const anchorHitRects = collectElements(
			focusLayerRender,
			(element) =>
				element.type === "rect" &&
				String(element.key ?? "").includes("focus-scene-anchor-hit-") &&
				typeof element.props.cursor === "string",
		);
		const visibleCornerMarkers = collectElements(
			focusLayerRender,
			(element) =>
				element.type === "rect" &&
				String(element.key ?? "").includes("focus-scene-corner-marker-") &&
				!String(element.key ?? "").includes("border"),
		);

		const cursorByAnchorId = new Map<string, string>();
		for (const rect of anchorHitRects) {
			const rawKey = String(rect.key ?? "");
			const anchorId = rawKey
				.replace(/^.*focus-scene-anchor-hit-/, "")
				.replace(/-\d+$/, "");
			if (!cursorByAnchorId.has(anchorId)) {
				cursorByAnchorId.set(anchorId, rect.props.cursor as string);
			}
		}
		expect(visibleCornerMarkers).toHaveLength(4);
		expect(cursorByAnchorId).toEqual(
			new Map<string, string>([
				["rotate-top-left", "rotate-cursor-top-left"],
				["rotate-top-right", "rotate-cursor-top-right"],
				["rotate-bottom-right", "rotate-cursor-bottom-right"],
				["rotate-bottom-left", "rotate-cursor-bottom-left"],
				["top-left", "nwse-resize"],
				["top-center", "ns-resize"],
				["top-right", "nesw-resize"],
				["middle-left", "ew-resize"],
				["middle-right", "ew-resize"],
				["bottom-left", "nesw-resize"],
				["bottom-center", "ns-resize"],
				["bottom-right", "nwse-resize"],
			]),
		);
		const rotateCursors = [
			cursorByAnchorId.get("rotate-top-left"),
			cursorByAnchorId.get("rotate-top-right"),
			cursorByAnchorId.get("rotate-bottom-right"),
			cursorByAnchorId.get("rotate-bottom-left"),
		];
		expect(rotateCursors.every((cursor) => typeof cursor === "string")).toBe(true);
		expect(new Set(rotateCursors).size).toBe(4);
		expect(
			rotateCursors.some((cursor) => /grab|hand/i.test(String(cursor))),
		).toBe(false);
	});

	it("anchor pointer down 会透传 resize start/drag/end 回调并包含 anchor", async () => {
		const onNodeResizeStart = vi.fn();
		const onNodeResize = vi.fn();
		const onNodeResizeEnd = vi.fn();

		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
				onNodeResizeStart={onNodeResizeStart}
				onNodeResize={onNodeResize}
				onNodeResizeEnd={onNodeResizeEnd}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(4);

		act(() => {
			anchorGroups[0]?.props.onPointerDown?.({
				button: 0,
				buttons: 1,
				clientX: 120,
				clientY: 80,
			});
		});

		expect(onNodeResizeStart).toHaveBeenCalled();
		expect(onNodeResize).toHaveBeenCalled();
		expect(onNodeResizeEnd).toHaveBeenCalled();
		expect(onNodeResizeStart.mock.calls[0]?.[0]?.id).toBe("node-a");
		expect(onNodeResizeStart.mock.calls[0]?.[1]).toBe("top-left");
	});

});
