// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import type { StudioProject, VideoCanvasNode } from "core/studio/types";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeLabelLayer } from "./CanvasNodeLabelLayer";
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
		Image: "image",
		Rect: "rect",
		RoundedRect: "rrect",
		Text: "text",
		Path: "path",
		Shader: "shader",
		useFont: () => ({
			getTextWidth: (text: string) => text.length * 6,
			getMetrics: () => ({
				ascent: -9,
				descent: 2,
				leading: 0,
			}),
		}),
		Skia: {
			RuntimeEffect: {
				Make: () => ({ type: "runtime-effect" }),
			},
			Font: () => ({
				getTextWidth: (text: string) => text.length * 6,
				getMetrics: () => ({
					ascent: -9,
					descent: 2,
					leading: 0,
				}),
			}),
		},
	};
});

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", () => ({
	useStudioRuntimeManager: () => ({}),
}));

vi.mock("@/scene-editor/focus-editor/useSceneFocusEditorLayer", () => ({
	useSceneFocusEditorLayer: ({
		width,
		height,
		focusedNode,
		suspendHover,
	}: {
		width: number;
		height: number;
		focusedNode: { id: string; type: string } | null;
		suspendHover?: boolean;
	}) => {
		const enabled = Boolean(focusedNode);
		return {
			enabled,
			layerProps: enabled
				? {
						width,
						height,
						elements: [],
						selectedIds: focusLayerMockState.selectedIds,
						hoveredId: null,
						draggingId: null,
						selectionRectScreen: null,
						snapGuidesScreen: { vertical: [], horizontal: [] },
						selectionFrameScreen: focusLayerMockState.selectionFrameScreen,
						handleItems: focusLayerMockState.handleItems,
						activeHandle: focusLayerMockState.activeHandle,
						labelItems: [],
						disabled: suspendHover ?? false,
						onLayerPointerDown: focusLayerPointerDownSpy,
						onLayerPointerMove: focusLayerPointerMoveSpy,
						onLayerPointerUp: focusLayerPointerUpSpy,
						onLayerPointerLeave: focusLayerPointerLeaveSpy,
					}
				: null,
		};
	},
}));

vi.mock("./node-system/registry", async () => {
	const { FocusSceneSkiaLayer } = await import(
		"@/scene-editor/focus-editor/FocusSceneSkiaLayer"
	);
	const { SceneFocusEditorBridge } = await import(
		"@/scene-editor/focus-editor/SceneFocusEditorBridge"
	);
	return {
		getCanvasNodeDefinition: (type: string) => ({
			skiaRenderer: () => null,
			focusEditorLayer: type === "scene" ? FocusSceneSkiaLayer : undefined,
			focusEditorBridge: type === "scene" ? SceneFocusEditorBridge : undefined,
		}),
	};
});

type AnyElement = React.ReactElement<
	Record<string, unknown>,
	React.ElementType
>;

const getElementProps = <T extends Record<string, unknown>>(
	element: AnyElement | null | undefined,
): T | null => {
	if (!element) return null;
	return element.props as T;
};

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

const getOverlayElement = (tree: React.ReactNode): AnyElement | null => {
	return (
		collectElements(
			tree,
			(element) => element.type === CanvasNodeOverlayLayer,
		)[0] ?? null
	);
};

const getLabelLayerElement = (tree: React.ReactNode): AnyElement | null => {
	return (
		collectElements(
			tree,
			(element) => element.type === CanvasNodeLabelLayer,
		)[0] ?? null
	);
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
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		const overlayProps = getElementProps<{
			activeNode?: { id: string };
			hoverNode?: { id: string } | null;
		}>(overlayElement);
		expect(overlayElement).toBeTruthy();
		expect(overlayProps?.activeNode?.id).toBe("node-a");
		expect(overlayProps?.hoverNode ?? null).toBeNull();
	});

	it("会把 snapGuidesScreen 透传给 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				snapGuidesScreen={{ vertical: [320], horizontal: [180] }}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const overlayProps = getElementProps<{
			snapGuidesScreen?: {
				vertical: number[];
				horizontal: number[];
			};
		}>(getOverlayElement(getLatestRenderTree()));
		expect(overlayProps?.snapGuidesScreen).toEqual({
			vertical: [320],
			horizontal: [180],
		});
	});

	it("hover 节点会透传到 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0), createVideoNode("node-b", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		const initialRenderCount = rootRenderSpy.mock.calls.length;
		const tree = getLatestRenderTree();
		const wrappers = collectElements(
			tree,
			(element) => element.type === NodeInteractionWrapper,
		);
		const targetWrapper = wrappers.find(
			(wrapper) =>
				getElementProps<{ node?: { id: string } }>(wrapper)?.node?.id ===
				"node-b",
		);
		expect(targetWrapper).toBeTruthy();
		const targetWrapperProps = getElementProps<{
			onPointerEnter?: (nodeId: string) => void;
		}>(targetWrapper);

		act(() => {
			targetWrapperProps?.onPointerEnter?.("node-b");
		});

		await waitFor(() => {
			expect(rootRenderSpy.mock.calls.length).toBeGreaterThan(
				initialRenderCount,
			);
		});

		const nextTree = getLatestRenderTree();
		const overlayElement = getOverlayElement(nextTree);
		const overlayProps = getElementProps<{
			activeNode?: { id: string };
			hoverNode?: { id: string } | null;
		}>(overlayElement);
		expect(overlayElement).toBeTruthy();
		expect(overlayProps?.activeNode?.id).toBe("node-a");
		expect(overlayProps?.hoverNode?.id).toBe("node-b");
	});

	it("多选状态会透传到 wrapper 与 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[
					createVideoNode("node-a", 0),
					createVideoNode("node-b", 1),
					createVideoNode("node-c", 2),
				]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-b"
				selectedNodeIds={["node-a", "node-b"]}
				focusedNodeId={null}
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
		const selectedById = Object.fromEntries(
			wrappers.map((wrapper) => {
				const props = getElementProps<{
					node?: { id: string };
					isSelected?: boolean;
				}>(wrapper);
				return [props?.node?.id ?? "", props?.isSelected ?? false];
			}),
		);
		expect(selectedById).toMatchObject({
			"node-a": true,
			"node-b": true,
			"node-c": false,
		});

		const overlayProps = getElementProps<{
			selectedNodes?: Array<{ id: string }>;
		}>(getOverlayElement(tree));
		expect(overlayProps?.selectedNodes?.map((node) => node.id)).toEqual([
			"node-a",
			"node-b",
		]);
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
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		const overlayProps = getElementProps<{
			activeNode?: { locked?: boolean };
		}>(overlayElement);
		expect(overlayElement).toBeTruthy();
		expect(overlayProps?.activeNode?.locked).toBe(true);
	});

	it("focus 状态下不挂载 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId="node-a"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		expect(overlayElement).toBeNull();
	});

	it("正常模式会挂载 node label layer", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0), createVideoNode("node-b", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const labelLayerElement = getLabelLayerElement(tree);
		const labelLayerProps = getElementProps<{
			nodes?: unknown[];
			camera?: { x: number; y: number; zoom: number };
			focusedNodeId?: string | null;
		}>(labelLayerElement);
		expect(labelLayerElement).toBeTruthy();
		expect(labelLayerProps?.nodes).toHaveLength(2);
		expect(labelLayerProps?.camera).toEqual({ x: 0, y: 0, zoom: 1 });
		expect(labelLayerProps?.focusedNodeId ?? null).toBeNull();
	});

	it("focus scene 模式会抑制普通 node 交互并接管 Focus 层事件", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[
					createSceneNode("node-scene", 0),
					createVideoNode("node-video", 1),
				]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-scene"
				selectedNodeIds={["node-scene"]}
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
		expect(
			wrappers.every((wrapper) => {
				return (
					getElementProps<{ disabled?: boolean }>(wrapper)?.disabled === true
				);
			}),
		).toBe(true);

		const focusLayer = collectElements(
			tree,
			(element) =>
				element.props.onLayerPointerDown === focusLayerPointerDownSpy,
		)[0];
		expect(focusLayer).toBeTruthy();
		const focusLayerProps = getElementProps<{
			onLayerPointerDown?: (event: Record<string, unknown>) => void;
		}>(focusLayer);

		act(() => {
			focusLayerProps?.onLayerPointerDown?.({
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
				selectedNodeIds={["node-scene"]}
				focusedNodeId="node-scene"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const focusLayerElement = collectElements(
			tree,
			(element) =>
				element.props.onLayerPointerDown === focusLayerPointerDownSpy,
		)[0];
		expect(focusLayerElement).toBeTruthy();
		if (!focusLayerElement) return;
		const handleItems = focusLayerElement.props.handleItems as Array<{
			kind: string;
			cursor: string;
			visibleCornerMarker: boolean;
		}>;
		const cursorValues = handleItems.map((item) => item.cursor);
		const visibleCornerMarkers = handleItems.filter(
			(item) => item.visibleCornerMarker,
		);
		expect(visibleCornerMarkers).toHaveLength(4);
		expect(cursorValues).toEqual(
			expect.arrayContaining([
				"rotate-cursor-top-left",
				"rotate-cursor-top-right",
				"rotate-cursor-bottom-right",
				"rotate-cursor-bottom-left",
				"nwse-resize",
				"ns-resize",
				"nesw-resize",
				"ew-resize",
			]),
		);
		expect(cursorValues).toHaveLength(12);
		const rotateCursors = cursorValues.filter((cursor) =>
			/^rotate-cursor-/.test(String(cursor)),
		);
		expect(rotateCursors.every((cursor) => typeof cursor === "string")).toBe(
			true,
		);
		expect(new Set(rotateCursors).size).toBe(4);
		expect(
			rotateCursors.some((cursor) => /grab|hand/i.test(String(cursor))),
		).toBe(false);
	});

	it("focus 状态下 label layer 仍然存在并拿到 focusedNodeId", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createSceneNode("node-scene", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-scene"
				selectedNodeIds={["node-scene"]}
				focusedNodeId="node-scene"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const labelLayerElement = getLabelLayerElement(tree);
		expect(labelLayerElement).toBeTruthy();
		expect(labelLayerElement?.props.focusedNodeId).toBe("node-scene");
	});

	it("会把 resize 回调透传到 overlay", async () => {
		const onNodeResize = vi.fn();

		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				onNodeResize={onNodeResize}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		expect(overlayElement).toBeTruthy();
		expect(overlayElement?.props.onNodeResize).toBe(onNodeResize);
	});
});
